import crypto from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

/**
 * UC4 — Book & Make Payment, end to end against the Dockerised stack.
 *
 * The server suites prove each layer in isolation and nock proves the Stripe
 * contract, but neither runs the browser. Only this level catches a route that
 * does not resolve, a redirect that lands nowhere, or an API the deployed client
 * cannot reach — the CORS allowlist regression that silently emptied the
 * destination dropdown was exactly that shape and no unit test could have seen it.
 *
 * Runs against whichever card UI the server mounts, detected per test: the
 * demo form under PAYMENTS_MODE=simulate, or real Stripe Elements when the
 * server holds Stripe keys. Only Stripe's published test numbers are ever
 * typed, so no card entered here can move money in either mode.
 *
 * That makes this the only level at which the card-number invariant can be
 * observed for real: a PAN is typed into a browser, and the assertion is that
 * it does not appear in anything the browser sends. Recorded off the wire, not
 * off a mock.
 *
 * Every route these specs navigate to must also be listed in the ROUTES array in
 * global-setup.ts — /payment included. Vite transforms modules on demand, so the
 * first spec to reach a cold route gets a blank page and a timeout that reads as
 * flakiness.
 */

/** Mirrors CheckoutPage's fallbacks: hotelId, hotelName and roomTypes all default. */
const CHECKOUT_URL =
  '/checkout?destinationId=dest-1&hotelId=marina-bay&hotelName=Marina%20Bay%20Sands' +
  '&roomTypes=deluxe-king&startDate=2026-08-01&endDate=2026-08-04&adults=2&children=1';

/**
 * Exactly what RoomList builds when a guest picks a room — see its handleSelect.
 * BookingEntry translates this into the checkout contract.
 */
const ROOM_LIST_HANDOFF =
  '/booking?hotel=marina-bay&dest=dest-1&in=2026-08-15&out=2026-08-20' +
  '&guests=2&key=deluxe-king&name=Marina%20Bay%20Sands';

/** A well-formed UUID that no booking will ever have. */
const ABSENT_BOOKING_ID = '00000000-0000-4000-8000-000000000000';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BILLING = {
  line1: '10 Bayfront Avenue',
  line2: '#12-34',
  city: 'Singapore',
  postalCode: '018956',
  country: 'SG',
};

const GUEST = {
  salutation: 'Dr',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
  specialRequests: 'High floor, away from the lift',
};

/**
 * Deliberately not the prefilled 4242. Typing a different brand proves two
 * things at once: that brand and last four are derived in the browser and
 * survive all the way into the stored row, and that the sixteen digits they
 * were derived from do not.
 */
const TYPED_CARD = '5555555555554444';
const TYPED_CARD_DISPLAYED = '5555 5555 5555 4444';

/** Every API request the browser actually made, body included. */
interface ApiPost {
  path: string;
  body: string;
}

/**
 * Recorded rather than asserted inline: a request has to be observed as it
 * leaves the real browser, and it is gone by the time the page settles.
 */
const recordApiPosts = (page: Page): ApiPost[] => {
  const posts: ApiPost[] = [];

  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/api/')) return;
    posts.push({ path: pathname, body: request.postData() ?? '' });
  });

  return posts;
};

/**
 * A distinct address per booking. preparePayment folds the guest email into
 * Stripe's idempotency key, so two tests booking the same stay with the same
 * email are handed back the *same* PaymentIntent — and once one of them has
 * confirmed it, Elements refuses to mount against a terminal intent. Real
 * customers differ; the fixtures must too.
 */
const uniqueEmail = () =>
  `jane+e2e${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}@example.com`;

const fillGuestDetails = async (page: Page, overrides: Partial<typeof GUEST> = {}) => {
  const guest = { email: uniqueEmail(), ...GUEST, ...overrides };
  if (!overrides.email) guest.email = uniqueEmail();

  await page.getByRole('combobox', { name: /salutation/i }).selectOption(guest.salutation);
  await page.getByPlaceholder('As it appears on your passport').fill(guest.firstName);
  await page.getByPlaceholder('Family name').fill(guest.lastName);
  await page.getByPlaceholder('you@example.com').fill(guest.email);
  await page.getByPlaceholder('+65 9123 4567').fill(guest.phone);

  if (guest.specialRequests) {
    await page.getByPlaceholder('High floor').fill(guest.specialRequests);
  }

  // Billing is part of this step now — Stripe runs an AVS check against it and
  // the server refuses the step without it.
  await page.getByPlaceholder('10 Bayfront Avenue').fill(BILLING.line1);
  await page.getByPlaceholder('Unit, floor, building').fill(BILLING.line2);
  await page.getByPlaceholder('Singapore', { exact: true }).fill(BILLING.city);
  await page.getByPlaceholder('018956').fill(BILLING.postalCode);
  await page.getByRole('combobox', { name: /billing country/i }).selectOption(BILLING.country);
};

