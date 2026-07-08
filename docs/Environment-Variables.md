---
title: Environment Variables
nav_order: 7
description: All required environment variables for Transcenda Hotels, how to set them up, and where they're used.
---

# 🔐 Environment Variables

This page documents all required environment variables for Transcenda Hotels, how to set them up, and where they're used.

---

## 📋 Required Variables

The backend requires a `.env` file located at `server/.env`. Below is the complete list of variables:

| Variable | Required | Description | Example Value |
|----------|----------|-------------|---------------|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL | `https://abc123.supabase.co` |
| `SUPABASE_ANON_KEY` | ✅ Yes | Supabase anonymous (public) API key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `STRIPE_SECRET_KEY` | ✅ Yes | Stripe secret key for server-side payments | `sk_live_51H3...` or `sk_test_51H3...` |

---

## 🔍 Variable Explanations

### `SUPABASE_URL`

- **What it is:** The unique URL of your Supabase project.
- **Where to find it:** Log in to [Supabase Dashboard](https://supabase.com/dashboard) → Your Project → **Settings** → **API** → **Project URL**.
- **How it's used:** The `@supabase/supabase-js` client uses this URL to connect to your database and authentication services.

### `SUPABASE_ANON_KEY`

- **What it is:** The public anonymous key for your Supabase project. This key is safe to expose to the client side (it's meant to be public), but Row-Level Security (RLS) policies control what data can be accessed.
- **Where to find it:** Supabase Dashboard → Your Project → **Settings** → **API** → **anon public** key.
- **How it's used:** The Supabase client uses this key to authenticate requests. RLS policies on your database tables determine what each request can read/write.

### `STRIPE_SECRET_KEY`

- **What it is:** Your Stripe secret key for server-side payment operations. This key must **never** be exposed to the client side.
- **Where to find it:** Log in to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **API Keys**.
- **How it's used:** The Stripe SDK uses this key to create Payment Intents, process charges, handle webhooks, and manage customers.
- **⚠️ Security:** Never commit this key to version control. Use test keys (`sk_test_...`) during development.

---

## 🛠️ Setup Instructions

### Step 1: Create the `.env` File

```bash
# From the project root
cp server/.env.example server/.env
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
SUPABASE_ANON_KEY=your-anon-key-here

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
// server/src/index.ts
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
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
| Committed `.env` to git | Security leak | Add `.env` to `.gitignore` and rotate compromised keys |
| Typo in variable name | `undefined` environment variable | Check spelling matches exactly (`SUPABASE_URL` not `SUPABASE_URLS`) |

---

> 📖 See [Troubleshooting](troubleshooting) for help with common issues.
