---
title: Environment Variables
nav_order: 7
description: All required environment variables for Transcenda Hotels, how to set them up, and where they're used.
---

# 🔐 Environment Variables

This page documents all required environment variables for Transcenda Hotels, how to set them up, and where they're used.

---

## 📋 Required Variables

### Backend (`server/.env`)

The backend requires a `.env` file located at `server/.env`. Below is the complete list of variables:

| Variable | Required | Description | Example Value |
|----------|----------|-------------|---------------|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL | `https://abc123.supabase.co` |
| `SUPABASE_SECRET_KEY` | ✅ Yes | Supabase service role (secret) key for admin operations | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `STRIPE_SECRET_KEY` | ✅ Yes | Stripe secret key for server-side payments | `sk_live_51H3...` or `sk_test_51H3...` |
| `PORT` | ❌ No | Backend server port (defaults to 5000) | `5000` |
| `TRUST_PROXY_HOPS` | ❌ No | Proxy hops in front of the server (default 1). Rate limiters key on `req.ip`, derived by counting back this many hops in `X-Forwarded-For`. Too low: all users share the proxy's bucket. Too high: the counted value is client-forgeable. `0` when running bare on localhost | `1` |
| `RESEND_API_KEY` | ❌ No | With `EMAIL_FROM`, sends real confirmation emails through Resend's HTTP API. Absent, confirmations are logged to the console (the dev/test default) | `re_123...` |
| `EMAIL_FROM` | ❌ No | Verified sender address for confirmation emails; required alongside `RESEND_API_KEY` | `bookings@example.com` |
| `REDIS_STARTUP_RETRIES` | ❌ No | Connection attempts before giving up on a Redis that never came up (default 5). The cache is optional; search works without it | `5` |
| `WEBHOOK_TARGET` | ❌ No | Where `npm run stripe:send` delivers its signed test event (default `http://localhost:PORT`). Dev tooling only — the server never reads it | `https://tunnel.example.com` |

---

## 🔍 Variable Explanations

### `SUPABASE_URL`

- **What it is:** The unique URL of your Supabase project.
- **Where to find it:** Log in to [Supabase Dashboard](https://supabase.com/dashboard) → Your Project → **Settings** → **API** → **Project URL**.
- **How it's used:** The `@supabase/supabase-js` client uses this URL to connect to your database and authentication services.

### `SUPABASE_SECRET_KEY`

- **What it is:** The Supabase **service role** key for server-side admin operations. This key bypasses Row-Level Security (RLS) and has full access to your database. It must **never** be exposed to the client side.
- **Where to find it:** Supabase Dashboard → Your Project → **Settings** → **API** → **service_role** key.
- **How it's used:** The server-side Supabase admin client uses this key for privileged operations like user management (e.g., `deleteUser`), database migrations, and admin-level queries.
- **⚠️ Security:** Never commit this key to version control. Only use it in the backend, never in client-side code.

### `STRIPE_SECRET_KEY`

- **What it is:** Your Stripe secret key for server-side payment operations. This key must **never** be exposed to the client side.
- **Where to find it:** Log in to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **API Keys**.
- **How it's used:** The Stripe SDK uses this key to create Payment Intents, process charges, handle webhooks, and manage customers.
- **⚠️ Security:** Never commit this key to version control. Use test keys (`sk_test_...`) during development.

---

### Frontend (`client/.env`)

The frontend uses a `.env` file located at `client/.env` for build-time environment variables:

| Variable | Required | Description | Example Value |
|----------|----------|-------------|---------------|
| `VITE_API_URL` | ✅ Yes | Backend API base URL (used by SearchForm and API calls) | `http://localhost:5000` |
| `VITE_SUPABASE_URL` | ✅ Yes | Your Supabase project URL (same as backend) | `https://abc123.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ Yes | Supabase anonymous (public) API key for client-side auth | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

> 💡 **Note:** When running via Docker Compose, these values are read from `client/.env` at build time. For cloud deployment, change `VITE_API_URL` to your production backend URL.

### `VITE_SUPABASE_PUBLISHABLE_KEY`

- **What it is:** The public anonymous key for your Supabase project. This key is safe to expose to the client side (it's meant to be public), but Row-Level Security (RLS) policies control what data can be accessed.
- **Where to find it:** Supabase Dashboard → Your Project → **Settings** → **API** → **anon public** key.
- **How it's used:** The client-side Supabase client uses this key to authenticate requests. RLS policies on your database tables determine what each request can read/write.

---

## 🛠️ Setup Instructions

### Step 1: Create the `.env` Files

```bash
# Backend
cp server/.env.example server/.env

# Frontend
cp client/.env.example client/.env
```

If no `.env.example` exists, create the file manually:

```bash
touch server/.env
```

### Step 2: Fill in Your Credentials

Open `server/.env` in your editor:

```env
# Transcenda Hotels — Environment Configuration

# Supabase (Database & Auth)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=your-service-role-key-here

# Stripe (Payments)
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
```

### Step 3: Verify the File is Git-Ignored

The `.gitignore` already excludes `.env` files:

```gitignore
# Local Environment Secret Profiles
.env
.env.local
.env.development.local
```

Verify with:

```bash
git check-ignore server/.env
# Should output: server/.env
```

---

## 🔄 How Variables Are Loaded

The backend uses **dotenv** to load variables at startup:

```typescript
// server/src/lib/supabaseClient.ts
import dotenv from 'dotenv';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);
```

The frontend uses Vite's built-in environment variable handling with the `import.meta.env` pattern:

```typescript
// client/src/lib/supabaseClient.ts
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePubKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabasePubKey);
```

When running via Docker Compose, the `.env` file is passed to the container:

```yaml
# docker-compose.yaml
services:
  backend:
    env_file:
      - ./server/.env
```

---

## 🧪 Development vs Production

| Environment | Supabase | Stripe Key | Notes |
|-------------|----------|------------|-------|
| **Development** | Free tier project | `sk_test_...` | Local Docker setup |
| **Production** | Paid tier project | `sk_live_...` | Deployed to cloud |

> 💡 **Tip:** Create separate Supabase projects and Stripe keys for development and production to keep data isolated.

---

## ❌ Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing `.env` file | Backend crashes on startup | Create `server/.env` with required variables |
| Wrong key type | Stripe API errors | Use `sk_test_...` for dev, `sk_live_...` for prod |
| Using `SUPABASE_ANON_KEY` instead of `SUPABASE_SECRET_KEY` on server | Admin operations fail with 401/403 | Use the **service_role** key from Supabase dashboard, not the anon public key |
| Using `SUPABASE_SECRET_KEY` on the client | Secret key exposed in browser | Never use the service role key on the frontend; use `VITE_SUPABASE_PUBLISHABLE_KEY` instead |
| Committed `.env` to git | Security leak | Add `.env` to `.gitignore` and rotate compromised keys |
| Typo in variable name | `undefined` environment variable | Check spelling matches exactly (`SUPABASE_URL` not `SUPABASE_URLS`) |

---

> 📖 See [Troubleshooting](troubleshooting) for help with common issues.
