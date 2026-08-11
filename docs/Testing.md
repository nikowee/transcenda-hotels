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
                    │        E2E Tests (22 tests)         │
                    │  Playwright — full system in Docker │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │       Backend (375 tests)           │
                    │  Mocha + Chai + Supertest; nock     │
                    │  fakes Stripe and Ascenda at the    │
                    │  socket, network blocked outright   │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │      Frontend (166 tests)           │
                    │  Vitest + Testing Library, MSW      │
                    │  intercepting every request         │
                    └─────────────────────────────────────┘
```

Counts are per test runner because that is what a runner reports and what a
red build shows; the earlier unit/integration/contract split was drifting
every time a suite grew.

Both external dependencies are faked the same way and at the same layer — nock
intercepts the socket, so the real Stripe SDK and the real axios client build
real requests and parse real payloads. Nothing in `src/` knows it is under test,
and the suite is offline: `globalSetup.ts` blocks outbound sockets outright, so a
call that escapes its interceptor fails rather than quietly reaching production.

The one exception is `src/tests/external/` — real-network tests that hit
external API. They are excluded from the default `npm test` glob and run
on demand with `npm run test:external`. `globalSetup.ts` detects those runs and
skips the nock guard entirely (nock is imported lazily), letting the tests use a real socket with normal
decompression.

### Real-network layers added for rubric coverage

The suite now deliberately spans four ways of talking to the Ascenda API, so
each rubric claim is backed by more than one layer:

| Layer | What it proves | Run with |
|-------|----------------|----------|
| nock-mocked server integration (`hotels/search.test.ts`, `destinations/search.test.ts`) | Our route logic, filters, sorting and pagination against a *fixed* upstream shape — fast, offline, deterministic | `npm test` |
| **`external/search.integration.test.ts`** (new) | The **real Express app** driving the **real live Ascenda API** through supertest — no nock, real axios, real polling. Asserts the merged-hotel shape the frontend depends on | `npm run test:external` |
| `external/ascenda-api.test.ts` | Raw axios smoke tests straight against `hotelapi.loyalty.dev` (the socket-level contract) | `npm run test:external` |
| Playwright E2E | Full browser → Vite → Express → live Ascenda in Docker | `cd e2e_testing && npx playwright test` |

### Robustness / fuzz additions

- **`server/src/tests/fuzz/hotelSearch.fuzz.test.ts`** (new): fast-check
  property tests over `searchHotels` — garbage params never throw, valid params
  always produce the full merged shape, results stay sorted by `searchRank`, and
  a price entry with no matching hotel detail is skipped, never a crash.
- **`hotels/search.test.ts`** now also covers: page beyond range, `page=0` /
  `pageSize=0`, missing `rooms`, `rooms=0/-1`, non-numeric `guests`, invalid
  dates, unknown `sortBy` fallback, out-of-range `starRating`, whitespace
  `destination_id`.
- **`destinations/search.test.ts`** now also covers: missing `q`, whitespace-only
  `q`, 10k-char query, unicode/emoji, SQL-injection/XSS payloads, and the 5-result cap.

### Frontend unit/boundary additions

- `SearchForm.test.tsx` +8: missing dates, check-in < 3 days out, whitespace-only
  input makes no API call, exactly-2-char boundary fires the API, loading spinner,
  suggestion selection closes the dropdown, re-typing resets the selected
  destination, valid submission passes validation.
- `ResultsPage.test.tsx` +3: `guests=0`, non-numeric `guests`, missing `rooms`.
- New component suites: `HotelCard.test.tsx` (6), `Pagination.test.tsx` (5),
  `FilterPanel.test.tsx` (5).

### E2E additions

- `results-page.spec.ts` +3: apply 5★ filter, sort by price ascending, pagination
  next-button.
- `global-setup.ts` `ROUTES` now includes `/results` (the load-bearing warm-up list).

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

---

## 🚀 Quick Start

```bash
# Frontend: 166 tests
cd client && npm run test

# Backend: 375 tests (+3 pending)
cd server && npm run test

# Backend: real-network Ascenda smoke tests (opt-in, hits the live API)
cd server && npm run test:external

