import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../tests/setup';
import CheckoutPage from './CheckoutPage';

/**
 * UC4 checkout page.
 *
 * The most important assertion here is a negative one: this page must never
 * render a card input. Payment happens on a Stripe-hosted page, and the moment
 * a PAN can be typed into our own DOM the platform is back in PCI SAQ D scope.
 *
 * Handlers use wildcard origins so the suite does not depend on VITE_API_URL
 * being present in a local .env.
 */

const QUOTE = {
  hotelId: 'marina-bay',
  roomId: 'deluxe-king',
  checkIn: '2026-08-01',
  checkOut: '2026-08-04',
  guests: 2,
  rooms: 1,
  nights: 3,
  currency: 'SGD',
  nightlyRate: 240,
  subtotal: 720,
  taxes: 64.8,
  totalPrice: 784.8,
};

const renderCheckout = () =>
  render(
    <MemoryRouter initialEntries={['/checkout']}>
      <CheckoutPage />
    </MemoryRouter>
  );

const fillGuestDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByPlaceholderText(/as it appears/i), 'Jane Tan');
  await user.type(screen.getByPlaceholderText(/you@example.com/i), 'jane@example.com');
  await user.type(screen.getByPlaceholderText(/\+65/), '+65 9123 4567');
};

describe('CheckoutPage', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/bookings/checkout', () => HttpResponse.json(QUOTE)),
      http.post('*/api/bookings/guest-details', () => HttpResponse.json({ valid: true }))
    );

    // jsdom throws on real navigation, so the redirect target is captured instead.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: vi.fn() },
    });
  });

  it('renders the server-priced quote', async () => {
    renderCheckout();

    expect(await screen.findByText('SGD 784.80')).toBeInTheDocument();
    expect(screen.getByText(/3 nights/)).toBeInTheDocument();
  });

  it('never renders a card input', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('SGD 784.80');

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));

    // Reach the final step before asserting, so nothing is hidden behind it.
    await screen.findByRole('button', { name: /pay sgd/i });

    for (const pattern of [/card number/i, /cvc/i, /expiry/i, /name on card/i]) {
      expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(pattern)).not.toBeInTheDocument();
    }

    // Nothing resembling a PAN field survives anywhere in the tree.
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const input of inputs) {
      expect(input.getAttribute('name') ?? '').not.toMatch(/card|cvc|cvv|pan/i);
      expect(input.getAttribute('autocomplete') ?? '').not.toMatch(/cc-/i);
    }
  });

  it('surfaces server-side field errors and stays on step 1', async () => {
    server.use(
      http.post('*/api/bookings/guest-details', () =>
        HttpResponse.json(
          { valid: false, errors: { guestEmail: 'Please enter a valid email address.' } },
          { status: 422 }
        )
      )
    );

    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('SGD 784.80');

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument();
  });

  it('sends no price of any kind when starting payment', async () => {
    let captured: Record<string, unknown> = {};

    server.use(
      http.post('*/api/bookings/payment', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          bookingReference: 'TRX-ABC1234567',
          redirectUrl: 'https://checkout.stripe.com/c/pay/test-session',
        });
      })
    );

    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('SGD 784.80');

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    await user.click(await screen.findByRole('button', { name: /pay sgd/i }));

    await waitFor(() => expect(captured.stay).toBeDefined());

    const serialised = JSON.stringify(captured);
    expect(serialised).not.toMatch(/totalPrice|nightlyRate|subtotal|"amount"/);

    const stay = captured.stay as Record<string, unknown>;
    expect(stay).not.toHaveProperty('totalPrice');
    expect(stay).toHaveProperty('roomId', 'deluxe-king');
  });

  it('redirects to the URL the server returns', async () => {
    server.use(
      http.post('*/api/bookings/payment', () =>
        HttpResponse.json({
          bookingReference: 'TRX-ABC1234567',
          redirectUrl: 'https://checkout.stripe.com/c/pay/test-session',
        })
      )
    );

    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('SGD 784.80');

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    await user.click(await screen.findByRole('button', { name: /pay sgd/i }));

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        'https://checkout.stripe.com/c/pay/test-session'
      )
    );
  });

  it('reports a failure to start payment without leaving the page', async () => {
    server.use(
      http.post('*/api/bookings/payment', () =>
        HttpResponse.json({ error: 'Payments are not available right now.' }, { status: 503 })
      )
    );

    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('SGD 784.80');

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));
    await user.click(await screen.findByRole('button', { name: /pay sgd/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available right now/i);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
