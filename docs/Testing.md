---
title: Testing
nav_order: 9
description: Complete guide to the Transcenda Hotels testing suite — unit, integration, and end-to-end tests.
---

# 🧪 Testing

This page documents the complete testing suite for Transcenda Hotels, covering all three layers of the testing pyramid.

---

## 📊 Testing Pyramid

```
                    ┌─────────────────────────────────────┐
                    │       E2E Tests (16 tests)          │
                    │  Playwright — full system in Docker │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │     Contract Tests (79 tests)       │
                    │  nock — real SDK/client, faked wire │
                    │  Stripe (61) · Ascenda hotels (18)  │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │    Integration Tests (229 tests)    │
                    │  Frontend: MSW + Vitest (89)        │
                    │  Backend:  Mocha + Supertest (140)  │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │      Unit Tests (138 tests)         │
                    │  Vitest + Testing Library (6)       │
                    │  Mocha + Chai (132)                 │
                    └─────────────────────────────────────┘
```

Both external dependencies are faked the same way and at the same layer — nock
intercepts the socket, so the real Stripe SDK and the real axios client build
real requests and parse real payloads. Nothing in `src/` knows it is under test,
and the suite is offline: `globalSetup.ts` blocks outbound sockets outright, so a
call that escapes its interceptor fails rather than quietly reaching production.

Every client suite lives in `client/src/tests/`; every server suite lives in
`server/src/tests/`. Tests are not co-located with source — keeping them out of
`src/pages` and `src/components` is also what keeps them out of the coverage
report, which excludes `src/tests/`.

| Suite | Tests | Tools | Location |
|-------|-------|-------|----------|
| `SearchForm.test.tsx` | 6 | Vitest + RTL, `vi.mock('axios')` | `client/src/tests/` |
| `SearchForm.integration.test.tsx` | 4 | MSW + Vitest | `client/src/tests/` |
| `CheckoutPage.test.tsx` | 18 | MSW + Vitest | `client/src/tests/` |
| `PaymentPage.test.tsx` | 39 | MSW + Vitest, mocked Stripe Elements | `client/src/tests/` |
| `ConfirmationPage.test.tsx` | 17 | MSW + Vitest | `client/src/tests/` |
| `PaymentPageNoStripeKey.test.tsx` | 5 | Vitest + RTL | `client/src/tests/` |
| `BookingEntry.test.tsx` | 6 | Vitest + RTL | `client/src/tests/` |
| `destination.test.ts` | 7 | Mocha + Chai + Supertest | `server/src/tests/` |
| `booking.test.ts` | 46 | Mocha + Chai + Supertest | `server/src/tests/` |
| `buildQuote.test.ts` | 59 | Mocha + Chai | `server/src/tests/` |
| `bookingModel.test.ts` | 17 | Mocha + Chai | `server/src/tests/` |
| `paymentIntent.test.ts` | 59 | Mocha + Chai + Supertest | `server/src/tests/` |
| `recordPaidBooking.test.ts` | 21 | Mocha + Chai | `server/src/tests/` |
| `paymentService.test.ts` | 14 | Mocha + Chai | `server/src/tests/` |
| `rateLimit.test.ts` | 8 | Mocha + Chai | `server/src/tests/` |
| `stripePayments.test.ts` | 25 | Mocha + Chai + **nock** | `server/src/tests/` |
| `stripePaymentIntents.test.ts` | 25 | Mocha + Chai + **nock** | `server/src/tests/` |
| `stripeRefunds.test.ts` | 11 | Mocha + Chai + **nock** | `server/src/tests/` |
| `stripeWebhook.test.ts` | 21 | Mocha + Chai + Supertest | `server/src/tests/` |
| `hotelRoomService.test.ts` | 17 | Mocha + Chai + **nock** | `server/src/tests/` |
| `hotelName.test.ts` | 7 | Mocha + Chai + Supertest + **nock** | `server/src/tests/` |
| `emailService.test.ts` | 6 | Mocha + Chai | `server/src/tests/` |
| `supplierPricing.test.ts` | 8 | Mocha + Chai + Supertest + **nock** | `server/src/tests/` |
| `booking-flow.spec.ts` | 11 | Playwright | `e2e_testing/tests/` |
| `search-*.spec.ts` | 5 | Playwright | `e2e_testing/tests/` |
| **Total** | **462** | — | — |

