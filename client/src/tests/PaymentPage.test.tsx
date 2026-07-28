import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { delay, http, HttpResponse } from 'msw';
import { server } from './setup';
import PaymentPage from '../pages/PaymentPage';

/**
 * UC4 payment page — the step that used to be a redirect to Stripe.
 *
 * Unlike CheckoutPage, this page *does* render card inputs when the server
 * reports it is simulating, so "there is no card field" is not the invariant
 * that can be asserted here. The invariant that replaces it is stronger and is
 * what the bulk of this file is about: whatever is typed into those inputs must
 * never leave the browser. The form derives brand and last four locally and
 * sends only those, so the number itself is not on the wire, is not in a log,
 * and cannot be captured by anything downstream of this component.
 *
 * Every request the page makes is recorded off MSW's own lifecycle events
 * rather than off individual handlers, so a leak to an endpoint nobody thought
 * to mock is caught too — that is precisely the shape a card-data leak takes.
 *
 * Stripe is stubbed at the module boundary. Elements needs a live client secret
 * and a network round trip to stripe.com; the suite stays offline, so the parts
 * under test are our own — which branch mounts, what confirmPayment is asked
 * for, and where each outcome routes.
 *
 * Handlers use wildcard origins so the suite does not depend on VITE_API_URL
 * being present in a local .env.
 */

const stripeStub = vi.hoisted(() => {
  /**
   * PaymentPage decides at module scope whether Stripe is available at all, by
   * reading VITE_STRIPE_PUBLISHABLE_KEY. Stubbing it before the import makes
   * both branches reachable; which one actually mounts is then the server's
   * call, carried on `simulated` in the intent response, exactly as in
   * production. A client that could pick for itself could ask for the demo
   * form against live Stripe.
   */
  vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_suite');
  return { confirmPayment: vi.fn() };
});

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({ __brand: 'fake-stripe' })),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  /**
   * Stands in for the cross-origin iframes. Their whole point is that nothing
   * in our tree can read them, so there is nothing here worth simulating —
   * except onReady, which the page now gates the Pay button on. The real
   * element fires it once its iframes mount; a stub that never does would leave
   * the button permanently disabled and make every payment test fail for a
   * reason that has nothing to do with what it is testing.
   */
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    useEffect(() => onReady?.(), [onReady]);
    return <div data-testid="stripe-payment-element" />;
  },
  useStripe: () => ({ confirmPayment: stripeStub.confirmPayment }),
  useElements: () => ({ __brand: 'fake-elements' }),
}));

/** The key CheckoutPage writes and this page reads. */
const HANDOFF_KEY = 'transcenda:checkout';

