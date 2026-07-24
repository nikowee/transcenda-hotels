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
                    │        E2E Tests (5 tests)          │
                    │  Playwright — full system in Docker │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │    Integration Tests (56 tests)     │
                    │  Frontend: MSW + Vitest (18)        │
                    │  Backend:  Mocha + Supertest (36)   │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │       Unit Tests (33 tests)         │
                    │  Vitest + Testing Library (6)       │
                    │  Mocha + Chai (27)                  │
                    └─────────────────────────────────────┘
```

Every client suite lives in `client/src/tests/`; every server suite lives in
`server/src/tests/`. Tests are not co-located with source — keeping them out of
`src/pages` and `src/components` is also what keeps them out of the coverage
report, which excludes `src/tests/`.

| Suite | Tests | Tools | Location |
|-------|-------|-------|----------|
| `SearchForm.test.tsx` | 6 | Vitest + RTL, `vi.mock('axios')` | `client/src/tests/` |
| `SearchForm.integration.test.tsx` | 4 | MSW + Vitest | `client/src/tests/` |
| `CheckoutPage.test.tsx` | 6 | MSW + Vitest | `client/src/tests/` |
| `ConfirmationPage.test.tsx` | 8 | MSW + Vitest | `client/src/tests/` |
| `destination.test.ts` | 7 | Mocha + Chai + Supertest | `server/src/tests/` |
| `booking.test.ts` | 29 | Mocha + Chai + Supertest | `server/src/tests/` |
| `paymentService.test.ts` | 14 | Mocha + Chai | `server/src/tests/` |
| `rateLimit.test.ts` | 8 | Mocha + Chai | `server/src/tests/` |
| `bookingModel.test.ts` | 5 | Mocha + Chai | `server/src/tests/` |
| E2E specs | 5 | Playwright | `e2e_testing/tests/` |
| **Total** | **92** | — | — |

---

## 🚀 Quick Start

```bash
# Frontend: 24 tests
cd client && npm run test

# Backend: 63 tests
cd server && npm run test

# E2E: 5 tests, auto-starts Docker
cd e2e_testing && npm ci && npx playwright install chromium && npx playwright test
```

The backend suite needs no Stripe or Supabase credentials — `server/src/tests/env.ts`
defaults `PAYMENTS_MODE=simulate` and `BOOKINGS_STORAGE=memory` before the app is
imported.

### Running one suite or one test

```bash
cd server && npx mocha -r tsx src/tests/booking.test.ts
cd server && npm test -- -g "ignores a client-supplied"

cd client && npx vitest run src/tests/CheckoutPage.test.tsx
cd client && npx vitest run -t "never renders a card"
cd client && npx vitest --ui          # browser UI
```

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
| `CORS in development` (4 origin variants) | Allowlist pinned to one spelling |

---

## 🧩 Phase 1: Unit Tests (6 tests)

**Location:** `client/src/tests/SearchForm.test.tsx`
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

## 🧩 Phase 2: Frontend Integration Tests (4 tests)

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

## 🧩 Phase 3: Backend Integration Tests (7 tests)

**Location:** `server/src/tests/destination.test.ts`
**Tools:** Mocha + Chai + Supertest

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

## 🧩 Phase 4: E2E Tests (5 tests)

**Location:** `e2e_testing/tests/search-flow.spec.ts` and `e2e_testing/tests/search-error-handling.spec.ts`
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
│   │   └── tests/
│   │       ├── setup.ts                     # MSW server lifecycle
│   │       └── SearchForm.integration.test.tsx  # Integration tests
│   └── vite.config.ts                       # Vitest configuration
├── server/
│   └── src/
│       └── tests/
│           ├── setup.ts                     # Test lifecycle hooks
│           └── destination.test.ts          # API tests (Mocha)
├── e2e_testing/
│   ├── global-setup.ts                      # Starts Docker containers
│   ├── global-teardown.ts                   # Stops Docker containers
│   ├── playwright.config.ts                 # Playwright configuration
│   └── tests/
│       ├── search-flow.spec.ts              # E2E search scenarios
│       └── search-error-handling.spec.ts    # E2E error scenarios
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