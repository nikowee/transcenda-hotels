**title: Authentication nav_order: 10 description: Complete guide to Transcenda Hotels authentication flows, user profiles, account management, and auth testing.**

**🔐 Authentication**

This page documents the complete authentication and user management architecture for Transcenda Hotels, powered by Supabase Auth and our custom Express backend.

**📊 Auth Architecture**

┌─────────────────────────────────────┐

│ Supabase Auth API │

│ (JWTs, Sessions, Users) │

└─────────────────────────────────────┘

▲ ▲

Sign In/Up/Out Admin API ('deleteUser')

│ │

│ ┌──────────┴──────────────────────────┐

│ │ Backend API (Express :5000) │

│ │ (Requires Service Role Admin Key) │

│ └─────────────────────────────────────┘

▼ ▲

┌──────────────────────┴──────────────┐

│ React Client (Frontend) │

│ useState, useEffect, Supabase JS │

└─────────────────────────────────────┘

▲ ▲

┌─────────┴──────┐ ┌───────┴────────┐

│ Auth Pages │ │ Profile Modal │

│ (Login/Signup) │ │(Update/Delete) │

└────────────────┘ └────────────────┘

| **Component**     | **Purpose**                                   | **Core Tools**           | **Location**                           |
| ----------------- | --------------------------------------------- | ------------------------ | -------------------------------------- |
| **Signup**        | User registration and validation              | supabase.auth.signUp     | client/src/pages/Signup.tsx            |
| **Login**         | User authentication and success flags         | useSearchParams          | client/src/pages/Login.tsx             |
| **Profile Modal** | Account management and deletion               | Express DELETE endpoint  | client/src/components/ProfileModal.tsx |
| **Backend API**   | Securely bypasses frontend rules for deletion | supabaseAdmin.auth.admin | server/src/index.ts                    |

**🚀 Quick Start**

\# === Local Development ===

\# Ensure your backend and frontend are running:

docker compose up -d

\# === Run Auth Tests ===

\# Frontend unit tests for error states

cd client && npm run test src/pages/\__tests_\_/Signup.test.tsx

\# E2E Playwright tests for auth boundaries

cd e2e_testing && npx playwright test tests/signup-gibberish-error.spec.ts

cd e2e_testing && npx playwright test tests/signup-existing-email-error.spec.ts

**🧩 Phase 1: Sign Up & Log In**

**Location:** client/src/pages/Signup.tsx and client/src/pages/Login.tsx

The authentication flow utilizes Supabase's built-in email/password provider, intercepting specific error messages to provide user-friendly UI feedback.

**The Flow**

- **Sign Up:** User enters email and password.
- **Action:** supabase.auth.signUp() is called with emailRedirectTo configured.
- **Verification:** If successful, a green styled box prompts the user to check their email.
- **Redirection:** Clicking the email link redirects to /login?verified=true.
- **Log In:** The Login.tsx component intercepts the URL parameter using React Router's useSearchParams and renders a success message before the user logs in.

**Error Handling Boundaries**

| **Scenario**        | **What Happens**                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| **Duplicate Email** | Intercepts "already registered" string. Shows: _"This email is already registered and verified."_ |
| **Gibberish Email** | Intercepts invalid domain error. Shows: _"Unable to validate email address."_                     |
| **Wrong Password**  | Native Supabase error is caught and displayed in a red bg-red-500/10 box.                         |

**🧩 Phase 2: Profile Management & Account Deletion**

**Location:** client/src/components/ProfileModal.tsx and server/src/index.ts

A highly interactive, multi-layered modal for account management. Deletion is handled securely by verifying credentials locally before relying on the Express backend's Admin privileges to perform the deletion.

**Structure**

| **Tab/Layer**       | **Functionality**                                                                   |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Account Details** | Displays Email and Account ID. Includes a form to change the password (updateUser). |
| **Booking History** | Renders the account's real bookings, fetched from GET /api/bookings/user/:userId with a Bearer token (see Phase 5). |
| **Danger Zone**     | Triggers Layer 2 (Centered Red Deletion Prompt) requiring password confirmation.    |

**Deletion Architecture (Backend Integration)**