/** Which card UI the server mounted: the demo form (simulate) or real Stripe Elements. */
type PaymentUI = 'demo' | 'elements';

const STRIPE_FRAME = 'iframe[title*="Secure payment input"]';

/** Waits for either card UI and reports which one mounted. */
const detectPaymentUI = async (page: Page): Promise<PaymentUI> => {
  const demo = page.getByText('Demo mode.', { exact: true });
  const frame = page.locator(STRIPE_FRAME).first();
  // Generous: under parallel workers Stripe.js and its iframes contend for the
  // same CPU as three other browsers and a Vite dev server.
  await expect(demo.or(frame)).toBeVisible({ timeout: 60000 });
  return (await demo.isVisible()) ? 'demo' : 'elements';
};

/**
 * Types a card into whichever UI mounted. Only Stripe's published test
 * numbers ever pass through here — they cannot move real money in any mode.
 */
const fillCard = async (page: Page, ui: PaymentUI, number: string) => {
  if (ui === 'demo') {
    await page.locator('#demo-card-number').fill(number);
    return;
  }
  // Several Stripe iframes share the title; the card inputs live in exactly
  // one of them, found by asking each for the number field.
  const findCardFrame = async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const count = await page.locator(STRIPE_FRAME).count();
      for (let i = 0; i < count; i++) {
        const cand = page.frameLocator(STRIPE_FRAME).nth(i);
        if (await cand.locator('[name="number"]').isVisible().catch(() => false)) return cand;
      }
      await page.waitForTimeout(250);
    }
    throw new Error('No Stripe frame with a card number field appeared');
  };
  const f = await findCardFrame();
  // Stripe's controlled inputs ignore programmatic value-setting; they need
  // real keystrokes.
  const type = async (name: string, value: string) => {
    const field = f.locator(`[name="${name}"]`);
    await field.click();
    // Keystrokes only — Stripe's controlled inputs ignore programmatic
    // value-setting, so clearing must be typed too.
    await field.press('ControlOrMeta+a');
    await field.press('Backspace');
    await field.pressSequentially(value, { delay: 25 });
    await expect(field).not.toHaveValue('');
  };
  await type('number', number);
  await type('expiry', '1234');
  await type('cvc', '123');
  const country = f.locator('select[name="country"]');
  if (await country.isVisible().catch(() => false)) {
    await country.selectOption('SG').catch(() => {});
  }
  const postal = f.locator('[name="postalCode"]');
  if (await postal.isVisible().catch(() => false)) {
    await postal.fill('018956');
  }
};

/**
 * Presses Pay. Under Elements the event is dispatched straight to the button:
 * Stripe mounts overlay iframes (Link, invisible hCaptcha) whose boxes sit over
 * ours, so a coordinate click lands on them and never reaches the form. Real
 * users are unaffected — the overlays pass pointer events through — but
 * Playwright's hit-testing resolves to the topmost box.
 */
const clickPay = async (page: Page, ui: PaymentUI) => {
  const button = page.getByRole('button', { name: /pay sgd/i });
  await expect(button).toBeEnabled();
  if (ui === 'demo') {
    await button.click();
    return;
  }
  await button.dispatchEvent('click');
};

/**
 * Walks checkout end to end and leaves the browser on /payment with a card UI
 * mounted. The handoff travels in sessionStorage, so /payment is only
 * reachable this way — going straight there shows the expired message instead.
 */
const reachPaymentPage = async (page: Page): Promise<PaymentUI> => {
  await page.goto(CHECKOUT_URL);
  await fillGuestDetails(page);
  await page.getByRole('button', { name: /continue to payment/i }).click();
  await page.getByRole('button', { name: /pay sgd/i }).click();

  await expect(page).toHaveURL(/.*\/payment/, { timeout: 15000 });
  return detectPaymentUI(page);
};

