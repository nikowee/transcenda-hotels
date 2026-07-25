import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import CheckoutPage from '../pages/CheckoutPage';
import type { CheckoutQuote } from '../types/booking';

/**
 * UC4 checkout page.
 *
 * The most important assertion here is still a negative one: this page must
 * never render a card input. Card entry lives on /payment and nowhere else, so
 * the moment a PAN can be typed into *this* DOM the boundary has moved without
 * anyone deciding to move it.
 *
 * The second is that no amount travels out of the browser. The server prices
 * the stay from its own inventory when it mints the payment intent, so a total
 * appearing in the handoff would mean the price is negotiable.
 *
 * The pay button no longer talks to Stripe. It writes the guest and stay into
 * sessionStorage and routes to /payment, so the assertions below are about what
 * lands in storage and where the router ends up — not about a redirect URL.
 *
 * Handlers use wildcard origins so the suite does not depend on VITE_API_URL
 * being present in a local .env.
 */

/**
 * Typed as CheckoutQuote so a change to the shared shape breaks the fixture
 * rather than the assertions — this is the exact body GET /checkout returns.
 * The page renders nightlyTotal (the whole stay's per-night cost), not a
 * per-room rate; nightlyRates is index-aligned with roomTypes.
 */
const QUOTE: CheckoutQuote = {
  destinationId: 'dest-1',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 1,
  nights: 3,
  currency: 'SGD',
  nightlyRates: [240],
  nightlyTotal: 240,
  subtotal: 720,
  taxes: 64.8,
  totalPrice: 784.8,
};

/** The key CheckoutPage and PaymentPage agree on. Changing it breaks the handoff. */
const HANDOFF_KEY = 'transcenda:checkout';

/** The salutations the bookings table is populated with, and nothing else. */
const SALUTATIONS = ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof'];

const GUEST = {
  salutation: 'Dr',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
  specialRequests: 'High floor, away from the lift',
};

const quoteHandler = (overrides: Partial<CheckoutQuote> = {}) =>
  http.get('*/api/bookings/checkout', () => HttpResponse.json({ ...QUOTE, ...overrides }));

/**
 * /payment is stubbed rather than mounted. This suite's interest ends at "the
 * router arrived there with the handoff written"; what the payment page then
 * does with it is PaymentPage.test.tsx's problem.
 */
const renderCheckout = (entry = '/checkout') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/payment" element={<div>payment page reached</div>} />
      </Routes>
    </MemoryRouter>
  );

/** Resolves once the server-priced summary has rendered, so the form is live. */
const waitForQuote = () => screen.findByText('SGD 784.80');

const BILLING = {
  line1: '10 Bayfront Avenue',
  line2: '#12-34',
  city: 'Singapore',
  postalCode: '018956',
  country: 'SG',
};

type User = ReturnType<typeof userEvent.setup>;

const fillGuestDetails = async (user: User, overrides: Partial<typeof GUEST> = {}) => {
  const guest = { ...GUEST, ...overrides };

  // The <label>s are not associated with their controls, so the placeholders
  // are the stable handles here — the same ones the E2E spec uses.
  await user.selectOptions(
    screen.getByRole('combobox', { name: /salutation/i }),
    guest.salutation
  );
  await user.type(screen.getByPlaceholderText(/as it appears/i), guest.firstName);
  await user.type(screen.getByPlaceholderText(/family name/i), guest.lastName);
  await user.type(screen.getByPlaceholderText('you@example.com'), guest.email);
  await user.type(screen.getByPlaceholderText(/\+65/), guest.phone);

  if (guest.specialRequests) {
    await user.type(screen.getByPlaceholderText(/high floor/i), guest.specialRequests);
  }

  // Billing is part of this step now: Stripe runs an AVS check against it, and
  // the server rejects the step without it.
  await user.type(screen.getByPlaceholderText(/10 bayfront/i), BILLING.line1);
  await user.type(screen.getByPlaceholderText(/unit, floor/i), BILLING.line2);
  await user.type(screen.getByPlaceholderText(/^singapore$/i), BILLING.city);
  await user.type(screen.getByPlaceholderText('018956'), BILLING.postalCode);
  await user.selectOptions(
    screen.getByRole('combobox', { name: /billing country/i }),
    BILLING.country
  );
};

const continueToReview = async (user: User) => {
  await user.click(screen.getByRole('button', { name: /continue to payment/i }));
  return screen.findByRole('button', { name: /pay sgd/i });
};

/** Fills the form, pays, and resolves once /payment has rendered. */
const payAndLand = async (user: User, overrides: Partial<typeof GUEST> = {}) => {
  await fillGuestDetails(user, overrides);
  await user.click(await continueToReview(user));
  await screen.findByText('payment page reached');
};

