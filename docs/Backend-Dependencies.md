---
title: Backend Dependencies
nav_order: 6
description: Production and development dependencies for the Express backend.
---

# 📦 Backend Dependencies

This page lists all production and development dependencies for the Express backend (`server/package.json`), along with explanations of why each was chosen.

---

## 🚀 Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | `^5.2.1` | Web framework for building the REST API |
| `@supabase/supabase-js` | `^2.110.1` | Supabase client SDK for database and auth (admin client) |
| `stripe` | `^22.3.0` | Stripe server SDK for payment processing |
| `axios` | `^1.18.1` | HTTP client for external API calls |
| `cors` | `^2.8.6` | Cross-Origin Resource Sharing middleware |
| `fuse.js` | `^7.4.2` | Fuzzy-search library for destination autocomplete |
| `dotenv` | `^17.4.2` | Loads `.env` file variables into `process.env` |

### Why Each Was Chosen

#### 🌐 Express 5
The latest major version of the most popular Node.js web framework. Express 5 introduces:
- **Async error handling** — async route handlers automatically forward errors to error middleware
- **Path matching improvements** — more intuitive route pattern syntax
- **Modernized API** — dropped deprecated APIs from Express 4

Chosen over alternatives like Fastify or Hono for its massive ecosystem, middleware compatibility, and team familiarity.

#### 🗄️ @supabase/supabase-js
The official Supabase JavaScript client providing:
- **PostgreSQL access** — query the database with full SQL or the Supabase client API
- **Row-Level Security** — built-in support for Supabase auth policies
- **Real-time subscriptions** — listen to database changes (future use)
- **Authentication** — built-in auth methods for user login/signup

Chosen over raw `pg`/`pg-pool` for its higher-level abstractions, auth integration, and real-time capabilities.

The backend uses the **service role key** to create an admin client for privileged operations (e.g., user management via `deleteUser`), while the frontend uses the **anonymous public key** for client-side auth with Row-Level Security (RLS) enforcement.

#### 💳 stripe
The official Stripe Node.js SDK for payment processing:
- **Payment Intents API** — secure, SCA-compliant payments
- **Webhook verification** — built-in signature validation
- **Idempotency support** — prevents duplicate charges
- **TypeScript types** — full type definitions included

Chosen as the industry standard for online payment processing with the best developer experience and documentation.

#### 📡 axios
Same HTTP client used on the frontend, chosen for the backend for:
- **Server-to-server API calls** — communicating with external services
- **Consistent API** — same API as the frontend, reducing context switching
- **Interceptors** — logging, error handling, and retry logic
- **Timeout handling** — preventing hung requests

#### 🔍 fuse.js
A lightweight fuzzy-search library running server-side to power the destination autocomplete search. When a user types in the search form, the frontend sends a request to `GET /api/destinations/search?q=<query>`, and the backend uses Fuse.js to fuzzy-match against the destinations dataset loaded from `server/src/data/destinations.json`. Chosen for:
- **Tolerance to typos** — threshold of `0.3` catches partial/imperfect matches
- **Zero external dependencies** — no external API calls, runs entirely in-process
- **Fast performance** — in-memory index, responses in milliseconds
- **Simple API** — configure once at startup, search with a single call

#### 🔓 cors
Express middleware for handling Cross-Origin Resource Sharing. Enables the frontend (port 3000) to make requests to the backend (port 5000) during development. Chosen for its simplicity and zero-config setup for development.

#### 🔐 dotenv
Loads environment variables from a `.env` file into `process.env`. Chosen for:
- **12-Factor App compliance** — configuration stored in environment
- **Security** — secrets never committed to version control
- **Simplicity** — just `import 'dotenv/config'` at the entry point

---

## 🛠️ Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | `^6.0.3` | TypeScript compiler for static type checking |
| `tsx` | `^4.23.0` | TypeScript runtime executor with watch mode |
| `@types/express` | `^5.0.6` | TypeScript type definitions for Express |
| `@types/cors` | `^2.8.19` | TypeScript type definitions for CORS |
| `@types/node` | `^26.1.1` | TypeScript type definitions for Node.js APIs |

### Why Each Was Chosen

#### 📘 TypeScript 6
The latest TypeScript compiler providing static type checking for the backend. Chosen to maintain **end-to-end type safety** across the full stack, share types between frontend and backend, and catch errors at compile time.

#### ⚡ tsx
A TypeScript runtime executor built on top of esbuild. It serves as the **development runner** for the backend:
- **Instant compilation** — esbuild-based, 10-100x faster than `ts-node`
- **Watch mode** — `tsx watch src/index.ts` automatically restarts on file changes
- **ESM support** — works with `"type": "module"` in `package.json`
- **Zero configuration** — no `tsconfig.json` tweaks needed

Chosen over `ts-node` and `tsx` (the latter being the same tool) for its speed and simplicity. The `esbuild` dependency is allowed via `allowScripts` in `package.json`.

#### 📋 Type Definitions (@types/*)
These packages provide TypeScript type declarations for Express, CORS, and Node.js APIs, enabling:
- **Full IDE autocompletion** — IntelliSense for Express request/response objects
- **Compile-time safety** — catch API misuse before runtime
- **Self-documenting code** — types serve as inline documentation

---

## 📦 Dependency Graph

```
backend/
├── express              ← Web framework (core)
│   └── cors             ← CORS middleware
├── fuse.js              ← Fuzzy search (destination autocomplete)
├── @supabase/supabase-js ← Database & auth client
├── stripe               ← Payment processing (future)
├── axios                ← HTTP client
├── dotenv               ← Environment config
├── typescript (dev)     ← Type checking
└── tsx (dev)            ← Dev server runner
```

---

## ⚠️ Allow Scripts

The `package.json` includes an `allowScripts` configuration:

```json
"allowScripts": {
  "esbuild@0.28.1": true
}
```

This is required because **tsx** depends on **esbuild**, which uses native `postinstall` scripts to download platform-specific binaries. The `allowScripts` field explicitly permits this for the Docker build environment while maintaining security.

---

> 📖 See [Frontend Dependencies](frontend-dependencies) for the client-side package breakdown.
