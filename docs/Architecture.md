---
title: Architecture
nav_order: 4
description: High-level architecture of Transcenda Hotels, including containerization, frontend/backend design, and data flow.
---

# 🏗️ Architecture

This page describes the high-level architecture of Transcenda Hotels, including containerization, frontend/backend design, and data flow.

---

## 🌐 High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Host                          │
│                                                          │
│  ┌──────────────────┐      ┌──────────────────┐         │
│  │    Frontend       │      │     Backend      │         │
│  │  (React + Vite)   │─────▶│  (Express + tsx) │         │
│  │   Port :3000      │      │   Port :5000     │         │
│  └──────────────────┘      └────────┬─────────┘         │
│                                      │                   │
│                                      ▼                   │
│                            ┌──────────────────┐         │
│                            │  destinations    │         │
│                            │     .json        │         │
│                            │  (Fuse.js index) │         │
│                            └──────────────────┘         │
│                                      │                   │
│                                      ▼                   │
│                            ┌──────────────────┐         │
│                            │    Supabase      │         │
│                            │  (PostgreSQL)    │         │
│                            │   (Cloud-hosted) │         │
│                            └──────────────────┘         │
│                                      │                   │
│                                      ▼                   │
│                            ┌──────────────────┐         │
│                            │     Stripe       │         │
│                            │  (Payments API)  │         │
│                            └──────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

### Services Overview

| Service | Role | Tech | Port |
|---------|------|------|------|
| **Frontend** | User interface & client-side logic | React 19 + Vite 8 + Tailwind 4 | `3000` |
| **Backend** | REST API, business logic, auth, destination search | Express 5 + TypeScript 6 + tsx + Fuse.js | `5000` |
| **Supabase** | Database & authentication | PostgreSQL (cloud) | External |
| **Stripe** | Payment processing | Stripe SDK | External |

---

## 🐳 Docker Containerization + Security

### Container Architecture

```yaml
services:
  backend:
    build: ./server          # Dockerfile based on node:20-alpine
    ports: 5000:5000
    volumes:
      - ./server:/app        # Bind mount for hot reload
      - /app/node_modules    # Anonymous volume (prevents OS conflicts)
    command: npm run dev     # tsx watch

  frontend:
    build: ./client          # Dockerfile based on node:20-alpine
    ports: 3000:3000
    volumes:
      - ./client:/app        # Bind mount for hot reload
      - /app/node_modules    # Anonymous volume
    depends_on:
      - backend
```

### Security Practices

| Practice | Implementation |
|----------|---------------|
| **🔒 Non-Root User** | Both Dockerfiles switch to `node` user after `npm ci` |
| **📁 Ownership Lockdown** | `RUN chown -R node:node /app` — no root-owned files |
| **📦 Pristine Install** | `npm ci` (not `npm install`) — ensures lockfile integrity |
| **🧹 No Local Conflicts** | Anonymous volume `/app/node_modules` isolates container deps |

```dockerfile
# From server/Dockerfile — the security pattern
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN chown -R node:node /app   # 🔐 Lock down ownership
USER node                     # 🔐 Drop root privileges
COPY --chown=node:node . .
EXPOSE 5000
```

### Volume Strategy

```
./server:/app          → Bind Mount: Live code sync for hot reload
/app/node_modules      → Anonymous Volume: Blocks local OS node_modules from leaking in
```

This dual-volume strategy ensures:
- ✅ **Your code changes** are instantly reflected inside the container
- ❌ **Your local `node_modules`** (which may be compiled for a different OS) never interferes with the container

---

## ⚛️ Frontend Architecture

### Stack

```
React 19 + TypeScript 6
    ↓
SWC Compiler (via @vitejs/plugin-react)
    ↓
    Vite 8 Dev Server (HMR)
    ↓
Tailwind CSS v4 (via @tailwindcss/vite)
    ↓
Oxlint (linting)
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Vite over Webpack** | Blazing fast HMR with native ESM; SWC-based compilation |
| **SWC over Babel** | 10-20x faster compilation; built into `@vitejs/plugin-react` |
| **Tailwind v4** | Latest utility-first engine; smaller bundle; CSS-first config |
| **Oxlint over ESLint** | 50-100x faster linting; built-in rules; zero config |
| **React Router v8** | Latest version with loader/action patterns |

### Routing

React Router v8 handles client-side routing with a declarative route tree:

```tsx
// client/src/App.tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/results" element={<ResultsPage />} />
  </Routes>