# E2E: 22 tests, auto-starts Docker
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
[UC4 — Book & Make Payment]({{ site.baseurl }}/UC4-Book-And-Make-Payment). The
same defences are modelled as attacks in
[Misuse Cases]({{ site.baseurl }}/Misuse-Cases), which groups them by what an
attacker is trying to achieve and names the residual risks:

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
│       ├── globalSetup.ts               # Blocks outbound sockets except loopback; skipped for external runs
│       ├── external/                    # Real-network tests (npm run test:external)
│       │   └── ascenda-api.test.ts      # Hits the live Ascenda API
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

---

## 📚 Feature 2 & 3 — per-suite detail

Carried over from the search and hotel-details branches when they merged into
`development`. Their document was organised per feature; this page is organised
per test layer, so the walkthroughs are kept here intact rather than interleaved.

The per-section counts have been removed: they were written before this merge
and the suite table at the top of this page is the authoritative tally.

## 🧩 Phase 1: Unit Tests

**Location:** `client/src/components/SearchForm.test.tsx`
**Tools:** Vitest + React Testing Library + `vi.mock('axios')`

These tests validate the `SearchForm` component in isolation — no real API calls, no browser.

### What's Tested

| Test | What It Verifies |
|------|-----------------|
| Renders all form fields | Labels, inputs, and search button exist |
| Updates input on typing | `searchTerm` state updates correctly |
| Shows alert for <2 chars | Boundary: validation fires for short input |
| Check-out before check-in | Negative: date validation logic |
| Suggestions appear after debounce | Async: API mock returns suggestions after 300ms |
| Suggestions clear on input clear | Edge case: dropdown visibility toggles |

### Key Details

- `axios` is mocked globally in this file only — `vi.mock('axios')` prevents actual HTTP requests
- Component is wrapped in `<MemoryRouter>` for `useNavigate()`
- `@testing-library/jest-dom/vitest` provides matchers like `toBeInTheDocument()`
- Debounce tests use `waitFor` with a 500ms timeout to account for the 300ms debounce

---

## 🧩 Phase 1.5: ResultsPage Unit Tests

**Location:** `client/src/pages/ResultsPage.test.tsx`
**Tools:** Vitest + React Testing Library + `vi.mock('axios')`

These tests validate the `ResultsPage` component in isolation — no real API calls, no browser.

### What's Tested

| Test | What It Verifies |
|------|-----------------|
| Renders loading skeleton | `loading` state shows animated skeleton cards |
| Renders error for missing params | Error message + "Go Back" button appear when URL params missing |
| Renders error on API failure | `Failed to load hotels` message when axios rejects |
| Renders hotel cards | Hotels, search summary, and "Select Hotel" buttons appear |
| Renders empty state | `No hotels match your filters` when API returns empty array |
| Renders pagination | Page buttons and prev/next labels appear for multi-page results |
| Apply filters triggers re-fetch | Second axios call includes `starRating` param |
| Clear filters resets state | Third axios call reverts to unfiltered requests |
| Sort change triggers re-fetch | Changing sort dropdown updates `sortBy` param in request |
| Hotel selection navigates | Clicking "Select Hotel" calls `useNavigate` with correct URL |

### Key Details

- `axios` is mocked globally — `vi.mock('axios')` prevents actual HTTP requests
- `useNavigate` is mocked from `react-router` to verify navigation calls
- Component is wrapped in `<MemoryRouter>` with `initialEntries` to simulate URL params
- Loading test uses `mockImplementationOnce(() => new Promise(() => {}))` to keep loading state persistent

---

## 🧩 Phase 2: Frontend Integration Tests

**Location:** `client/src/tests/SearchForm.integration.test.tsx`
**Tools:** MSW (Mock Service Worker) + Vitest

These tests verify the full frontend → API flow, with MSW intercepting network requests at the protocol level.

### MSW Architecture

```
Test Component (SearchForm)
    │
    ▼
axios.get('http://localhost:5000/api/destinations/...')
    │
    ▼
MSW Server (intercepts at network level)
    │
    ▼
Mock handlers (src/mocks/handlers.ts)
    │
    ▼
Returns filtered destination data
```

### What's Tested

| Test | What It Verifies |
|------|-----------------|
| Fetches and displays suggestions | Full flow: type → debounce → API → render |
| Empty query returns nothing | Component guard for <2 chars (no API call) |
| Network error handled gracefully | `HttpResponse.error()` → console.error logged |
| Debounce prevents excess requests | Only 1 API call after rapid typing, not 9 |

### Key Details

