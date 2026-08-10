import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';

/** PaymentPage with no Stripe publishable key in the build. */

vi.hoisted(() => {
  // Explicit rather than relying on the key being absent from a developer's
  // local .env — that would make this file pass or fail by accident.
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', '');
});

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({ __brand: 'fake-stripe' })),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => null,
  useElements: () => null,
}));

const { default: PaymentPage } = await import('../pages/PaymentPage');

const HANDOFF = {
  guestDetails: {
    salutation: 'Dr',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
  },
  billingAddress: {
    line1: '10 Bayfront Avenue',
    city: 'Singapore',
    postalCode: '018956',
    country: 'SG',
  },
  stay: {
    destinationId: 'dest-1',
    hotelId: 'marina-bay',
    hotelName: 'Marina Bay Sands',
    roomTypes: ['deluxe-king'],
    startDate: '2026-08-01',
    endDate: '2026-08-04',
    adults: 2,
    children: 1,
  },
};

const QUOTE = {
  ...HANDOFF.stay,
  nights: 3,
  currency: 'SGD',
  roomLabels: ['Deluxe King'],
  nightlyRates: [240],
  nightlyTotal: 240,
  subtotal: 720,
  taxes: 64.8,
  totalPrice: 784.8,
};

const intentHandler = (simulated: boolean) =>
  http.post('*/api/bookings/payment-intent', () =>
    HttpResponse.json({
      clientSecret: 'pi_live_abc_secret_xyz',
      paymentIntentId: 'pi_live_abc',
      amount: 784.8,
      currency: 'SGD',
      simulated,
      quote: QUOTE,
    })
  );

const renderPayment = () =>
  render(
    <MemoryRouter initialEntries={['/payment']}>
      <Routes>
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/checkout" element={<div>checkout page</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('PaymentPage without a Stripe publishable key', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('transcenda:checkout', JSON.stringify(HANDOFF));
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('when the server minted a real payment', () => {
    beforeEach(() => {
      server.use(intentHandler(false));
    });

    it('explains the misconfiguration rather than showing an unusable form', async () => {
      renderPayment();

      expect(await screen.findByText(/card entry is not configured/i)).toBeInTheDocument();
      expect(screen.getByText(/nothing has been charged/i)).toBeInTheDocument();
    });

    /** The specific regression. */
    it('does not offer the demo card form against a real charge', async () => {
      renderPayment();
      await screen.findByText(/card entry is not configured/i);

      expect(screen.queryByLabelText(/card number/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^pay /i })).toBeNull();
    });

    it('names both ways out, since only configuration can fix it', async () => {
      renderPayment();
      await screen.findByText(/card entry is not configured/i);

      expect(screen.getByText('VITE_STRIPE_PUBLISHABLE_KEY')).toBeInTheDocument();
      expect(screen.getByText('PAYMENTS_MODE=simulate')).toBeInTheDocument();
    });

    /** The stay is still worth showing — the customer needs to know what stalled. */
    it('still renders the booking summary', async () => {
      renderPayment();
      await screen.findByText(/card entry is not configured/i);

      expect(
        screen.getByRole('complementary', { name: /booking summary/i })
      ).toHaveTextContent('Marina Bay Sands');
    });
  });

  /** The other half of the branch. */
  it('still mounts the demo form when the server says it is simulating', async () => {
    server.use(intentHandler(true));
    renderPayment();

    expect(await screen.findByLabelText(/card number/i)).toBeInTheDocument();
    expect(screen.queryByText(/card entry is not configured/i)).toBeNull();
  });
});