Because the frontend public key cannot delete users due to strict database security policies, the request is bridged through our Express backend:

// 1. FRONTEND: Verify they know their password locally to prevent accidental/malicious deletion

const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password });

// 2. FRONTEND: Send the delete request with the session's Bearer token attached

const response = await fetch(\`<http://localhost:5000/api/users/\${user.id}\`>, { method: 'DELETE', headers: await authHeader() });

// 3. BACKEND: requireUser verifies the token against Supabase, then an ownership check rejects a verified caller acting on somebody else's account

// 4. BACKEND: Only then does Express use the secure Service Role key to perform the deletion

await supabaseAdmin.auth.admin.deleteUser(userId);

// 4. FRONTEND: Clear session and refresh

await supabase.auth.signOut();

window.location.reload();

**Note on State Management:** The ProfileModal component utilizes a useEffect hook listening to the !isOpendependency to ensure all sensitive state (like entered passwords and error messages) is strictly cleared from memory when the modal closes.

**🧩 Phase 3: Auth Testing**

**Location:** client/src/pages/\__tests_\_/Signup.test.tsx and e2e_testing/tests/

The authentication layer is tested using both Unit (Vitest) and E2E (Playwright) methodologies to ensure security boundaries hold up.

**What's Tested**

| **Test**             | **Tools**        | **What It Verifies**                                                                                                                 |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Component Rendering  | Vitest           | Email, Password, and Submit elements exist in the DOM.                                                                               |
| Mock Duplicate Email | Vitest + vi.mock | Simulates a Supabase duplicate error and asserts the specific UI response.                                                           |
| Mock Gibberish Email | Vitest + vi.mock | Simulates an invalid domain error from Supabase.                                                                                     |
| E2E Duplicate Email  | Playwright       | Registers a user, waits for DB insertion, re-submits the exact same form, and asserts the error boundary in a real Chromium browser. |
| E2E Gibberish Email  | Playwright       | Submits fake formatting (@gibberishmail.invalid) and asserts the rejection alert.                                                    |


**🧩 Phase 4: Backend Middleware — resolveUser & requireUser**

**Location:** server/src/middleware/auth.ts

The middleware turns a caller's Supabase access token into a verified identity on req.auth. Core rule: a user id in a request body or URL is an _identifier_, not a _credential_ — anyone can type a UUID, so only req.auth.userId (verified from the token) ever decides which account a booking belongs to.

**The Two Middlewares**

| **Middleware**  | **Behavior**                                                                                                          | **Use When**                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **resolveUser** | Sets req.auth when a valid token is presented, passes token-less guests straight through, still rejects a _bad_ token. | The route serves both guests and signed-in users.   |
| **requireUser** | Runs the same check, then insists on a result — 401 without a valid token.                                             | The route must never serve an anonymous caller.     |

**Verification internals worth knowing:**

- Tokens are verified against Supabase via supabaseAdmin.auth.getUser (catching signed-out and revoked sessions — a locally-decoded JWT stays valid until expiry).
- Successful verifications are cached for 60 seconds, skipping the Supabase round trip between /payment-intent and /confirm.
- Status split: a 4xx from the auth API means the token was rejected (401 back); anything else means Supabase could not answer (503 back), so an outage never signs a paying guest out.

**Using Auth with the Routing**

Attach the middleware directly in the route chain in server/src/index.ts — it runs before the handler, which then reads req.auth:

// Optional auth: guests allowed, signed-in bookings get attributed via req.auth

app.post('/api/bookings/payment-intent', paymentLimiter, resolveUser, postPaymentIntent);

// Mandatory auth: booking history is for the account holder only

app.get('/api/bookings/user/:userId', lookupLimiter, requireUser, getBookingsByUser);

// Mandatory auth + ownership: the handler compares req.auth.userId to :uid and 403s a mismatch

app.delete('/api/users/:uid', lookupLimiter, requireUser, deleteHandler);

**Recipe for protecting a new route:** add requireUser after the rate limiter and before the handler, then trust only req.auth.userId inside — never an id from the body. If the same route must also serve guests, use resolveUser and branch on whether req.auth is set.

| **Route**                        | **Middleware** | **Why**                                                                 |
| -------------------------------- | -------------- | ----------------------------------------------------------------------- |
| POST /api/bookings/payment       | resolveUser    | Guest checkout is supported; a signed-in booking records its user_id.   |
| POST /api/bookings/payment-intent| resolveUser    | Same — identity attaches if present, guests proceed.                    |
| GET /api/bookings/user/:userId   | requireUser    | Whole booking history; 403 when the token's subject is not :userId.     |
| DELETE /api/users/:uid           | requireUser    | Account deletion; ownership check on top of verification.               |

**🧩 Phase 5: Frontend Auth Flow — useAuth & authHeader**

**Location:** client/src/hooks/useAuth.ts and client/src/lib/authHeader.ts

The frontend splits auth into two small tools with different jobs: useAuth answers _"who is signed in, right now and whenever it changes"_ for the UI, while authHeader answers _"attach my token to this API call"_ for requests. Neither ever renders a security verdict — the server's middleware is the only judge.

**useAuth — reactive session state for components**

// Subscribes once, updates on every auth event (sign in, sign out, token refresh)

const { user, logout } = useAuth();

- **On mount:** supabase.auth.getSession() seeds the current user from local session storage.
- **Live updates:** supabase.auth.onAuthStateChange() pushes every subsequent change, so the Navbar flips between "Sign in" and the profile button without a reload.
- **Cleanup:** the subscription unsubscribes on unmount.
- **Consumers:** Navbar (which button to show) and ProfileModal (whose account to display).

**authHeader — the token, packaged for a request**

// Returns { Authorization: 'Bearer <token>' } signed in, or {} signed out

const response = await axios.get(url, { headers: await authHeader() });

- **Guest-friendly by design:** the empty object spreads into a request harmlessly, and the server reads a header-less request as a guest checkout — one call site serves both cases with no branch.
- **Fresh tokens:** built on supabase.auth.getSession(), which refreshes a near-expiry access token as part of the call — a long checkout never ends with a stale-token rejection at the moment of payment.
- **Consumers:** PaymentPage (minting the payment intent) and ProfileModal (booking history, account deletion).

**The End-to-End Flow**

1. **Sign in** (Login.tsx): supabase.auth.signInWithPassword() stores the session in the browser.
2. **UI reacts** (useAuth): onAuthStateChange fires, user is set, Navbar shows the account.
3. **A request needs identity** (PaymentPage / ProfileModal): await authHeader() packages the current access token.
4. **The server judges** (middleware/auth.ts): resolveUser or requireUser verifies the token with Supabase and sets req.auth.
5. **The handler acts on req.auth.userId** — the body's userId, if any, is only ever cross-checked, never trusted.
6. **Sign out**: supabase.auth.signOut() clears the session; useAuth flips the UI back; the server's 60-second verification cache is the only window in which the old token still reads as live.

**Safety guardrail:** no client route is gated by auth — /checkout and /payment stay reachable because guest booking is a feature, and every protected _action_ is enforced server-side. A component that must hide UI for guests branches on useAuth's user, knowing that hiding is cosmetic and the middleware is the boundary.

**📁 Auth File Structure**

transcenda-hotels/

├── client/

│ ├── src/

│ │ ├── components/

│ │ │ └── ProfileModal.tsx # Multi-layer profile & deletion UI

│ │ ├── pages/

│ │ │ ├── Login.tsx # useSearchParams integration

│ │ │ ├── Signup.tsx # signUp and Error Boundaries

│ │ │ └── \__tests_\_/

│ │ │ └── Signup.test.tsx # Vitest auth mocks

│ │ ├── hooks/

│ │ │ └── useAuth.ts # Reactive session state (getSession + onAuthStateChange)

│ │ └── lib/

│ │ ├── authHeader.ts # Bearer header for API calls, {} for guests

│ │ └── supabaseClient.ts # Supabase initialization

├── server/

│ └── src/

│ ├── middleware/

│ │ └── auth.ts # resolveUser / requireUser token verification

│ └── index.ts # Route wiring incl. DELETE /api/users/:uid

├── e2e_testing/

│ └── tests/

│ ├── signup-existing-email-error.spec.ts # Playwright E2E

│ └── signup-gibberish-error.spec.ts # Playwright E2E