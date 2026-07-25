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
                    │       E2E Tests (8 tests)          │
                    │  Playwright — full system in Docker │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │   Integration Tests (24 tests)      │
                    │  Frontend: MSW + Vitest (8 tests)   │
                    │  Backend:  Mocha + Supertest + nock (16) │
                    └─────────────────────────────────────┘
                                        ▲
                    ┌─────────────────────────────────────┐
                    │     Unit Tests (16 tests)           │
                    │  Vitest + Testing Library           │
                    │  Isolated component behavior        │
                    └─────────────────────────────────────┘
```

| Layer | Tests | Tools | Location |
|-------|-------|-------|----------|
| **Unit** | 16 | Vitest + React Testing Library | `client/src/components/`, `client/src/pages/` |
| **Frontend Integration** | 8 | MSW + Vitest | `client/src/tests/SearchForm.integration.test.tsx`, `client/src/tests/ResultsPage.integration.test.tsx` |
| **Backend Integration** | 16 | Mocha + Chai + Supertest + nock | `server/src/tests/destination.test.ts`, `server/src/tests/hotel.test.ts` |
| **E2E** | 8 | Playwright | `e2e_testing/tests/` |
| **Total** | **48** | — | — |

---

## 🚀 Quick Start

```bash
# === Run ALL tests ===

# Frontend: unit + integration (24 tests)
cd client && npm run test

# Backend: API integration (16 tests)
cd server && npm run test

# E2E: full system in Docker (8 tests, auto-starts Docker)
cd e2e_testing && npx playwright test
```

---

## 🧩 Phase 1: Unit Tests (6 tests)

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

## 🧩 Phase 1.5: ResultsPage Unit Tests (10 tests)

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

## 🧩 Phase 2.5: ResultsPage Frontend Integration Tests (4 tests)

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

## 🧩 Phase 3: Backend Integration Tests (16 tests)

**Location:** `server/src/tests/destination.test.ts` and `server/src/tests/hotel.test.ts`
**Tools:** Mocha + Chai + Supertest + nock

These tests send real HTTP requests to the Express app without starting a server — Supertest binds the app to a temporary port. The `nock` library intercepts outbound HTTP calls to the Ascenda API at the network level.

### Destination API (7 tests)

| Test | What It Verifies |
|------|-----------------|
| <2 chars returns empty | Backend validation matches frontend guard |
| Typo tolerance ("sinagpore") | Fuse.js fuzzy matching with threshold 0.3 |
| Exact match for "Singapore" | Core search functionality |
| Max 5 results returned | Results are capped for performance |
| Unknown query returns empty | Garbage input doesn't crash |
| Case insensitivity | Lowercase and uppercase return same count |
| Health check endpoint | Smoke test: API is alive |

### Hotel Search API (9 tests)

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

## 🧩 Phase 4: E2E Tests (8 tests)

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