const HANDOFF = {
  guestDetails: {
    salutation: 'Dr',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
    specialRequests: 'High floor, away from the lift',
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

/**
 * The server's answer to POST /payment-intent. `amount` is display only — the
 * confirm step reprices from the intent's metadata — and `simulated` is what
 * chooses the card UI. No digit run in here is 13 long, so the PAN assertions
 * below cannot be satisfied by fixture noise.
 */
const INTENT = {
  clientSecret: 'pi_sim_abc_secret_simulated',
  paymentIntentId: 'pi_sim_abc',
  amount: 1308,
  currency: 'SGD',
  simulated: true,
  /**
   * The priced stay behind `amount`, which the booking summary renders.
   *
   * Deliberately consistent with it — 240 × 5 nights = 1200, +9% = 1308 — because
   * the whole point of taking the summary from the intent response rather than
   * from the sessionStorage handoff is that the figures cannot disagree.
   */
  quote: {
    ...HANDOFF.stay,
    endDate: '2026-08-06',
    nights: 5,
    currency: 'SGD',
    roomLabels: ['Deluxe King'],
    nightlyRates: [240],
    nightlyTotal: 240,
    subtotal: 1200,
    taxes: 108,
    totalPrice: 1308,
  },
};

const AMOUNT_TEXT = 'SGD 1,308.00';

const intentHandler = (overrides: Partial<typeof INTENT> = {}) =>
  http.post('*/api/bookings/payment-intent', () => HttpResponse.json({ ...INTENT, ...overrides }));

const confirmHandler = () =>
  http.post('*/api/bookings/confirm', () =>
    HttpResponse.json({ booking: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' } })
  );

/** Every request the browser actually made, in order, with its body. */
interface WireRecord {
  url: string;
  method: string;
  body: string;
}

let wire: WireRecord[] = [];

const onRequestStart = async ({ request }: { request: Request }) => {
  wire.push({
    url: request.url,
    method: request.method,
    body: await request.clone().text(),
  });
};

const requestsTo = (fragment: string) => wire.filter((entry) => entry.url.includes(fragment));

/** Everything that left the browser, flattened, for the leak assertions. */
const everythingSent = () => wire.map((entry) => `${entry.url} ${entry.body}`).join('\n');

/** Every key name anywhere in a decoded body, however deeply nested. */
const keysDeep = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      keysDeep(nested, found);
    }
  }
  return found;
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

const renderPayment = (entry = '/payment') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/checkout" element={<div>checkout page</div>} />
        <Route path="/confirmation" element={<div>confirmation page</div>} />
      </Routes>
    </MemoryRouter>
  );

const currentUrl = () => screen.getByTestId('location').textContent ?? '';

type User = ReturnType<typeof userEvent.setup>;

/** Resolves once the intent has been minted and the demo form is live. */
const waitForDemoForm = () => screen.findByLabelText(/card number/i);

const typeCardNumber = async (user: User, digits: string) => {
  const field = await waitForDemoForm();
  await user.clear(field);
  await user.type(field, digits);
  return field;
};

const payButton = () => screen.getByRole('button', { name: /^pay /i });

describe('PaymentPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(HANDOFF));

    wire = [];
    server.events.on('request:start', onRequestStart);

    stripeStub.confirmPayment.mockReset();
    server.use(intentHandler(), confirmHandler());
  });

  afterEach(() => {
    server.events.removeListener('request:start', onRequestStart);
    sessionStorage.clear();
  });

  describe('preparing the payment', () => {
    it('shows a loading state until the server has minted an intent', async () => {
      server.use(
        http.post('*/api/bookings/payment-intent', async () => {
          await delay(50);
          return HttpResponse.json(INTENT);
        })
      );

      renderPayment();

      expect(screen.getByText(/preparing secure payment/i)).toBeInTheDocument();
      await waitForDemoForm();
      expect(screen.queryByText(/preparing secure payment/i)).not.toBeInTheDocument();
    });

    it('renders the amount the server priced, not one carried from checkout', async () => {
      // The handoff deliberately contains no price. Whatever this page shows has
      // to have come back from /payment-intent, so a figure appearing before the
      // response would mean the client had priced the stay itself.
      renderPayment();
      await waitForDemoForm();

      // Three places now — the header, the summary total and the pay button —
      // and they are all the same server figure. getByText would fail on the
      // ambiguity rather than on anything being wrong.
      expect(screen.getAllByText(AMOUNT_TEXT).length).toBeGreaterThan(0);
      expect(payButton()).toHaveTextContent(AMOUNT_TEXT);
    });

    it('sends the guest and stay and nothing priced', async () => {
      renderPayment();
      await waitForDemoForm();

      const [intentRequest] = requestsTo('/api/bookings/payment-intent');
      expect(intentRequest).toBeDefined();

      const body = JSON.parse(intentRequest.body);
      expect(Object.keys(body).sort()).toEqual(['guestDetails', 'stay']);
      expect(body).toEqual(HANDOFF);
      expect(intentRequest.body).not.toMatch(
        /totalPrice|nightlyRate|nightlyTotal|subtotal|"amount"/
      );
    });

    it('tells a customer whose handoff has gone that it has, without calling the API', async () => {
      // A refresh survives, because the handoff is in sessionStorage. A new tab,
      // a bookmarked /payment, or a session that has been cleared does not — and
      // there is nothing to pay for, so asking the server would only produce an
      // intent for a stay nobody selected.
      sessionStorage.clear();

      renderPayment();

      expect(
        await screen.findByText(/your booking details have expired\. please start again\./i)
      ).toBeInTheDocument();
      expect(requestsTo('/api/bookings')).toEqual([]);

      /**
       * Two links out: the persistent nav one and the error card's own recovery
       * action, so the dead end is escapable without the back button.
       *
       * To search, not to details. This case *is* "there are no details" — the
       * handoff is what /checkout would have been resumed from, and without it
       * that page can only say the link is missing every parameter. Offering
       * "back to details" here sent the customer from one dead end to another,
       * which is why the destination is asserted and not just the count.
       */
      const escapes = screen.getAllByRole('link', { name: /back to search/i });
      expect(escapes).toHaveLength(2);
      escapes.forEach((link) => expect(link).toHaveAttribute('href', '/'));
      expect(screen.queryByRole('link', { name: /back to details/i })).toBeNull();
    });

    /**
     * "Back to details" has to carry the stay, or it is not a way back.
     *
     * /checkout reads its stay from the URL, so a bare link lands on "this
     * checkout link is missing destinationId, hotelId, …" — the customer is off
     * the payment page and cannot return to it. The query is what lets that page
     * price the stay again and resume at the review step.
     */
    it('links back to the details page with the stay it needs', async () => {
      renderPayment();

      const [link] = await screen.findAllByRole('link', { name: /back to details/i });
      const href = link.getAttribute('href') ?? '';

      expect(href.startsWith('/checkout?')).toBe(true);
      const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
      expect(Object.fromEntries(params)).toMatchObject({
        destinationId: 'dest-1',
        hotelId: 'marina-bay',
        roomTypes: 'deluxe-king',
        startDate: '2026-08-01',
        endDate: '2026-08-04',
        adults: '2',
        children: '1',
      });
    });

    /**
     * A stay object that is present but incomplete used to pass the handoff
     * guard and then throw inside render when the back link was built. There is
     * no ErrorBoundary in this bundle, so a throw during render unmounts the
     * whole tree: the customer gets a blank white page, not an error.
     */
    it('treats a handoff with an unusable stay as no handoff at all', async () => {
      sessionStorage.setItem(
        HANDOFF_KEY,
        JSON.stringify({ ...HANDOFF, stay: { hotelId: 'marina-bay' } })
      );

      renderPayment();

      expect(
        await screen.findByText(/your booking details have expired\. please start again\./i)
      ).toBeInTheDocument();
      expect(requestsTo('/api/bookings')).toEqual([]);
    });

    it.each([
      [400, { error: 'That room type is not available.' }, 'That room type is not available.'],
      [503, { error: 'Payments are not available right now.' }, 'Payments are not available right now.'],
      [500, {}, 'We could not start your payment.'],
    ])(
      'reports a %i from the intent endpoint as an error with a way back',
      async (status, payload, expected) => {
        server.use(
          http.post('*/api/bookings/payment-intent', () =>
            HttpResponse.json(payload, { status })
          )
        );

        renderPayment();

        expect(await screen.findByText(expected)).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { name: /we can't take payment yet/i })
        ).toBeInTheDocument();
        // No form to submit, so the only thing on offer must be the way out.
        expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: /back to details/i })).toHaveLength(2);
      }
    );

    it('reports an unreachable payment service rather than a blank form', async () => {
      server.use(http.post('*/api/bookings/payment-intent', () => HttpResponse.error()));

      renderPayment();

      expect(
        await screen.findByRole('heading', { name: /we can't take payment yet/i })
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();

      // Axios reports a transport failure as an AxiosError with no `response`,
      // so this lands on the same generic wording as a 500 rather than on the
      // page's "could not reach the payment service" string. Asserted as-is
      // because it is what a customer sees; see the note in the report.
      expect(screen.getByText('We could not start your payment.')).toBeInTheDocument();
    });

    it('says a cancelled payment charged nothing', async () => {
      renderPayment('/payment?cancelled=1');

      expect(await screen.findByText(/you cancelled the payment/i)).toBeInTheDocument();
      expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument();
    });
  });

  /**
   * The last screen before money moves. Checkout showed the same stay, but the
   * customer has crossed a page boundary since and is about to commit a card
   * against it — a wrong-dates booking that survives this page is paid for.
   */
  describe('booking summary', () => {
    const summary = () => screen.getByRole('complementary', { name: /booking summary/i });

    it('shows the stay the payment is for', async () => {
      renderPayment();
      await waitForDemoForm();

      const panel = within(summary());
      expect(panel.getByText('Marina Bay Sands')).toBeInTheDocument();
      expect(panel.getByText('Deluxe King')).toBeInTheDocument();
      // The night count is on the dates line and again in the price breakdown,
      // so it has to be asserted against one of them rather than on its own.
      expect(panel.getByText(/2026-08-01/)).toHaveTextContent('5 nights');
      expect(panel.getByText(/2 adults, 1 child/)).toBeInTheDocument();
      expect(panel.getByText('Dr Jane Tan')).toBeInTheDocument();
    });

    it('itemises the price so the total is not a bare figure', async () => {
      renderPayment();
      await waitForDemoForm();

      const panel = within(summary());
      expect(panel.getByText('SGD 1,200.00')).toBeInTheDocument();
      expect(panel.getByText('SGD 108.00')).toBeInTheDocument();
      expect(panel.getByText('SGD 1,308.00')).toBeInTheDocument();
    });

    /**
     * The summary must come from the intent response, not the handoff. The
     * browser carries the stay across the two pages but never the price, and a
     * summary assembled from sessionStorage could show a stay the server never
     * priced.
     */
    it('renders the served quote even when it disagrees with the handoff', async () => {
      server.use(
        intentHandler({
          quote: { ...INTENT.quote, hotelName: 'Raffles Hotel', totalPrice: 999, taxes: 82.5, subtotal: 916.5 },
          amount: 999,
        })
      );

      renderPayment();
      await waitForDemoForm();

      const panel = within(summary());
      // The handoff still says Marina Bay Sands.
      expect(panel.getByText('Raffles Hotel')).toBeInTheDocument();
      expect(panel.getByText('SGD 999.00')).toBeInTheDocument();
    });

    /**
     * A quote-less response is what an older server sends. Reading
     * quote.currency off undefined throws during render, React unmounts the
     * tree, and the customer gets a blank page with no error — the exact shape
     * of the drift that blanked checkout once already.
     */
    it('still renders the card form when the response carries no quote', async () => {
      const { quote: _omitted, ...withoutQuote } = INTENT;
      server.use(
        http.post('*/api/bookings/payment-intent', () => HttpResponse.json(withoutQuote))
      );

      renderPayment();

      expect(await waitForDemoForm()).toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: /booking summary/i })).toBeNull();
    });

    it('shows a supplier room name rather than its opaque id', async () => {
      server.use(
        intentHandler({
          quote: {
            ...INTENT.quote,
            roomTypes: ['2eb243ba-2f54-561b-8069-0db1439138f1'],
            roomLabels: ['Premier Courtyard Room King'],
          },
        })
      );

      renderPayment();
      await waitForDemoForm();

      const panel = within(summary());
      expect(panel.getByText('Premier Courtyard Room King')).toBeInTheDocument();
      expect(panel.queryByText(/2eb243ba/)).toBeNull();
    });
  });

  describe('demo card form', () => {
    it('mounts the demo form, not Elements, when the server says it is simulating', async () => {
      // The publishable key is stubbed in for this whole file, so this is the
      // case that proves the server's `simulated` flag wins over the client's
      // own configuration rather than merely agreeing with it.
      renderPayment();
      await waitForDemoForm();

      expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
      expect(screen.getByText(/no money moves and no card is stored/i)).toBeInTheDocument();
      expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stripe-payment-element')).not.toBeInTheDocument();
    });

    it('prefills a working test card so the demo is walkable', async () => {
      renderPayment();

      expect(await waitForDemoForm()).toHaveValue('4242 4242 4242 4242');
      expect(screen.getByLabelText(/expiry/i)).toHaveValue('12/30');
      expect(screen.getByLabelText(/cvc/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/name on card/i)).toBeInTheDocument();
    });

    it.each([
      ['Visa — succeeds', '4242 4242 4242 4242'],
      ['Mastercard — succeeds', '5555 5555 5555 4444'],
      ['Visa — declined', '4000 0000 0000 0002'],
    ])('fills the card number from the "%s" shortcut', async (label, expected) => {
      const user = userEvent.setup();
      renderPayment();
      await waitForDemoForm();

      await user.click(screen.getByRole('button', { name: label }));

      expect(screen.getByLabelText(/card number/i)).toHaveValue(expected);
    });

    /**
     * The property this whole page is judged on.
     *
     * The demo form has to accept a PAN — there is no Stripe iframe to take it
     * — so the boundary moves from "no field exists" to "the field's contents
     * never leave the tab". Asserted against everything the browser sent, not
     * just the request we expected it to send.
     */
    it('never puts the card number on the wire', async () => {
      const typed = '4242424242424242';
      const user = userEvent.setup();

      renderPayment();
      await typeCardNumber(user, typed);
      await user.click(payButton());

      await screen.findByText('confirmation page');

      const [confirm] = requestsTo('/api/bookings/confirm');
      expect(confirm).toBeDefined();

      const body = JSON.parse(confirm.body);
      expect(body.demoCard).toEqual({
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      });
      expect(body.demoCard.last4).toBe(typed.slice(-4));
      expect(body.paymentIntentId).toBe(INTENT.paymentIntentId);

      const sent = everythingSent();

      // The number itself, in both the form it was typed in and the form it is
      // displayed in.
      expect(sent).not.toContain(typed);
      expect(sent).not.toContain('4242 4242 4242 4242');

      // And nothing PAN-shaped at all: no run of 13 or more digits anywhere,
      // which covers a number this test did not think to spell out — including
      // one smuggled through a field with an innocent name.
      expect(sent).not.toMatch(/\d{13,}/);

      // Nor a key that would carry one. `demoCard` is the only card-adjacent
      // name permitted, and it holds four fields and no number.
      const keys = keysDeep(body);
      expect(keys.filter((key) => /^(cardnumber|card_number|pan|number|cvc|cvv|card)$/i.test(key)))
        .toEqual([]);
      expect(Object.keys(body.demoCard).sort()).toEqual([
        'brand',
        'expMonth',
        'expYear',
        'last4',
      ]);
    });

    /**
     * Guards the guard. Every PAN assertion above is a negative one, and a
     * negative assertion passes just as happily when the recorder is empty or
     * the pattern is wrong as when the code is clean. This drives a PAN through
     * the same recorder deliberately and requires the detector to catch it, so
     * "no card number was sent" cannot quietly become "nothing was inspected".
     */
    it('detects a card number on the wire when there is one to detect', async () => {
      const planted = '4242424242424242';

      server.use(
        http.post('*/api/leak-canary', () => HttpResponse.json({ ok: true }))
      );

      renderPayment();
      await waitForDemoForm();

      await fetch('http://localhost:5000/api/leak-canary', {
        method: 'POST',
        body: JSON.stringify({ cardNumber: planted }),
      });

      await waitFor(() => expect(requestsTo('/api/leak-canary')).toHaveLength(1));

      const sent = everythingSent();
      expect(sent).toContain(planted);
      expect(sent).toMatch(/\d{13,}/);
      expect(keysDeep(JSON.parse(requestsTo('/api/leak-canary')[0].body))).toContain('cardNumber');
    });

    it.each([
      ['4242424242424242', 'visa', '4242'],
      ['4000056655665556', 'visa', '5556'],
      ['5555555555554444', 'mastercard', '4444'],
      ['5105105105105100', 'mastercard', '5100'],
      // The 2-series BIN range Mastercard added in 2017. A brand check written
      // as "starts with 5" silently mislabels every one of these.
      ['2223003122003222', 'mastercard', '3222'],
      // 15 digits, and the only brand that is not 16 — a hard-coded length
      // check would reject it before the brand was ever derived.
      ['378282246310005', 'amex', '0005'],
      ['371449635398431', 'amex', '8431'],
    ])('derives %s locally as %s ending %s', async (typed, brand, last4) => {
      const user = userEvent.setup();

      renderPayment();
      await typeCardNumber(user, typed);
      await user.click(payButton());

      await screen.findByText('confirmation page');

      const [confirm] = requestsTo('/api/bookings/confirm');
      const body = JSON.parse(confirm.body);

      expect(body.demoCard.brand).toBe(brand);
      expect(body.demoCard.last4).toBe(last4);
      expect(body.demoCard.last4).toBe(typed.slice(-4));

      // Derived here, so the number that produced it stayed here.
      expect(everythingSent()).not.toContain(typed);
      expect(everythingSent()).not.toMatch(/\d{13,}/);
    });

    it('declines the decline card locally, with no request and no navigation', async () => {
      // Stripe's published decline number. The demo has no gateway to ask, so
      // the failure path has to be walkable without one — and walking it must
      // not create a booking, or the E2E decline spec would confirm a payment
      // that never happened.
      const user = userEvent.setup();

      renderPayment();
      await waitForDemoForm();
      await user.click(screen.getByRole('button', { name: 'Visa — declined' }));
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /your card was declined\. please try a different payment method\./i
      );

      expect(requestsTo('/api/bookings/confirm')).toEqual([]);
      expect(currentUrl()).toBe('/payment');
      expect(screen.queryByText('confirmation page')).not.toBeInTheDocument();

      // Still payable: the handoff survives so a second card can be tried.
      expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
      expect(payButton()).toBeEnabled();
    });

    it('rejects a too-short number without asking the server', async () => {
      const user = userEvent.setup();

      renderPayment();
      await typeCardNumber(user, '4242');
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/too short/i);
      expect(requestsTo('/api/bookings/confirm')).toEqual([]);
      expect(everythingSent()).not.toContain('4242');
    });

    it('rejects an impossible expiry without asking the server', async () => {
      const user = userEvent.setup();

      renderPayment();
      await waitForDemoForm();

      const expiry = screen.getByLabelText(/expiry/i);
      await user.clear(expiry);
      await user.type(expiry, '1330');
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(/mm\/yy/i);
      expect(requestsTo('/api/bookings/confirm')).toEqual([]);
    });

    it('clears the handoff and routes to the confirmation with the intent id', async () => {
      // The id is what the confirmation page hands back for server-side
      // verification, so it has to survive the navigation intact — and the
      // handoff has to go, or a back-navigation could mint a second intent for
      // a stay that has already been paid for.
      const user = userEvent.setup();

      renderPayment();
      await waitForDemoForm();
      await user.click(payButton());

      expect(await screen.findByText('confirmation page')).toBeInTheDocument();
      expect(currentUrl()).toBe(`/confirmation?payment_intent=${INTENT.paymentIntentId}`);
      expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
    });

    it('keeps the customer on the form when the confirm call fails', async () => {
      server.use(
        http.post('*/api/bookings/confirm', () =>
          HttpResponse.json({ error: 'That payment could not be recorded.' }, { status: 502 })
        )
      );

      const user = userEvent.setup();

      renderPayment();
      await waitForDemoForm();
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /that payment could not be recorded\./i
      );
      expect(currentUrl()).toBe('/payment');

      // The handoff is still there, so retrying does not need a fresh checkout.
      expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
      expect(payButton()).toBeEnabled();
    });
  });

  describe('Stripe Elements', () => {
    const mountElements = async () => {
      server.use(intentHandler({ simulated: false }));
      renderPayment();
      return screen.findByTestId('stripe-payment-element');
    };

    it('mounts Elements and no card inputs of our own', async () => {
      await mountElements();

      expect(screen.getByTestId('stripe-elements')).toBeInTheDocument();

      // The real boundary in this branch: the fields live in Stripe's iframes,
      // so our tree must own nothing that can hold a PAN.
      expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/cvc/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/demo mode/i)).not.toBeInTheDocument();
      expect(document.querySelectorAll('input')).toHaveLength(0);

      expect(payButton()).toHaveTextContent(AMOUNT_TEXT);
    });

    it('confirms browser-to-Stripe and stays put unless the bank demands 3DS', async () => {
      stripeStub.confirmPayment.mockResolvedValue({
        paymentIntent: { id: INTENT.paymentIntentId, status: 'succeeded' },
      });

      const user = userEvent.setup();
      await mountElements();
      await user.click(payButton());

      await screen.findByText('confirmation page');

      expect(stripeStub.confirmPayment).toHaveBeenCalledTimes(1);
      const [args] = stripeStub.confirmPayment.mock.calls[0];

      // redirect: 'if_required' is what keeps an ordinary card on this page;
      // without it every payment bounces through Stripe and back.
      expect(args.redirect).toBe('if_required');
      // The return_url only matters when it *is* required, which is exactly
      // when nobody is watching — so a wrong one strands the 3DS customers.
      expect(args.confirmParams.return_url).toContain(
        `/confirmation?payment_intent=${INTENT.paymentIntentId}`
      );
    });

    it('routes to the confirmation and clears the handoff on success', async () => {
      stripeStub.confirmPayment.mockResolvedValue({
        paymentIntent: { id: INTENT.paymentIntentId, status: 'succeeded' },
      });

      const user = userEvent.setup();
      await mountElements();
      await user.click(payButton());

      expect(await screen.findByText('confirmation page')).toBeInTheDocument();
      expect(currentUrl()).toBe(`/confirmation?payment_intent=${INTENT.paymentIntentId}`);
      expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();

      // This branch does not confirm server-side itself: the booking is written
      // when the confirmation page presents the intent id, or by the webhook,
      // whichever lands first.
      expect(requestsTo('/api/bookings/confirm')).toEqual([]);
    });

    it("relays Stripe's own decline message without navigating", async () => {
      // Card errors from Stripe are customer-safe and specific, so they are
      // shown verbatim. API errors never reach this branch.
      stripeStub.confirmPayment.mockResolvedValue({
        error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
      });

      const user = userEvent.setup();
      await mountElements();
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
      expect(currentUrl()).toBe('/payment');
      expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
      expect(payButton()).toBeEnabled();
    });

    it('falls back to its own wording when Stripe returns an error with no message', async () => {
      stripeStub.confirmPayment.mockResolvedValue({ error: { type: 'api_error' } });

      const user = userEvent.setup();
      await mountElements();
      await user.click(payButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /that payment could not be completed\./i
      );
      expect(currentUrl()).toBe('/payment');
    });

    it('sends nothing but the intent request from this page', async () => {
      // Everything card-shaped goes browser→Stripe through the iframes, which
      // our origin cannot read. Our own traffic in this branch is one call.
      stripeStub.confirmPayment.mockResolvedValue({
        paymentIntent: { id: INTENT.paymentIntentId, status: 'succeeded' },
      });

      const user = userEvent.setup();
      await mountElements();
      await user.click(payButton());
      await screen.findByText('confirmation page');

      await waitFor(() => expect(requestsTo('/api/bookings')).toHaveLength(1));
      expect(requestsTo('/api/bookings')[0].url).toContain('/payment-intent');
      expect(everythingSent()).not.toMatch(/\d{13,}/);
    });
  });
});