</BrowserRouter>
```

| Route | Page | Description |
|-------|------|-------------|
| `/` | `LandingPage` | Hero section with search form, navigation bar |
| `/results` | `ResultsPage` | Destination search results (placeholder) |

---

## 🖥️ Backend Architecture

### Stack

```
Express 5 + TypeScript 6
    ↓
tsx watch (development runner)
    ↓
Fuse.js (fuzzy search engine for destination autocomplete)
    ↓
Supabase SDK (database & auth)
    ↓
Stripe SDK (payments — future)
```

### API Structure

```
server/src/
├── index.ts                     # Entry point, middleware & routes setup
├── controllers/
│   └── destinationController.ts # Fuse.js-powered destination search
├── data/
│   └── destinations.json        # Destination dataset (loaded at startup)
├── lib/
│   └── supabaseClient.ts        # Supabase admin client & auth helpers
└── utils/                       # Helpers, config, types (future)
```

### Current Entry Point

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { searchDestinations } from './controllers/destinationController';
import { supabaseAdmin } from './lib/supabaseClient';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

// Destination Search (autocomplete)
app.get('/api/destinations/search', searchDestinations);

// Supabase test endpoint (debugging)
app.get('/api/supabase-test', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .limit(1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default app;
```

### Supabase Client

The backend uses a Supabase **admin client** initialized with the service role key for privileged operations. Located at `server/src/lib/supabaseClient.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey);

// Helper: delete a user by ID (for account management)
export const deleteUser = async (userId: string) => {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;
};
```

The client-side Supabase client (at `client/src/lib/supabaseClient.ts`) uses the **anonymous public key** instead:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePubKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabasePubKey);

export const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
};

export const isAuthenticated = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
};
```

> **Note:** The client-side client enforces Row-Level Security (RLS) policies, while the server-side admin client bypasses RLS for administrative tasks.

### Destination Search Controller

The destination search uses **Fuse.js**, a client-compatible fuzzy search library, running server-side. Key details:

- **Data source**: `server/src/data/destinations.json` — loaded once at server startup
- **Fuse options**: `keys: ['term']`, `threshold: 0.3` — tolerates typos and partial matches
- **Results**: Limited to top 5 matches to keep payloads small
- **Safety guard**: Returns empty array if query is less than 2 characters

---

## 🔄 Data Flow

### Request Lifecycle

```
User Action (Browser)
    │
    ▼
┌─────────────────────────────┐
│  Frontend (React + Vite)    │
│  • Component renders        │
│  • User types in search     │
│  • Debounce (300ms)         │
│  • Axios GET /api/...       │
└──────────┬──────────────────┘
           │ HTTP Request
           ▼
┌─────────────────────────────┐
│  Backend (Express + tsx)    │
│  • CORS middleware          │
│  • JSON body parser         │
│  • Route handler            │
│  • Controller logic         │
│  • Fuse.js fuzzy search     │
└──────────┬──────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐      ┌───────────┐
│destina- │ │Supabase │      │  Stripe   │
│tions    │ │ (DB)    │      │ (Payment) │
│.json    │ │         │      │ (future)  │
└─────────┘ └─────────┘      └───────────┘
     │           │                │
     └─────┬─────┘                │
           ▼                      │
┌─────────────────────────────┐   │
│  Response (JSON)            │◄──┘
│  • Destination results      │
│  • Booking confirmation     │
│  • Payment status           │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Frontend Update            │
│  • State update             │
│  • UI re-render             │
│  • Success/error toast      │
└─────────────────────────────┘
```

### Key Integration Points

| Integration | Direction | Protocol | Data Format |
|-------------|-----------|----------|-------------|
| Frontend ↔ Backend | Bidirectional | HTTP REST | JSON |
| Backend → destinations.json | Backend → File | Read (sync) | JSON |
| Backend ↔ Supabase | Backend → DB | HTTPS + REST | JSON |
| Backend ↔ Stripe | Backend → Stripe | HTTPS + REST | JSON (future) |

---

## 📡 API Reference

For a complete list of all available API endpoints with request/response examples, error codes, and usage guides, see the dedicated **[API Reference](api-reference)** page.

---

> 📖 See [Environment Variables](environment-variables) for configuration details, or [Frontend Dependencies](frontend-dependencies) / [Backend Dependencies](backend-dependencies) for package breakdowns.