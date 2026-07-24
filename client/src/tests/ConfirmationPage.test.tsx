import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import ConfirmationPage from '../pages/ConfirmationPage';
import type { BookingRecord } from '../types/booking';

/**
 * UC4 confirmation page.
 *
 * Every case here renders inside <StrictMode> on purpose, because that is what
 * main.tsx does and it is what broke this page: React double-mounts in dev, so
 * any "run once" guard that skips the second mount strands the first mount's
 * fetch behind an already-tripped cancellation flag, and the page spins
 * forever. A test that mounts once cannot see that, so these must not be
 * "simplified" by dropping the wrapper.
 *
 * Handlers use wildcard origins so the suite does not depend on VITE_API_URL
 * being present in a local .env.
 */

const REFERENCE = 'TRX-ABCDEF2345';

const PAID: BookingRecord = {
  id: 'bk_1',
  bookingReference: REFERENCE,
  guestName: 'Jane Tan',
  guestEmail: 'jane@example.com',
  contactNumber: '+65 9123 4567',
  hotelId: 'marina-bay',
  roomId: 'deluxe-king',
  checkIn: '2026-08-01',
  checkOut: '2026-08-04',
  totalPrice: 784.8,
  currency: 'SGD',
  paymentStatus: 'PAID',
  stripeSessionId: 'cs_test_1',
  paymentIntentId: 'pi_test_1',
  createdAt: '2026-07-24T00:00:00.000Z',
};

const renderConfirmation = (query: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/confirmation${query}`]}>
        <ConfirmationPage />
      </MemoryRouter>
    </StrictMode>
  );

const RETURNED_FROM_STRIPE = `?ref=${REFERENCE}&session_id=cs_test_1`;

// The 1s findBy* default is tight when the whole suite runs in parallel.
const FIND = { timeout: 5000 };

describe('ConfirmationPage', () => {
  it('leaves the loading state and renders the booking under StrictMode', async () => {
    server.use(
      http.post('*/api/bookings/confirm', () => HttpResponse.json({ booking: PAID })),
      http.get(`*/api/bookings/${REFERENCE}`, () => HttpResponse.json(PAID))
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(await screen.findByText(REFERENCE, undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
    expect(screen.getByText('SGD 784.80')).toBeInTheDocument();
    expect(screen.getByText('Jane Tan')).toBeInTheDocument();
    // Shown twice by design: the "sent to" line and the guest block.
    expect(screen.getAllByText('jane@example.com')).toHaveLength(2);
  });

  it('verifies the Stripe session server-side before reading the booking', async () => {
    let body: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/bookings/confirm', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ booking: PAID });
      }),
      http.get(`*/api/bookings/${REFERENCE}`, () => HttpResponse.json(PAID))
    );

    renderConfirmation(RETURNED_FROM_STRIPE);
    await screen.findByText(REFERENCE, undefined, FIND);

    expect(body).toEqual({ sessionId: 'cs_test_1', bookingReference: REFERENCE });
  });

  it('still renders the booking when session verification fails', async () => {
    // The webhook is the authoritative path, so a failed confirm must not block
    // the page — it falls through to whatever state the booking is really in.
    server.use(
      http.post('*/api/bookings/confirm', () =>
        HttpResponse.json({ error: 'Payment has not completed.' }, { status: 402 })
      ),
      http.get(`*/api/bookings/${REFERENCE}`, () => HttpResponse.json(PAID))
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(await screen.findByText(REFERENCE, undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
  });

  it('polls a PENDING booking until the webhook lands', async () => {
    // Keyed on elapsed time rather than a call count: StrictMode runs two
    // independent poll loops, so "the Nth request" is not a stable notion here.
    // The clock starts at the first request, not at render, so a slow mount
    // under parallel load cannot skip the PENDING state entirely. 1s sits
    // inside the 2s poll interval, so the first round always reads PENDING.
    let firstRequestAt = 0;

    server.use(
      http.get(`*/api/bookings/${REFERENCE}`, () => {
        firstRequestAt ||= Date.now();
        const pending = Date.now() < firstRequestAt + 1000;
        return HttpResponse.json(pending ? { ...PAID, paymentStatus: 'PENDING' } : PAID);
      })
    );

    renderConfirmation(`?ref=${REFERENCE}`);

    // First response is PENDING, so the page shows the interim state...
    expect(await screen.findByText('PENDING', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/confirming your payment/i)).toBeInTheDocument();

    // ...and settles once a later poll comes back PAID. One POLL_INTERVAL_MS.
    expect(await screen.findByText('PAID', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/you're all/i)).toBeInTheDocument();
  });

  it('reports a booking that cannot be found', async () => {
    server.use(
      http.get(`*/api/bookings/${REFERENCE}`, () =>
        HttpResponse.json({ error: 'Booking not found.' }, { status: 404 })
      )
    );

    renderConfirmation(`?ref=${REFERENCE}`);

    expect(await screen.findByRole('heading', { name: /booking not found/i }, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
  });

  it('does not report a backend failure as a missing booking', async () => {
    // The regression this guards: every non-200 used to render "Booking not
    // found", so a database outage told someone who had just paid that their
    // booking did not exist. Only a 404 may say that.
    server.use(
      http.get(`*/api/bookings/${REFERENCE}`, () =>
        HttpResponse.json({ error: 'Could not retrieve that booking.' }, { status: 503 })
      )
    );

    renderConfirmation(`?ref=${REFERENCE}`);

    // Exhausts the poll budget first (MAX_POLLS × POLL_INTERVAL_MS), so this
    // needs headroom well past the 5s default.
    expect(
      await screen.findByRole('heading', { name: /could not reach/i }, { timeout: 20000 })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /booking not found/i })).not.toBeInTheDocument();
  }, 25000);

  it('recovers when a failing lookup starts succeeding', async () => {
    let attempts = 0;

    server.use(
      http.get(`*/api/bookings/${REFERENCE}`, () => {
        attempts += 1;
        // StrictMode runs two loops, so gate on a clock-free counter that both
        // share: the first round fails, everything after succeeds.
        if (attempts <= 2) {
          return HttpResponse.json({ error: 'upstream' }, { status: 503 });
        }
        return HttpResponse.json(PAID);
      })
    );

    renderConfirmation(`?ref=${REFERENCE}`);

    expect(await screen.findByText(REFERENCE, undefined, { timeout: 20000 })).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
  }, 25000);

  it('reports a missing reference without calling the API', async () => {
    renderConfirmation('');

    expect(await screen.findByText(/no booking reference was provided/i, undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
  });
});
