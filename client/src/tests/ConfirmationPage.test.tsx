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
 * There is no payment status to assert. bookings has price_paid and payment_id
 * NOT NULL and no status column, so a record coming back at all is the proof
 * that the charge cleared — the only other outcome is that no record exists yet.
 *
 * Handlers use wildcard origins so the suite does not depend on VITE_API_URL
 * being present in a local .env.
 */

const BOOKING_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SESSION_ID = 'cs_test_1';
const PAYMENT_INTENT_ID = 'pi_test_1';

const PAID: BookingRecord = {
  id: BOOKING_ID,
  userId: null,
  destinationId: 'dest-1',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  nights: 3,
  adults: 2,
  children: 1,
  billing: {
    line1: '10 Bayfront Avenue',
    line2: '#12-34',
    city: 'Singapore',
    state: null,
    postalCode: '018956',
    country: 'SG',
  },
  specialRequests: 'High floor, away from the lift',
  guest: {
    salutation: 'Dr',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
    specialRequests: 'High floor, away from the lift',
  },
  pricePaid: 784.8,
  paymentId: 'pi_test_1',
  payeeId: 'jane@example.com',
  // Stripe reports the brand lower-cased; the page is what title-cases it.
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
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

/** What hosted Checkout redirects back to: a session id and nothing else. */
const RETURNED_FROM_STRIPE = `?session_id=${SESSION_ID}`;

/**
 * What the embedded Elements page routes to instead. There is no hosted page to
 * come back from, so there is no session — the payment intent is the handle,
 * and it is equally worthless to a forger because the server still asks Stripe.
 */
const RETURNED_FROM_ELEMENTS = `?payment_intent=${PAYMENT_INTENT_ID}`;

/** A revisit from the confirmation email, long after the payment. */
const REVISIT = `?id=${BOOKING_ID}`;

// The 1s findBy* default is tight when the whole suite runs in parallel.
const FIND = { timeout: 5000 };

/** Exhausting the poll budget takes MAX_POLLS × POLL_INTERVAL_MS on its own. */
const AFTER_POLLING = { timeout: 20000 };

describe('ConfirmationPage', () => {
  it('leaves the loading state and renders the booking under StrictMode', async () => {
    server.use(http.post('*/api/bookings/confirm', () => HttpResponse.json({ booking: PAID })));

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(await screen.findByText(BOOKING_ID, undefined, FIND)).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
    expect(screen.getByText('SGD 784.80')).toBeInTheDocument();
    expect(screen.getByText('Dr Jane Tan')).toBeInTheDocument();
    expect(screen.getByText('2 adults, 1 child')).toBeInTheDocument();
    // Shown twice by design: the "sent to" line and the guest block.
    expect(screen.getAllByText('jane@example.com')).toHaveLength(2);
  });

  it('verifies the Stripe session server-side before rendering anything', async () => {
    // The browser is told nothing about the payment; it hands the session id
    // back and the server asks Stripe. A body carrying a status or an amount
    // would mean the page could be lied to with a hand-crafted URL.
    let body: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/bookings/confirm', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(RETURNED_FROM_STRIPE);
    await screen.findByText(BOOKING_ID, undefined, FIND);

    expect(body).toEqual({ sessionId: SESSION_ID });
  });

  it('confirms a payment intent when that is what it was handed', async () => {
    // The embedded Elements flow and the demo card form both land here with
    // payment_intent rather than session_id. Same verification server-side,
    // same booking out — the page's only job is to forward the right key, and
    // sending `sessionId: "pi_…"` would be rejected as a session that does not
    // exist, on a charge that has already been taken.
    let body: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/bookings/confirm', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(RETURNED_FROM_ELEMENTS);

    expect(await screen.findByText(BOOKING_ID, undefined, FIND)).toBeInTheDocument();
    expect(body).toEqual({ paymentIntentId: PAYMENT_INTENT_ID });
    expect(screen.getByText('SGD 784.80')).toBeInTheDocument();
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
  });

  it('prefers the payment intent when a URL carries both handles', async () => {
    // Stripe appends payment_intent to the return_url it redirects through, so
    // a 3DS challenge on a hosted session can produce both. The intent is the
    // more specific of the two and the one the charge actually happened under.
    let body: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/bookings/confirm', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(`?session_id=${SESSION_ID}&payment_intent=${PAYMENT_INTENT_ID}`);

    await screen.findByText(BOOKING_ID, undefined, FIND);
    expect(body).toEqual({ paymentIntentId: PAYMENT_INTENT_ID });
    expect(body).not.toHaveProperty('sessionId');
  });

  it('confirms rather than looks up when an intent and an id are both present', async () => {
    // The by-id shortcut is only for a revisit, where there is nothing left to
    // settle. An intent in the URL means the customer has just paid, so the
    // charge still has to be verified and the booking written — a bare GET
    // would 404 on a booking that does not exist yet.
    let confirmed = false;

    server.use(
      http.post('*/api/bookings/confirm', () => {
        confirmed = true;
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(`?payment_intent=${PAYMENT_INTENT_ID}&id=${BOOKING_ID}`);

    await screen.findByText(BOOKING_ID, undefined, FIND);
    expect(confirmed).toBe(true);
  });

  it('keeps not-found conclusive on the payment-intent path too', async () => {
    // Same rule as everywhere else on this page: a 404 is an answer, and only a
    // 404 may say so. The distinction has to hold on both confirm paths or the
    // newer one quietly reintroduces the regression the older one guards.
    server.use(
      http.post('*/api/bookings/confirm', () =>
        HttpResponse.json({ error: 'Booking not found.' }, { status: 404 })
      )
    );

    renderConfirmation(RETURNED_FROM_ELEMENTS);

    expect(
      await screen.findByRole('heading', { name: /booking not found/i }, FIND)
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /could not reach/i })).not.toBeInTheDocument();
  });

  it('renders the card as a receipt line, not as stored card data', async () => {
    // Brand, last four and expiry are the only card fields PCI-DSS permits
    // storing, and they arrive from Stripe after the charge — never from a form.
    server.use(http.post('*/api/bookings/confirm', () => HttpResponse.json({ booking: PAID })));

    renderConfirmation(RETURNED_FROM_STRIPE);
    await screen.findByText(BOOKING_ID, undefined, FIND);

    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
  });

  it('reads a revisited booking straight from the by-id endpoint', async () => {
    // No session id, so there is no Stripe hop to make: the confirmation email
    // links to ?id=<uuid> and a single GET answers conclusively. A POST to
    // /confirm here would be unhandled, which setup.ts turns into a failure.
    let lookedUp = false;

    server.use(
      http.get(`*/api/bookings/${BOOKING_ID}`, () => {
        lookedUp = true;
        return HttpResponse.json(PAID);
      })
    );

    renderConfirmation(REVISIT);

    expect(await screen.findByText(BOOKING_ID, undefined, FIND)).toBeInTheDocument();
    expect(lookedUp).toBe(true);
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
  });

  it('renders a single-adult, no-children stay without stray plurals', async () => {
    server.use(
      http.get(`*/api/bookings/${BOOKING_ID}`, () =>
        HttpResponse.json({ ...PAID, adults: 1, children: 0, nights: 1 })
      )
    );

    renderConfirmation(REVISIT);

    expect(await screen.findByText('1 adult', undefined, FIND)).toBeInTheDocument();
    expect(screen.getByText(/1 night$/)).toBeInTheDocument();
  });

  it('settles into its own state while the charge is still in flight', async () => {
    // 402 is "Stripe has not reported this as paid yet", which is a wait rather
    // than a failure. Out of attempts, the money may well be gone, so the page
    // must say so plainly instead of reporting an error or a missing booking.
    server.use(
      http.post('*/api/bookings/confirm', () =>
        HttpResponse.json({ error: 'Payment has not completed.' }, { status: 402 })
      )
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(
      await screen.findByRole('heading', { name: /still settling/i }, AFTER_POLLING)
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /booking not found/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /could not reach/i })).not.toBeInTheDocument();
  }, 25000);

  it('renders the booking once a later poll finds the charge settled', async () => {
    // Keyed on elapsed time rather than a call count: StrictMode runs two
    // independent poll loops, so "the Nth request" is not a stable notion here.
    // The clock starts at the first request, not at render, so a slow mount
    // under parallel load cannot skip the unsettled state entirely. 1s sits
    // inside the 2s poll interval, so the first round always reads 402.
    let firstRequestAt = 0;

    server.use(
      http.post('*/api/bookings/confirm', () => {
        firstRequestAt ||= Date.now();
        if (Date.now() < firstRequestAt + 1000) {
          return HttpResponse.json({ error: 'Payment has not completed.' }, { status: 402 });
        }
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(
      await screen.findByText(BOOKING_ID, undefined, AFTER_POLLING)
    ).toBeInTheDocument();
    expect(screen.getByText(/you're all/i)).toBeInTheDocument();
  }, 25000);

  it('reports a booking that cannot be found', async () => {
    server.use(
      http.get(`*/api/bookings/${BOOKING_ID}`, () =>
        HttpResponse.json({ error: 'Booking not found.' }, { status: 404 })
      )
    );

    renderConfirmation(REVISIT);

    expect(
      await screen.findByRole('heading', { name: /booking not found/i }, FIND)
    ).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
  });

  it('does not report a backend failure as a missing booking', async () => {
    // The regression this guards: every non-200 used to render "Booking not
    // found", so a database outage told someone who had just paid that their
    // booking did not exist. Only a 404 may say that.
    server.use(
      http.get(`*/api/bookings/${BOOKING_ID}`, () =>
        HttpResponse.json({ error: 'Could not retrieve that booking.' }, { status: 503 })
      )
    );

    renderConfirmation(REVISIT);

    expect(
      await screen.findByRole('heading', { name: /could not reach/i }, FIND)
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /booking not found/i })).not.toBeInTheDocument();
  });

  it('keeps the two apart on the confirm path as well', async () => {
    // Same distinction, reached the other way: a 404 from /confirm is conclusive
    // and stops the polling, while a 5xx spends the remaining attempts first.
    server.use(
      http.post('*/api/bookings/confirm', () =>
        HttpResponse.json({ error: 'Booking not found.' }, { status: 404 })
      )
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(
      await screen.findByRole('heading', { name: /booking not found/i }, FIND)
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /could not reach/i })).not.toBeInTheDocument();
  });

  it('reports an unreachable service after exhausting its attempts', async () => {
    server.use(
      http.post('*/api/bookings/confirm', () =>
        HttpResponse.json({ error: 'upstream' }, { status: 502 })
      )
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(
      await screen.findByRole('heading', { name: /could not reach/i }, AFTER_POLLING)
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /booking not found/i })).not.toBeInTheDocument();
  }, 25000);

  it('recovers when a failing confirm starts succeeding', async () => {
    // A brief backend blip must not be allowed to report a paid booking as
    // missing, so the remaining attempts run before the page gives up.
    let attempts = 0;

    server.use(
      http.post('*/api/bookings/confirm', () => {
        attempts += 1;
        // StrictMode runs two loops, so gate on a clock-free counter that both
        // share: the first round fails, everything after succeeds.
        if (attempts <= 2) {
          return HttpResponse.json({ error: 'upstream' }, { status: 503 });
        }
        return HttpResponse.json({ booking: PAID });
      })
    );

    renderConfirmation(RETURNED_FROM_STRIPE);

    expect(
      await screen.findByText(BOOKING_ID, undefined, AFTER_POLLING)
    ).toBeInTheDocument();
  }, 25000);

  it('reports a missing reference without calling the API', async () => {
    renderConfirmation('');

    expect(
      await screen.findByText(/no booking reference was provided/i, undefined, FIND)
    ).toBeInTheDocument();
    expect(screen.queryByText(/confirming your booking/i)).not.toBeInTheDocument();
  });
});
