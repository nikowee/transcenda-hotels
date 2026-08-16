import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import CheckoutPage from '../pages/CheckoutPage';
import type { CheckoutQuote } from '../types/booking';
import * as checkoutHandoff from '../lib/checkoutHandoff';

/** UC4 checkout page. */

/** Typed as CheckoutQuote so a change to the shared shape breaks the fixture rather than the assertions — this is the exact body GET /checkout returns. */
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
  roomLabels: ['Deluxe King'],
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

/** /payment is stubbed rather than mounted. */
/** A complete stay, because the page no longer invents one. */
const STAY_QUERY =
  'destinationId=dest-1&hotelId=marina-bay&hotelName=Marina%20Bay%20Sands' +
  '&roomTypes=deluxe-king&startDate=2026-08-01&endDate=2026-08-04&adults=2&children=1';

const renderCheckout = (entry = `/checkout?${STAY_QUERY}`) =>
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

/** Records any call to the endpoint the page used to hit. */
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
  describe('resuming after a failed payment', () => {
    /** The complaint this closes: a payment that did not go through dropped the customer back on an empty guest form and made them re-enter their name, email, phone and full billing address before they could try the card again — while the cancelled banner told them to "pick up where you left off". */
    const RESUMABLE = {
      guestDetails: {
        salutation: 'Dr',
        firstName: 'Jane',
        lastName: 'Tan',
        email: 'jane@example.com',
        phone: '+65 9123 4567',
        specialRequests: 'High floor',
      },
      billingAddress: {
        line1: '1 Marina Boulevard',
        line2: '',
        city: 'Singapore',
        state: '',
        postalCode: '018989',
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

    it('lands on the review step rather than the guest form', async () => {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(RESUMABLE));

      renderCheckout();

      /** /pay sgd/i, not /pay/i — the guest step's submit reads "Continue to payment", which a loose match also satisfies, so the looser assertion passed even with the page starting on step 1. */
      expect(await screen.findByRole('button', { name: /pay sgd/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /continue to payment/i })).toBeNull();
    });

    it('keeps the guest details the customer already entered', async () => {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(RESUMABLE));

      renderCheckout();

      // Rendered on the review step, so the customer can see them before retrying.
      expect(await screen.findByText(/jane@example.com/i)).toBeInTheDocument();
    });

    it('still starts at the guest form when there is nothing to resume', async () => {
      renderCheckout();

      // "Continue to payment" is the guest step's submit; the review step has
      // a "Pay …" button instead.
      expect(
        await screen.findByRole('button', { name: /continue to payment/i })
      ).toBeInTheDocument();
    });

    it('ignores a malformed handoff rather than throwing', async () => {
      // sessionStorage is user-writable, so the reader must not trust it.
      sessionStorage.setItem(HANDOFF_KEY, 'not json at all');

      renderCheckout();

      expect(
        await screen.findByRole('button', { name: /continue to payment/i })
      ).toBeInTheDocument();
    });

    /** The billing address is the half of the resume nothing was pinning. */
    it('keeps the billing address as well as the guest', async () => {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(RESUMABLE));

      const user = userEvent.setup();
      renderCheckout();

      await user.click(await screen.findByRole('button', { name: /^back$/i }));

      expect(screen.getByDisplayValue('1 Marina Boulevard')).toBeInTheDocument();
      expect(screen.getByDisplayValue('018989')).toBeInTheDocument();
    });

    /** The wrong-guest bug. */
    it('does not resume a handoff belonging to a different stay', async () => {
      sessionStorage.setItem(
        HANDOFF_KEY,
        JSON.stringify({
          ...RESUMABLE,
          stay: { ...RESUMABLE.stay, hotelId: 'raffles', hotelName: 'Raffles Hotel' },
        })
      );

      renderCheckout();

      // Step 1, where the details are re-validated against the stay on screen.
      expect(
        await screen.findByRole('button', { name: /continue to payment/i })
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pay sgd/i })).toBeNull();
    });

    /** A handoff with no address cannot pass the payment endpoint's billing validator, and step 2 has nowhere to enter one — so resuming onto it puts the customer in front of a Pay button that can only ever 422. */
    it('starts at the form when the handoff carries no billing address', async () => {
      const { billingAddress: _dropped, ...withoutBilling } = RESUMABLE;
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(withoutBilling));

      renderCheckout();

      expect(
        await screen.findByRole('button', { name: /continue to payment/i })
      ).toBeInTheDocument();
      // The typing is still salvaged — only the step differs.
      expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
    });

    /** A bare /checkout is what an old bookmark, or the browser's back button off a redirect, actually produces. */
    it('prices the stored stay when the link carries no parameters', async () => {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(RESUMABLE));

      renderCheckout('/checkout');

      expect(await screen.findByRole('button', { name: /pay sgd/i })).toBeInTheDocument();
      expect(screen.queryByText(/this checkout link is missing/i)).toBeNull();
    });

    /** Verbatim, because the E2E spec asserts this sentence case-sensitively and a reworded banner passed every unit test while breaking that run. */
    it('says nothing was charged when the payment was cancelled', async () => {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(RESUMABLE));

      renderCheckout(`/checkout?${STAY_QUERY}&cancelled=1`);

      expect(await screen.findByText(/Nothing was charged/)).toBeInTheDocument();
    });
  });

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

  /** The bug this replaced: every parameter had a demo default, so a link that lost one still produced a quote — for a stay the guest never chose — and the payment page then showed that substitute back to them as their booking. */
  describe('an incomplete link', () => {
    it('refuses to price a stay rather than inventing one', async () => {
      renderCheckout('/checkout?hotelId=marina-bay&startDate=2026-08-01');

      expect(await screen.findByText(/missing/i)).toBeInTheDocument();
      expect(screen.queryByText('SGD 784.80')).toBeNull();
      expect(screen.queryByText('Marina Bay Sands')).toBeNull();
    });

    it('names every parameter that is absent', async () => {
      renderCheckout('/checkout?hotelId=marina-bay');

      const message = await screen.findByText(/missing/i);
      for (const name of ['destinationId', 'roomTypes', 'startDate', 'endDate', 'adults']) {
        expect(message.textContent, name).toContain(name);
      }
    });

    it('never asks the server to price an incomplete stay', async () => {
      const quoted: string[] = [];
      server.use(
        http.get('*/api/bookings/checkout', ({ request }) => {
          quoted.push(request.url);
          return HttpResponse.json(QUOTE);
        })
      );

      renderCheckout('/checkout?hotelId=marina-bay');
      await screen.findByText(/missing/i);

      expect(quoted).toHaveLength(0);
    });

    /** hotelName is the one the server resolves, so its absence is not fatal. */
    it('still prices a stay that carries no hotel name', async () => {
      renderCheckout(`/checkout?${STAY_QUERY.replace('&hotelName=Marina%20Bay%20Sands', '')}`);

      expect(await waitForQuote()).toBeInTheDocument();
    });
  });

  it('renders the server-priced quote', async () => {
    renderCheckout();

    expect(await waitForQuote()).toBeInTheDocument();
    expect(screen.getByText(/3 nights/)).toBeInTheDocument();
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('Deluxe King')).toBeInTheDocument();
  });

  /** A supplier room id is an opaque UUID. */
  it('shows the room name rather than the supplier id', async () => {
    server.use(
      http.get('*/api/bookings/checkout', () =>
        HttpResponse.json({
          ...QUOTE,
          roomTypes: ['2eb243ba-2f54-561b-8069-0db1439138f1'],
          roomLabels: ['Premier Courtyard Room King'],
        })
      )
    );

    renderCheckout();

    expect(await screen.findByText('Premier Courtyard Room King')).toBeInTheDocument();
    expect(screen.queryByText(/2eb243ba/)).not.toBeInTheDocument();
  });

  /** A quote minted before roomLabels existed must still render its rooms. */
  it('falls back to the room id when the quote carries no labels', async () => {
    const { roomLabels: _omitted, ...withoutLabels } = QUOTE;

    server.use(
      http.get('*/api/bookings/checkout', () => HttpResponse.json(withoutLabels))
    );

    renderCheckout();

    expect(await screen.findByText('deluxe-king')).toBeInTheDocument();
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
    vi.spyOn(checkoutHandoff, 'writeHandoff').mockImplementation(() => {
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /pay sgd/i })).toBeEnabled()
    );
  });

  it('says a payment was cancelled and charges nothing', async () => {
    // /payment sends the customer back here with ?cancelled=1 rather than
    // leaving them on a payment form that has already been abandoned.
    renderCheckout(`/checkout?${STAY_QUERY}&cancelled=1`);

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