- **MSW server** is configured in `client/src/tests/setup.ts` — starts before all tests, resets handlers after each, closes after all
- **Handlers** are defined in `client/src/mocks/handlers.ts` with mock destinations (Singapore, Tokyo, London, Paris)
- Handlers use the **same endpoint** (`http://localhost:5000/api/destinations/search`) as the real backend
- `server.use()` allows per-test handler overrides (e.g., to simulate network errors)

### Setup Lifecycle

```typescript
// client/src/tests/setup.ts
beforeAll(()  => server.listen({ onUnhandledRequest: 'error' }));
afterEach(()  => { server.resetHandlers(); cleanup(); });
afterAll(()   => server.close());
```

---

## 🧩 Phase 2.5: ResultsPage Frontend Integration Tests

**Location:** `client/src/tests/ResultsPage.integration.test.tsx`
**Tools:** MSW (Mock Service Worker) + Vitest

These tests verify the `ResultsPage` component with MSW intercepting API calls at the network level, spanning search, empty state, error handling, and pagination navigation.

### What's Tested

| Test | What It Verifies |
|------|-----------------|
| Fetches and displays hotels | Full flow: page loads → axios → MSW → renders 5 hotel cards |
| Network error handled gracefully | `HttpResponse.error()` → error UI with `console.error` logged |
| Empty results message | API returns empty array → `No hotels match your filters` |
| Pagination navigation | Clicking page `2` fetches and renders page 2 hotels |

### Key Details

- Uses the same MSW server setup as the SearchForm integration tests
- `server.use()` overrides the `/api/hotels/search` handler per test for different scenarios
- Pagination test uses `server.use()` with dynamic URL parsing to simulate multi-page responses

---

## 🧩 Phase 3: Backend Integration Tests

**Location:** `server/src/tests/destination.test.ts` and `server/src/tests/hotel.test.ts`
**Tools:** Mocha + Chai + Supertest + nock

These tests send real HTTP requests to the Express app without starting a server — Supertest binds the app to a temporary port. The `nock` library intercepts outbound HTTP calls to the Ascenda API at the network level.

### Destination API

| Test | What It Verifies |
|------|-----------------|
| <2 chars returns empty | Backend validation matches frontend guard |
| Typo tolerance ("sinagpore") | Fuse.js fuzzy matching with threshold 0.3 |
| Exact match for "Singapore" | Core search functionality |
| Max 5 results returned | Results are capped for performance |
| Unknown query returns empty | Garbage input doesn't crash |
| Case insensitivity | Lowercase and uppercase return same count |
| Health check endpoint | Smoke test: API is alive |

### Hotel Search API

| Test | What It Verifies |
|------|-----------------|
| Missing required params → 400 | Validates `destination_id`, `checkin`, `checkout`, `guests`, `rooms` |
| Valid search → 200 with hotels | Full flow: nock mocks Ascenda → merged hotels returned |
| Star rating filter | `starRating=5` returns only 5-star hotels |
| Minimum price filter | `minPrice=300` excludes cheap hotels |
| Maximum price filter | `maxPrice=100` returns only budget hotels |
| Sort by price ascending | Hotels ordered by price low→high |
| Sort by price descending | Hotels ordered by price high→low |
| Pagination | `page=1&pageSize=2` returns correct slice with `totalPages` |
| Guest rating filter | `minGuestRating=4` returns only hotels with rating ≥ 4 |

### Key Details

- `nock` intercepts calls to `https://hotelapi.loyalty.dev` and mocks `/api/hotels/prices` and `/api/hotels`
- Mocks return realistic data: price entries with `searchRank`, and hotel details with `categories`, `amenities`, `image_details`
- Tests verify filter logic, sort ordering, and pagination without hitting the real Ascenda API

These tests send real HTTP requests to the Express app without starting a server — Supertest binds the app to a temporary port.

### What's Tested

| Test | What It Verifies | Rubric Alignment |
|------|-----------------|-----------------|
| <2 chars returns empty | Edge case: backend validation matches frontend | ✅ Robustness |
| Typo tolerance ("sinagpore") | Fuse.js fuzzy matching with threshold 0.3 | ✅ Integration |
| Exact match for "Singapore" | Core search functionality | ✅ Integration |
| Max 5 results returned | Performance: results are limited | ✅ Robustness |
| Unknown query returns empty | Edge case: garbage input doesn't crash | ✅ Robustness |
| Case insensitivity | Lowercase and uppercase return same count | ✅ Integration |
| Health check endpoint | Smoke test: API is alive | ✅ Integration |

### Key Details

