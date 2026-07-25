**title: Navigation nav_order: 11 description: Complete guide to Transcenda Hotels navigation architecture, dynamic routing, and layout wrappers.**

**🗺️ Navigation**

This page documents the navigation architecture and layout rendering system for Transcenda Hotels, powered by React Router v8.

**📊 Navigation Architecture**

┌─────────────────────────────────────┐

│ Browser URL │

└─────────────────────────────────────┘

│

┌─────────────────▼───────────────────┐

│ React Router v8 (App.tsx) │

│ \`createBrowserRouter\` │

└─────────────────────────────────────┘

│

┌──────────────────────┼──────────────────────┐

▼ ▼ ▼

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐

│ Landing Page │ │ Auth Layout │ │ Results Page │

│ (Dynamic Nav) │ │ (Login/Signup) │ │ (Coming Soon) │

└─────────────────┘ └─────────────────┘ └─────────────────┘

| **Component**   | **Purpose**                          | **Core Tools**           | **Location**                         |
| --------------- | ------------------------------------ | ------------------------ | ------------------------------------ |
| **App Router**  | Global route definitions             | createBrowserRouter      | client/src/App.tsx                   |
| **Navbar**      | Dynamic main navigation header       | useEffect, Session State | client/src/pages/LandingPage.tsx     |
| **Auth Layout** | Consistent UI wrapper for auth views | children composition     | client/src/components/AuthLayout.tsx |

**🧩 Phase 1: Core Routing (React Router v8)**

**Location:** client/src/App.tsx

Transcenda Hotels utilizes the modern createBrowserRouter API from React Router v8, replacing the legacy &lt;BrowserRouter&gt;component. This setup ensures stable DOM mounting and prepares the application for advanced data fetching features.

**Route Definitions**

| **Path** | **Element Rendered**  | **Description**                                                        |
| -------- | --------------------- | ---------------------------------------------------------------------- |
| /        | &lt;LandingPage /&gt; | Home page featuring the dynamic Navbar, Hero section, and Search Form. |
| /login   | &lt;Login /&gt;       | User login view, wrapped in the Auth Layout.                           |
| /signup  | &lt;Signup /&gt;      | User registration view, wrapped in the Auth Layout.                    |
| /results | Placeholder           | Future destination search results view.                                |

**🧩 Phase 2: Dynamic Navbar**

**Location:** client/src/pages/LandingPage.tsx

The navigation system is deeply tied to the user's Supabase session. It dynamically toggles UI elements based on authentication status without requiring full page reloads.

**Session Awareness & UI Behavior**

The Navbar listens for session changes using supabase.auth.onAuthStateChange.

| **State**      | **UI Rendered**                                  | **Interactive Behavior**                                                                                                                    |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logged Out** | "Log In" link and solid "Sign Up" button.        | Directs user to the respective auth routes.                                                                                                 |
| **Logged In**  | User Pill (Avatar + Email) and "Log Out" button. | Clicking the User Pill opens the &lt;ProfileModal /&gt;. Clicking "Log Out" triggers supabase.auth.signOut() and instantly updates the DOM. |

**🧩 Phase 3: Layout Wrappers**

**Location:** client/src/components/AuthLayout.tsx

To maintain visual consistency across all authentication views (Login, Signup, Forgot Password), the application utilizes a centralized layout wrapper.

**The AuthLayout Component**

- **Composition:** Accepts children (forms), a title, and a subtitle.
- **Styling:** Provides a full-screen background image with a dark gradient overlay and a centered, frosted-glass (backdrop-blur) card.
- **Branding:** Contains a static header linking back to the root / path to ensure users can always escape the auth flow.

**Implementation Example**

&lt;AuthLayout title="Welcome back" subtitle="Login to access your account"&gt;

{/\* The specific Login or Signup form gets injected here \*/}

&lt;form&gt;...&lt;/form&gt;

&lt;/AuthLayout&gt;

**📁 Navigation File Structure**

transcenda-hotels/

├── client/

│ ├── src/

│ │ ├── App.tsx # Root Router (createBrowserRouter)

│ │ ├── components/

│ │ │ └── AuthLayout.tsx # Layout wrapper for auth views

│ │ └── pages/

│ │ ├── LandingPage.tsx # Dynamic Navbar logic

│ │ ├── Login.tsx # Auth route

│ │ └── Signup.tsx # Auth route