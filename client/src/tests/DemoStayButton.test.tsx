import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { http, HttpResponse, delay } from 'msw';
import { server } from './setup';
import DemoStayButton from '../components/DemoStayButton';

/**
 * The "surprise me" entry point.
 *
 * Two things matter here and neither is cosmetic. The button must navigate to
 * the query string the server handed back rather than assembling one of its
 * own, and it must not carry a price — the server reprices at /checkout, and a
 * client that sent an amount would be a client whose amount could be edited.
 */

const CHECKOUT_QUERY =
  'destinationId=A6Dz&hotelId=OoE1&hotelName=Domus+Domas&roomTypes=dadc2590-48b8-5d76-a0de-949f97b98152' +
  '&startDate=2026-10-16&endDate=2026-10-18&adults=1&children=0';

const DEMO_STAY = {
  stay: {
    destinationId: 'A6Dz',
    destination: 'Rome',
    hotelId: 'OoE1',
    hotelName: 'Domus Domas',
    roomTypes: ['dadc2590-48b8-5d76-a0de-949f97b98152'],
    roomLabels: ['Family Triple Room'],
    startDate: '2026-10-16',
    endDate: '2026-10-18',
    adults: 1,
    children: 0,
    indicativeTotal: 1254.08,
    currency: 'SGD',
  },
  checkoutQuery: CHECKOUT_QUERY,
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

const renderButton = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <LocationProbe />
      <Routes>
        <Route path="/" element={<DemoStayButton />} />
        <Route path="/checkout" element={<div>checkout page</div>} />
      </Routes>
    </MemoryRouter>
  );

const currentUrl = () => screen.getByTestId('location').textContent ?? '';

const button = () => screen.getByRole('button', { name: /surprise me/i });

describe('DemoStayButton', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/bookings/demo-stay', () => HttpResponse.json(DEMO_STAY))
    );
  });

  it('sends the visitor to checkout with the stay the server picked', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(button());

    expect(await screen.findByText('checkout page')).toBeInTheDocument();
    expect(currentUrl()).toBe(`/checkout?${CHECKOUT_QUERY}`);
  });

  /**
   * The response carries an indicative total so a caller *could* show a price
   * without a second round trip. Forwarding it into the checkout URL would put
   * an amount in a place the customer can edit, and /checkout would then be
   * quoting against a figure that came from the browser.
   */
  it('does not forward any price into the checkout URL', async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(button());
    await screen.findByText('checkout page');

    expect(currentUrl()).not.toContain('1254');
    expect(currentUrl()).not.toMatch(/price|total|amount/i);
  });

  it('shows progress while the supplier is being asked', async () => {
    server.use(
      http.get('*/api/bookings/demo-stay', async () => {
        await delay(50);
        return HttpResponse.json(DEMO_STAY);
      })
    );

    const user = userEvent.setup();
    renderButton();

    await user.click(button());

    // A price search takes seconds, not milliseconds. Without this the button
    // looks inert and gets pressed again.
    expect(await screen.findByText(/finding a stay/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('reports the server reason when no stay can be found', async () => {
    server.use(
      http.get('*/api/bookings/demo-stay', () =>
        HttpResponse.json({ error: 'Could not find an available stay to demo just now.' }, { status: 503 })
      )
    );

    const user = userEvent.setup();
    renderButton();

    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find an available stay/i);
    expect(currentUrl()).toBe('/');
  });

  /** A failed attempt has to leave the button usable — the next try may work. */
  it('re-enables itself after a failure', async () => {
    server.use(
      http.get('*/api/bookings/demo-stay', () => HttpResponse.error())
    );

    const user = userEvent.setup();
    renderButton();

    await user.click(button());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });
});
