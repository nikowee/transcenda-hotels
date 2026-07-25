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
| **Booking History** | Renders a mapped list of past and upcoming trips (currently placeholder data).      |
| **Danger Zone**     | Triggers Layer 2 (Centered Red Deletion Prompt) requiring password confirmation.    |

**Deletion Architecture (Backend Integration)**

Because the frontend public key cannot delete users due to strict database security policies, the request is bridged through our Express backend:

// 1. FRONTEND: Verify they know their password locally to prevent accidental/malicious deletion

const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password });

// 2. FRONTEND: Send delete request to our Express backend

const response = await fetch(\`<http://localhost:5000/api/users/\${user.id}\`>, { method: 'DELETE' });

// 3. BACKEND: Express uses the secure Service Role key to bypass rules

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

│ │ └── lib/

│ │ └── supabaseClient.ts # Supabase initialization

├── server/

│ └── src/

│ └── index.ts # DELETE /api/users/:uid endpoint

├── e2e_testing/

│ └── tests/

│ ├── signup-existing-email-error.spec.ts # Playwright E2E

│ └── signup-gibberish-error.spec.ts # Playwright E2E