- The **Express app** is exported from `server/src/index.ts` and imported in tests
- Server start is guarded by an ESM-compatible check — only starts when run directly, not when imported
- Supertest sends requests without binding to a port, avoiding port conflicts
- The **Fuse.js index** is loaded from `server/src/data/destinations.json` at import time

### Test Structure

```typescript
// server/src/tests/destination.test.ts
import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from './setup';

describe('Destination Search API', () => {
  it('should return empty array for query with less than 2 characters', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 's' });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array').that.is.empty;
  });
  // ...
});
```

---

## 🧩 Phase 4: E2E Tests

**Location:** `e2e_testing/tests/search-flow.spec.ts`, `e2e_testing/tests/search-error-handling.spec.ts`, and `e2e_testing/tests/results-page.spec.ts`
**Tools:** Playwright

These tests run against the **full stack** in Docker, automating a real Chromium browser.

### Automated Setup

Playwright's `globalSetup` and `globalTeardown` handle infrastructure automatically:

```
global-setup.ts
    │
    ▼
docker compose up -d --build   ← Builds and starts containers
    │
    ▼
Wait for :3000 and :5000        ← Polls until both are ready
    │
    ▼
Run all E2E tests              ← Playwright test execution
    │
    ▼
global-teardown.ts
    │
    ▼
docker compose down            ← Stops and removes containers
```

### What's Tested

| Test | File | What It Verifies |
|------|------|-----------------|
| Full search → hotels displayed | `results-page.spec.ts` | Complete journey: type → select → set dates → verify hotel cards render |
| Error without search params | `results-page.spec.ts` | Navigate to `/results` directly → error message + Go Back button |
| Hotel details render | `results-page.spec.ts` | Direct nav with params → hotels, dates, filter panel, sort dropdown visible |
| Search → results flow | `search-flow.spec.ts` | Full journey: type → select suggestion → set dates → redirect to results |
| Typo-tolerant search | `search-flow.spec.ts` | Fuse.js fuzzy matching in a real browser |
| Empty search validation | `search-error-handling.spec.ts` | Alert dialog fires when no destination selected |
| Invalid dates validation | `search-error-handling.spec.ts` | Alert dialog fires for check-out before check-in |
| Login/Signup alerts | `search-error-handling.spec.ts` | Navigation buttons show placeholder alerts |

### Configuration Highlights

```typescript
// e2e_testing/playwright.config.ts
timeout: 30000,           // Max 30s per test
baseURL: 'http://localhost:3000',  // Frontend URL
trace: 'on-first-retry',  // Network logs on failure
screenshot: 'only-on-failure',
video: 'retain-on-failure',
```

### Running with Visible Browser

```bash
cd e2e_testing
npx playwright test --headed    # Watch tests in real time
npx playwright test --debug     # Step through with inspector
```

### Viewing Reports

```bash
cd e2e_testing
npx playwright show-report      # Opens HTML report with screenshots/videos
```

---

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

```
transcenda-hotels/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   └── SearchForm.test.tsx          # Unit tests (Vitest)
│   │   ├── mocks/
│   │   │   ├── handlers.ts                  # MSW request handlers
│   │   │   └── browser.ts                   # MSW browser setup
│   │   ├── pages/
│   │   │   └── ResultsPage.test.tsx         # ResultsPage unit tests (Vitest)
│   │   └── tests/
│   │       ├── setup.ts                     # MSW server lifecycle
│   │       ├── SearchForm.integration.test.tsx  # SearchForm integration (MSW)
│   │       └── ResultsPage.integration.test.tsx # ResultsPage integration (MSW)
│   └── vite.config.ts                       # Vitest configuration
├── server/
│   └── src/
│       └── tests/
│           ├── setup.ts                     # Test lifecycle hooks
│           ├── destination.test.ts          # Destination API tests (Mocha)
│           └── hotel.test.ts                # Hotel search API tests (Mocha + nock)
├── e2e_testing/
│   ├── global-setup.ts                      # Starts Docker containers
│   ├── global-teardown.ts                   # Stops Docker containers
│   ├── playwright.config.ts                 # Playwright configuration
│   └── tests/
│       ├── search-flow.spec.ts              # E2E search scenarios
│       ├── search-error-handling.spec.ts    # E2E error scenarios
│       └── results-page.spec.ts             # E2E ResultsPage scenarios
└── .gitignore                               # Ignores coverage/ and report output
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