Plus **3 pending** — the billing-address storage round trip in
`paymentIntent.test.ts`. They are skipped, not deleted: the six `billing_*`
columns are not on the deployed table yet, so `bookingModel.toRow` has the
matching writes commented out under the token `BILLING-PENDING-MIGRATION`.
Grep that token, run `server/src/data/migrations/001_billing_address.sql`, and
un-skip all four together.

---

## 🚀 Quick Start

```bash
# Frontend: 95 tests
cd client && npm run test

# Backend: 351 tests (+3 pending)
cd server && npm run test

# E2E: 16 tests, auto-starts Docker
cd e2e_testing && npm ci && npx playwright install chromium && npx playwright test
```

The E2E run is self-contained: `global-setup.ts` builds and starts both containers,
waits for the API and for Vite to serve its module graph, then loads every route
once so no spec pays for a cold transform. A full cold start finishes in ~10s.

The backend suite needs no Stripe or Supabase credentials and makes no outbound
network calls. `server/src/tests/env.ts` sets the defaults before the app is
imported: `PAYMENTS_MODE=simulate`, `BOOKINGS_STORAGE=memory`, and fake Stripe
keys that exist only so a client can be constructed.

### Delivering a webhook by hand

The webhook is the only thing that turns a captured charge into a booking when
the customer never returns from the payment page, and it is also the path you
cannot reach from a browser — Stripe has no route to localhost without the CLI's
tunnel.

You do not need the CLI. A signature is an HMAC-SHA256 over
`<timestamp>.<raw body>` keyed on the endpoint secret, which is arithmetic this
repo can do itself. Generate a secret, restart the server so it loads the same
one, and sign your own deliveries:

```bash
cd server
npm run stripe:secret -- --write      # writes STRIPE_WEBHOOK_SECRET into .env
PAYMENTS_MODE=simulate npm run dev    # restart to pick it up

npm run stripe:send                   # book, then deliver the completion event
npm run stripe:send -- --tamper       # flip a byte after signing → expect 400
npm run stripe:send -- --event charge.refunded --payment-intent sim_pi_...
```

`stripe:send` mints a real checkout session through `/api/bookings/payment`
first, then delivers the event for it without ever visiting the confirmation
page — which is precisely the scenario the handler exists for. The server log
should answer with `Webhook recovered booking <id> for session <id>`.

Nothing about the server is relaxed to make this work. `constructWebhookEvent`
is the same code that runs in production, which is why `--tamper` is worth
running: it proves the check that makes the other runs meaningful.

### Running one suite or one test

```bash
cd server && npx mocha -r tsx src/tests/booking.test.ts
cd server && npm test -- -g "ignores a client-supplied"

cd client && npx vitest run src/tests/CheckoutPage.test.tsx
cd client && npx vitest run -t "never renders a card"
cd client && npx vitest --ui          # browser UI
```

---

## 💳 Stripe contract tests (nock)

`PAYMENTS_MODE=simulate` proves our own branching, but it short-circuits before a
request is ever built — so it cannot catch a wrong parameter name, a wrong
currency unit, or a response field we misread. That gap is not hypothetical: a
PaymentIntent created with `confirm: false` charged nothing while every booking
was recorded as `PAID`, and no test noticed, because the live code path had never
been executed by anything.