test.describe('Booking Flow', () => {
  test('User can search, book and reach a confirmed reservation', async ({ page }) => {
    test.setTimeout(120_000); // real Stripe round trips under Elements
    const apiPosts = recordApiPosts(page);

    // ─── 1. Enter through the seam RoomList uses ────────────
    // The /results placeholder is gone — the real page arrives with Feature 2 —
    // so this now starts where hotel details hands off, which is the join that
    // can actually break at merge time. RoomList's exact parameter spelling.
    await page.goto(ROOM_LIST_HANDOFF);
    await expect(page).toHaveURL(/.*checkout/, { timeout: 15000 });

    // The single `guests` count SearchForm emits is carried through as adults.
    await expect(page.getByText('2 adults')).toBeVisible({ timeout: 15000 });

    // ─── 3. Guest details (sequence step 3) ─────────────────
    await expect(page.getByText("Who's staying?")).toBeVisible();
    await fillGuestDetails(page);
    await page.getByRole('button', { name: /continue to payment/i }).click();

    // ─── 4. Review step, priced by the server ───────────────
    await expect(page.getByText('Review and pay')).toBeVisible();
    // Salutation and the two name parts are three separate columns, so they have
    // to survive the form as three separate values.
    await expect(page.getByText('Dr Jane Tan')).toBeVisible();
    await expect(page.getByText(GUEST.specialRequests)).toBeVisible();

    const payButton = page.getByRole('button', { name: /pay sgd/i });
    await expect(payButton).toBeVisible();

    // 5 nights × SGD 240 = 1200, +9% tax = 1308.00
    await expect(payButton).toContainText('1,308.00');

    // ─── 5. Hand off to the payment page ────────────────────
    await payButton.click();

    // An in-app route now, not a redirect to a Stripe-hosted page. The guest and
    // stay travel in sessionStorage; the price does not, and is re-derived here.
    await expect(page).toHaveURL(/.*\/payment/, { timeout: 15000 });
    const ui = await detectPaymentUI(page);

    // Priced by the server for a second time, from the same stay. A figure the
    // browser carried over would still read correctly here — this only holds
    // because nothing priced was in the handoff to carry.
    await expect(page.getByText('SGD 1,308.00', { exact: true }).first()).toBeVisible();

    // ─── 6. Pay with a card typed into whichever UI mounted ─
    await fillCard(page, ui, TYPED_CARD);
    if (ui === 'demo') {
      await expect(page.locator('#demo-card-number')).toHaveValue(TYPED_CARD_DISPLAYED);
    }

    const payNow = page.getByRole('button', { name: /pay sgd/i });
    await expect(payNow).toContainText('1,308.00');
    await clickPay(page, ui);

    // The intent id is minted server-side; landing here with it in the query
    // proves the browser carried back what the server issued rather than
    // assembling a reference of its own.
    await expect(page).toHaveURL(/.*confirmation\?payment_intent=(sim_)?pi_/, { timeout: 30000 });

    // ─── 7. Nothing priced, and no card number, left the browser ───
    // Not asserted as exactly one. main.tsx renders under StrictMode and this
    // stack runs Vite in dev, so the effect that mints the intent is invoked
    // twice on mount and the first response is discarded by its own cleanup.
    // Pinning the count here would encode a dev-mode artefact as a requirement;
    // what has to hold is that every one of them is priceless.
    const intentPosts = apiPosts.filter((post) => post.path === '/api/bookings/payment-intent');
    expect(intentPosts.length).toBeGreaterThanOrEqual(1);
    for (const post of intentPosts) {
      expect(post.body).not.toMatch(/totalPrice|nightlyRate|nightlyTotal|subtotal|"amount"/);
    }

    // The hosted-checkout endpoint is not part of this flow any more. Calling it
    // as well would mint a second, unpaid intent for the same stay.
    expect(apiPosts.filter((post) => post.path === '/api/bookings/payment')).toHaveLength(0);

    // Demo mode only: the form's confirm call carries derived card metadata.
    // Under real Elements the card goes browser→Stripe and our confirm call
    // carries the intent id alone.
    const demoConfirm = apiPosts.find(
      (post) => post.path === '/api/bookings/confirm' && post.body.includes('demoCard')
    );
    if (ui !== 'demo') expect(demoConfirm).toBeUndefined();
    if (ui === 'demo') {
      expect(demoConfirm).toBeDefined();
      expect(JSON.parse(demoConfirm!.body).demoCard).toMatchObject({
        brand: 'mastercard',
        last4: '4444',
        expMonth: 12,
        expYear: 2030,
      });
    }

    // The invariant, against everything the browser actually sent. The last four
    // are expected and present; the sixteen digits they came from are not, in any
    // spelling, and neither is any other PAN-length run of digits.
    const everythingSent = apiPosts.map((post) => `${post.path} ${post.body}`).join('\n');
    expect(everythingSent).not.toContain(TYPED_CARD);
    expect(everythingSent).not.toContain(TYPED_CARD_DISPLAYED);
    expect(everythingSent).not.toMatch(/\d{13,}/);

    // ─── 8. Confirmation resolves to a paid booking ─────────
    await expect(page.getByText(/You're all/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Booking ID')).toBeVisible();

    // Anchored, so this matches the id itself and nothing that merely contains it.
    const bookingIdLine = page.getByText(UUID);
    await expect(bookingIdLine).toBeVisible();
    const bookingId = (await bookingIdLine.innerText()).trim();

    // exact:true — a bare getByText('PAID') also matches "Total paid", and the
    // resulting strict-mode violation surfaces as a timeout, not a clear error.
    await expect(page.getByText('PAID', { exact: true })).toBeVisible();
    await expect(page.getByText('Total paid')).toBeVisible();
    await expect(page.getByText('SGD 1,308.00')).toBeVisible();

    // The card columns are written from what Stripe reports after the charge.
    // Simulating, there is no Stripe to report anything, so they come from the
    // brand and last four the demo form derived — which is why this reads
    // Mastercard ending 4444 and not the 4242 the form was prefilled with. The
    // round trip is the point: the derived pair reached the row, the number did
    // not reach the request that wrote it.
    await expect(page.getByText('Mastercard •••• 4444')).toBeVisible();
    await expect(page.getByText('Dr Jane Tan')).toBeVisible();

    // ─── 9. Revisit by id, the way the email links back ─────
    // No payment reference this time, so this is the GET /api/bookings/:id path
    // with no Stripe hop at all. The UUID is the only customer-facing handle a
    // booking has now that there is no reference column.
    await page.goto(`/confirmation?id=${bookingId}`);
    await expect(page.getByText(/You're all/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(bookingId)).toBeVisible();
    await expect(page.getByText('PAID', { exact: true })).toBeVisible();
    // Persisted, not merely rendered from the response the demo form got back.
    await expect(page.getByText('Mastercard •••• 4444')).toBeVisible();
  });

  test('Guest details are validated by the server before payment', async ({ page }) => {
    // Alternative flow 1a-3a: the step must hold, with per-field messages.
    await page.goto(CHECKOUT_URL);
    await expect(page.getByText("Who's staying?")).toBeVisible();

    await page.getByRole('button', { name: /continue to payment/i }).click();

    await expect(page.getByText('First name is required.')).toBeVisible();
    await expect(page.getByText('Last name is required.')).toBeVisible();
    await expect(page.getByText('Email address is required.')).toBeVisible();
    await expect(page.getByText('Contact number is required.')).toBeVisible();

    // The select is pre-set to an allowlisted value, so it cannot be the field
    // that fails — free-text salutations never reach the column.
    await expect(page.getByText(/Salutation must be one of/)).toHaveCount(0);

    // Still on step 1 — no advance on invalid input.
    await expect(page.getByRole('button', { name: /continue to payment/i })).toBeVisible();
  });

  test('An invalid email is rejected with a field-specific message', async ({ page }) => {
    await page.goto(CHECKOUT_URL);

    await fillGuestDetails(page, { email: 'notanemail' });
    await page.getByRole('button', { name: /continue to payment/i }).click();

    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
    await expect(page.getByText('First name is required.')).toHaveCount(0);
  });

  test('Special requests are optional', async ({ page }) => {
    // special_requests is the one nullable guest column, so leaving it empty has
    // to carry through validation and reach the review step.
    await page.goto(CHECKOUT_URL);

    await fillGuestDetails(page, { specialRequests: '' });
    await page.getByRole('button', { name: /continue to payment/i }).click();

    await expect(page.getByText('Review and pay')).toBeVisible();
    await expect(page.getByRole('button', { name: /pay sgd/i })).toBeVisible();
  });

  test('Occupancy reads as prose', async ({ page }) => {
    // Two integer columns, one sentence. Pluralisation and the zero-children
    // case are what a naive template gets wrong.
    await page.goto(CHECKOUT_URL);
    await expect(page.getByText('2 adults, 1 child')).toBeVisible({ timeout: 15000 });

    await page.goto(CHECKOUT_URL.replace('adults=2', 'adults=1').replace('children=1', 'children=0'));
    await expect(page.getByText('1 adult', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('Checkout renders no card field of any kind', async ({ page }) => {
    // The PCI boundary, asserted in a real browser. Card entry belongs on
    // /payment and nowhere else; a PAN input reappearing on checkout would widen
    // the scope silently, regardless of what the unit tests say.
    await page.goto(CHECKOUT_URL);
    await fillGuestDetails(page);
    await page.getByRole('button', { name: /continue to payment/i }).click();
    await expect(page.getByRole('button', { name: /pay sgd/i })).toBeVisible();

    const cardish = await page.locator('input, select, textarea').evaluateAll((fields) =>
      fields
        .map((field) => ({
          name: field.getAttribute('name') ?? '',
          autocomplete: field.getAttribute('autocomplete') ?? '',
          placeholder: field.getAttribute('placeholder') ?? '',
        }))
        .filter(
          (attrs) =>
            /card|cvc|cvv|pan|expiry/i.test(`${attrs.name} ${attrs.placeholder}`) ||
            /^cc-/i.test(attrs.autocomplete)
        )
    );

    expect(cardish).toEqual([]);
  });

  test('A declined card says so, books nothing and goes nowhere', async ({ page }) => {
    test.setTimeout(120_000); // real Stripe round trips under Elements
    // Stripe's published decline number. The demo has no gateway to ask, so the
    // form recognises it locally — which means the failure has to be complete:
    // no confirm call, no navigation, and therefore no row. A decline that
    // still reached /confirmation would show the customer a paid booking.
    const apiPosts = recordApiPosts(page);

    const ui = await reachPaymentPage(page);
    if (ui === 'demo') {
      await page.getByRole('button', { name: 'Visa — declined' }).click();
      await expect(page.locator('#demo-card-number')).toHaveValue('4000 0000 0000 0002');
    } else {
      await fillCard(page, ui, '4000000000000002');
    }

    await clickPay(page, ui);

    await expect(page.getByRole('alert')).toContainText(/declined/i, { timeout: 30000 });
    await expect(page).toHaveURL(/.*\/payment/);
    expect(apiPosts.filter((post) => post.path === '/api/bookings/confirm')).toHaveLength(0);

    // Recoverable in place: the intent is already minted, so switching cards and
    // paying is one click away rather than a trip back through checkout.
    const payButton = page.getByRole('button', { name: /pay sgd/i });
    await expect(payButton).toBeEnabled();

    if (ui === 'demo') {
      await page.getByRole('button', { name: 'Mastercard — succeeds' }).click();
    } else {
      await fillCard(page, ui, '5555555555554444');
    }
    await clickPay(page, ui);

    await expect(page).toHaveURL(/.*confirmation\?payment_intent=(sim_)?pi_/, { timeout: 30000 });
    await expect(page.getByText('PAID', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('The payment page cannot be reached without a stay to pay for', async ({ page }) => {
    // The handoff lives in sessionStorage so a refresh mid-payment survives. A
    // cold arrival has nothing, and asking the server for an intent then would
    // mint one against a booking nobody selected.
    const apiPosts = recordApiPosts(page);

    await page.goto('/payment');

    await expect(page.getByText(/Your booking details have expired/)).toBeVisible({
      timeout: 15000,
    });
    expect(apiPosts.filter((post) => post.path.startsWith('/api/bookings'))).toHaveLength(0);

    // Escapable without the back button — and honestly: with no handoff there
    // are no details to go back to, so the page offers search instead of a
    // /checkout that could only answer "this link is missing everything".
    await page.getByRole('link', { name: /back to search/i }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('A cancelled payment says so and charges nothing', async ({ page }) => {
    await page.goto('/checkout?cancelled=1');

    await expect(page.getByText(/You cancelled the payment/)).toBeVisible();
    await expect(page.getByText(/Nothing was charged/)).toBeVisible();
  });

  test('An unknown booking id reports not found, not an error page', async ({ page }) => {
    // A 404 is an answer. The other failure mode — the service being unreachable
    // — must never render as this, because telling someone who has just paid
    // that their booking does not exist is the worst wrong answer available.
    await page.goto(`/confirmation?id=${ABSENT_BOOKING_ID}`);

    await expect(page.getByText('Booking not found')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/could not reach/i)).toHaveCount(0);
    // The id is echoed back so the guest can check it against their email.
    await expect(page.getByText(ABSENT_BOOKING_ID)).toBeVisible();
  });

  test('An unpriceable room type is refused by the server', async ({ page }) => {
    // The client cannot invent inventory: an id outside the demo catalogue is
    // put to the supplier, and a supplier that sells no such room is what makes
    // this a refusal rather than a price.
    //
    // The one spec that needs the container to reach hotelapi.loyalty.dev.
    // Offline it fails as a 502 — "could not reach the hotel" — which is the
    // honest answer to "is this room real?" when nobody can be asked.
    await page.goto(CHECKOUT_URL.replace('roomTypes=deluxe-king', 'roomTypes=presidential-suite'));

    await expect(page.getByText('That room type is not available.')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: /pay sgd/i })).toHaveCount(0);
  });
});