const readHandoff = () => {
  const raw = sessionStorage.getItem(HANDOFF_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
};

/**
 * Records any call to the endpoint the page used to hit. Registered on every
 * test rather than only where it is asserted: with a handler in place a stray
 * POST resolves quietly instead of tripping MSW's unhandled-request error, so
 * the only thing that can catch it is an explicit count.
 */
const watchLegacyPaymentEndpoint = () => {
  const calls: string[] = [];

  server.use(
    http.post('*/api/bookings/payment', async ({ request }) => {
      calls.push((await request.text()) || '{}');
      return HttpResponse.json({ redirectUrl: 'https://checkout.stripe.com/should-not-happen' });
    }),
    http.post('*/api/bookings/payment-intent', async ({ request }) => {
      calls.push((await request.text()) || '{}');
      return HttpResponse.json({ clientSecret: 'should_not_happen' });
    })
  );

  return calls;
};

describe('CheckoutPage', () => {
  let paymentCalls: string[];

  beforeEach(() => {
    sessionStorage.clear();

    server.use(
      quoteHandler(),
      http.post('*/api/bookings/guest-details', () => HttpResponse.json({ valid: true }))
    );

    paymentCalls = watchLegacyPaymentEndpoint();

    // jsdom throws on real navigation. The page should never attempt one now
    // that payment is an in-app route, so this stub exists to prove it doesn't.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: vi.fn() },
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the server-priced quote', async () => {
    renderCheckout();

    expect(await waitForQuote()).toBeInTheDocument();
    expect(screen.getByText(/3 nights/)).toBeInTheDocument();
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('deluxe-king')).toBeInTheDocument();
  });

  it.each([
    [2, 1, '2 adults, 1 child'],
    [1, 0, '1 adult'],
    [3, 2, '3 adults, 2 children'],
    [1, 1, '1 adult, 1 child'],
  ])(
    'renders %i adults and %i children as "%s"',
    async (adults, children, expected) => {
      // Occupancy is two integer columns now, so the page has to turn them back
      // into prose. Singular/plural and the zero-children case are the parts a
      // naive `${adults} adults, ${children} children` gets wrong.
      server.use(quoteHandler({ adults, children }));
      renderCheckout();

      expect(await screen.findByText(expected)).toBeInTheDocument();
    }
  );

  it('offers only the allowlisted salutations', async () => {
    renderCheckout();
    await waitForQuote();

    // Scoped: the billing country select contributes options too.
    const salutation = screen.getByRole('combobox', { name: /salutation/i });
    const options = within(salutation)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual(SALUTATIONS);
  });

  it('hands the guest and stay over to /payment', async () => {
    const user = userEvent.setup();

    renderCheckout();
    await waitForQuote();
    await payAndLand(user);

    // The handoff goes through sessionStorage rather than router state so that
    // refreshing /payment does not strand the customer with no booking to pay
    // for. That only holds if the payload is written *before* the navigation.
    const handoff = readHandoff();
    expect(handoff).not.toBeNull();
    // Billing rides along too: /payment reprices and re-validates from this, so
    // an address left behind here is an address the booking never records.
    expect(Object.keys(handoff ?? {}).sort()).toEqual([
      'billingAddress',
      'guestDetails',
      'stay',
    ]);
    expect(handoff?.billingAddress).toMatchObject({ line1: BILLING.line1, country: 'SG' });
  });

  it('sends the chosen salutation and the two name parts separately', async () => {
    // guest_salutation, guest_first_name and guest_last_name are three columns.
    // A single "full name" field cannot fill them, so the split has to survive
    // all the way into the handoff the payment page reads back.
    const user = userEvent.setup();

    renderCheckout();
    await waitForQuote();
    await payAndLand(user, { salutation: 'Prof' });

    expect(readHandoff()?.guestDetails).toMatchObject({
      salutation: 'Prof',
      firstName: 'Jane',
      lastName: 'Tan',
      email: 'jane@example.com',
      phone: '+65 9123 4567',
    });
  });

  it('continues to payment when special requests are left blank', async () => {
    // special_requests is the one nullable guest column. Omitting it must not
    // fail validation or block the handoff.
    const user = userEvent.setup();

    renderCheckout();
    await waitForQuote();
    await payAndLand(user, { specialRequests: '' });

    const guestDetails = readHandoff()?.guestDetails as Record<string, unknown>;
    expect(guestDetails.specialRequests).toBeFalsy();
  });

  it('never renders a card input', async () => {
    // Unchanged in intent, and load-bearing: card entry moved to /payment, so
    // a PAN field reappearing here would be a silent widening of PCI scope
    // rather than a visible design decision.
    const user = userEvent.setup();
    renderCheckout();
    await waitForQuote();

    await fillGuestDetails(user);
    await continueToReview(user);

    // Reach the final step before asserting, so nothing is hidden behind it.
    for (const pattern of [/card number/i, /cvc/i, /expiry/i, /name on card/i]) {
      expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(pattern)).not.toBeInTheDocument();
    }

    // Nothing resembling a PAN field survives anywhere in the tree.
    const fields = Array.from(document.querySelectorAll('input, select, textarea'));
    for (const field of fields) {
      const name = field.getAttribute('name') ?? '';
      const placeholder = field.getAttribute('placeholder') ?? '';
      expect(`${name} ${placeholder}`).not.toMatch(/card|cvc|cvv|pan|expiry/i);
      expect(field.getAttribute('autocomplete') ?? '').not.toMatch(/^cc-/i);
    }
  });

  it('surfaces server-side field errors and stays on step 1', async () => {
    server.use(
      http.post('*/api/bookings/guest-details', () =>
        HttpResponse.json(
          {
            valid: false,
            errors: {
              lastName: 'Last name is required.',
              email: 'Please enter a valid email address.',
            },
          },
          { status: 422 }
        )
      )
    );

    const user = userEvent.setup();
    renderCheckout();
    await waitForQuote();

    await fillGuestDetails(user);
    await user.click(screen.getByRole('button', { name: /continue to payment/i }));

    // Per field, not one banner for six fields: the server answers with a
    // field → message map so each input can be marked up individually.
    expect(await screen.findByText('Last name is required.')).toBeInTheDocument();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay sgd/i })).not.toBeInTheDocument();

    // Nothing was handed over, so a customer who backs out mid-validation
    // cannot walk into /payment on a stale payload.
    expect(readHandoff()).toBeNull();
  });

  it('puts no price of any kind into the handoff', async () => {
    const user = userEvent.setup();

    renderCheckout();
    await waitForQuote();
    await payAndLand(user);

    // nightlyRate catches nightlyRates too; nightlyTotal is spelled out because
    // it is the figure the summary actually displays and so the likeliest to be
    // copied into the payload by mistake.
    const serialised = sessionStorage.getItem(HANDOFF_KEY) ?? '';
    expect(serialised).not.toMatch(/totalPrice|nightlyRate|nightlyTotal|subtotal|"amount"/);

    // The stay is the whole of what the server needs to reprice it itself.
    const stay = readHandoff()?.stay as Record<string, unknown>;
    expect(stay).not.toHaveProperty('totalPrice');
    expect(stay).toMatchObject({
      destinationId: 'dest-1',
      hotelId: 'marina-bay',
      hotelName: 'Marina Bay Sands',
      roomTypes: ['deluxe-king'],
      startDate: '2026-08-01',
      endDate: '2026-08-04',
      adults: 2,
      children: 1,
    });
  });

  it('starts no payment from this page at all', async () => {
    // The intent is minted by /payment, once, against a server-side price. If
    // checkout also called a payment endpoint the customer could end up with
    // two intents for one stay, and the page would be back in the money path.
    const user = userEvent.setup();

    renderCheckout();
    await waitForQuote();
    await payAndLand(user);

    expect(paymentCalls).toEqual([]);
    // Nor does it leave the SPA. /payment is an in-app route; a full page load
    // would drop the React tree and, with it, everything not yet persisted.
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('reports a handoff it could not write instead of routing to a dead page', async () => {
    // sessionStorage throws in private-mode Safari and wherever site storage is
    // switched off. Navigating anyway would land on /payment with nothing to
    // pay for, which reads to the customer as a lost booking.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const user = userEvent.setup();
    renderCheckout();
    await waitForQuote();

    await fillGuestDetails(user);
    await user.click(await continueToReview(user));

    expect(await screen.findByRole('alert')).toHaveTextContent(/enable site storage/i);
    expect(screen.queryByText('payment page reached')).not.toBeInTheDocument();

    // Still recoverable: the pay button comes back rather than staying spun.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pay sgd/i })).toBeEnabled()
    );
  });

  it('says a payment was cancelled and charges nothing', async () => {
    // /payment sends the customer back here with ?cancelled=1 rather than
    // leaving them on a payment form that has already been abandoned.
    renderCheckout('/checkout?cancelled=1');

    expect(await screen.findByText(/you cancelled the payment/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
  });

  it('surfaces an unpriceable stay instead of rendering a total', async () => {
    server.use(
      http.get('*/api/bookings/checkout', () =>
        HttpResponse.json({ error: 'That room type is not available.' }, { status: 400 })
      )
    );

    renderCheckout();

    expect(await screen.findByText('That room type is not available.')).toBeInTheDocument();
    expect(screen.queryByText(/SGD/)).not.toBeInTheDocument();
  });
});