[nock](https://github.com/nock/nock) closes it. It intercepts at the socket, so
the real Stripe SDK serialises real parameters and parses real payloads — only
the wire is faked. Tests therefore assert **the request Stripe receives**, not
just the value we hand back:

```ts
nock(STRIPE_API)
  .post('/v1/checkout/sessions', (body) => { received = decodeForm(body); return true; })
  .reply(200, checkoutSession());

await withLiveStripe(() => createCheckoutSession(input));

expect(received['line_items[0][price_data][unit_amount]']).to.equal('78480');
```

Helpers live in `server/src/tests/helpers/stripeNock.ts`:

| Helper | Purpose |
|--------|---------|
| `useStripeNock()` | Blocks outbound sockets for the suite, leaves loopback open for supertest, cleans interceptors between tests |
| `withLiveStripe(fn)` | Clears `PAYMENTS_MODE` for one call so the real client is used, then restores it |
| `checkoutSession()` / `refund()` / `stripeError()` | Response fixtures shaped like the Stripe API |
| `expectAllMocksUsed()` | Fails when an interceptor was never hit — catches a request that was never made |

### Two traps worth knowing

**Stripe's default HTTP client deadlocks under nock.** `NodeHttpClient` defers
`req.write()` until the socket emits `secureConnect`, which nock's mock socket
never emits, so the request is written but never sent and the test *hangs*
instead of failing. Tests set `STRIPE_HTTP_CLIENT=fetch` to use the fetch client
instead.

**`fetch` must be bound per call, not captured.** Stripe's `FetchHttpClient`
defaults to `fetchFn = globalThis.fetch` in its constructor. A client built
before nock patches the global keeps the pristine `fetch` and reaches the **real
Stripe API** — the suite silently tests production over the network. Import order
alone decided which happened. `paymentService` now passes a lazy wrapper, and
`blocks a Stripe request that has no interceptor` in `stripePayments.test.ts`
fails loudly if that ever regresses.

---

## 🔒 UC4 security regression tests

The booking suites exist mainly to hold shut defects that were once live. Each of
these maps to a specific vulnerability — see
[UC4 — Book & Make Payment]({{ site.baseurl }}/UC4-Book-And-Make-Payment):

| Test | Defect it prevents |
|------|--------------------|
| `ignores a client-supplied amount` | Price set from the request body |
| `ignores a price smuggled inside the stay object` | Same, via a nested field |
| `refuses to price an unknown room type` | Rate invented from an arbitrary `roomId` |
| `rejects a forged session id` | Payment step bypassed entirely |
| `is idempotent across repeated confirmations` | Double booking / double email |
| `never accepts an unverified payload` | Spoofed Stripe webhook |
| `throttles repeated payment attempts` | Card-testing oracle |
| `never renders a card input` (client) | PCI SAQ D scope creep |
| `sends the amount in minor units` | Charging 1/100th of the price |
| `does not scale a zero-decimal currency` | Charging JPY/KRW 100× |
| `withholds detail from a Stripe authentication failure` | Key prefix rendered into the payment form |
| `rejects a body altered after signing` | Forged webhook mutating a booking |
| `refuses to refund a booking that was never paid` | Refunding money never captured |
| `sends an idempotency key so a retry cannot refund twice` | Double refund |
| `blocks a Stripe request that has no interceptor` | Test suite silently calling the real API |
| `ignores any price fields present on the input` | Price contributed by the caller |
| `does not treat inherited Object properties as room types` | `roomId=constructor` pricing to NaN |
| `never returns a non-finite or non-positive total` | A booking written with a NaN price |
| `will not resurrect a FAILED booking` | A late success reviving an expired session |
| `No card field is ever rendered` (E2E) | PCI SAQ D scope creep, in a real browser |
| `CORS in development` (4 origin variants) | Allowlist pinned to one spelling |

---

## 🧩 How each layer works

The suite table above is the inventory. This is what each layer can and cannot
catch, which is the part worth knowing before adding a test.

### Unit — Mocha + Chai, Vitest + RTL

Pure functions and single components, no HTTP. `buildQuote` lives here because it
is the entire price-integrity guarantee, and exercising it only through HTTP left
most of its branches unreached — each case cost a request, so only the obvious
ones got written.

### Integration — Supertest, MSW

Real Express routing and real React rendering, with the far side faked.

MSW intercepts at the protocol level rather than stubbing `axios`, so the client
code under test is the same code that ships:

```
Component  →  axios  →  MSW  →  handlers (src/mocks/handlers.ts)
```

Handlers use wildcard origins (`*/api/...`) so the suite does not depend on
`VITE_API_URL` being set.

### Contract — nock

The real Stripe SDK against a faked wire. See the section above: this is the only
layer that can catch a wrong parameter name or a misread response field, because
it is the only one where a request is actually serialised.

### E2E — Playwright

The full stack in Docker, driven by a real Chromium. Setup is automatic:

```
global-setup.ts
    │
    ├─ docker compose up -d --build
    ├─ wait for /api/health                 ← backend ready
    ├─ wait for /src/main.tsx               ← Vite can serve modules, not just the HTML shell
    └─ warm every route in ROUTES           ← so no spec pays for a cold transform
                │
         run specs, then global-teardown.ts brings the stack down
```

Both waits are load-bearing. A 200 on `/` only proves Vite is serving the shell;
it returns that while dependency optimisation is still running, so the first spec
to arrive got a blank page and timed out while every later spec passed. **Adding a
new route to a spec means adding it to `ROUTES` in `global-setup.ts`.**

This layer earns its cost by catching seams nothing else sees. It found the
handoff bug where `CheckoutPage` wrote a billing address into sessionStorage that
`PaymentPage` never forwarded — both sides' unit tests passed.

## 🐳 Docker & Dockerignore

To keep Docker images lean, test files are excluded from production builds:

**`client/.dockerignore`**
```
coverage/
src/tests/
src/mocks/
**/*.test.*
**/*.spec.*
```

**`server/.dockerignore`**
```
src/tests/
**/*.test.*
**/*.spec.*
```

---

## 📁 Test File Structure

Every suite lives under a `tests/` directory — none are co-located with source.
That is also what keeps them out of the coverage report, which excludes
`src/tests/`.

```
transcenda-hotels/
├── client/
│   ├── src/
│   │   ├── mocks/handlers.ts            # MSW request handlers
│   │   ├── tests/
│   │   │   ├── setup.ts                 # MSW server lifecycle
│   │   │   ├── SearchForm.test.tsx
│   │   │   ├── SearchForm.integration.test.tsx
│   │   │   ├── CheckoutPage.test.tsx
│   │   │   ├── PaymentPage.test.tsx
│   │   │   └── ConfirmationPage.test.tsx
│   └── vite.config.ts                   # Vitest configuration
├── server/
│   ├── .mocharc.json                    # Loads tsx + the network guard, for every invocation
│   └── src/tests/
│       ├── globalSetup.ts               # Blocks outbound sockets except loopback
│       ├── env.ts                       # Test env defaults, imported before ../index
│       ├── setup.ts                     # Exports the app for supertest
│       ├── helpers/stripeNock.ts        # nock lifecycle + Stripe fixtures
│       ├── buildQuote.test.ts           # ─┐
│       ├── bookingModel.test.ts         #  │ unit
│       ├── paymentService.test.ts       #  │
│       ├── rateLimit.test.ts            #  │
│       ├── recordPaidBooking.test.ts    # ─┘
│       ├── destination.test.ts          # ─┐
│       ├── booking.test.ts              #  │ integration
│       ├── paymentIntent.test.ts        #  │
│       ├── stripeWebhook.test.ts        # ─┘
│       ├── stripePayments.test.ts       # ─┐ contract (nock)
│       ├── stripePaymentIntents.test.ts #  │
│       └── stripeRefunds.test.ts        # ─┘
└── e2e_testing/
    ├── global-setup.ts                  # Docker up, readiness waits, route warm-up
    ├── global-teardown.ts               # Docker down
    ├── playwright.config.ts
    └── tests/
        ├── booking-flow.spec.ts
        ├── search-flow.spec.ts
        └── search-error-handling.spec.ts
```

---

## 📋 CI/CD Checklist

Before pushing or opening a PR:

```bash
# 1. Type-check (both projects)
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit

# 2. Lint
cd client && npm run lint

# 3. Run all frontend tests
cd client && npm run test

# 4. Run all backend tests
cd server && npm run test

# 5. Build Docker images
docker compose build

# 6. Run E2E tests (optional, requires Docker)
cd e2e_testing && npx playwright test
```

---

> 📖 For detailed setup instructions, see [Getting Started](getting-started). For the development workflow, see [Development Workflow](development-workflow).