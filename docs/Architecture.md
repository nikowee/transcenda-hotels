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
| **Backend** | REST API, business logic, auth | Express 5 + TypeScript 6 + tsx | `5000` |
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
// Conceptual route structure
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/hotels" element={<HotelList />} />
  <Route path="/hotels/:id" element={<HotelDetail />} />
  <Route path="/booking" element={<Booking />} />
  <Route path="/admin" element={<AdminDashboard />} />
</Routes>
```

---

## 🖥️ Backend Architecture

### Stack

```
Express 5 + TypeScript 6
    ↓
tsx watch (development runner)
    ↓
Supabase SDK (database)
    ↓
Stripe SDK (payments)
    ↓
dotenv (environment config)
```

### API Structure

```
server/src/
├── index.ts              # Entry point, middleware setup
├── routes/               # Route handlers
├── controllers/          # Business logic
├── middleware/           # Auth, validation, error handling
└── utils/                # Helpers, config, types
```

### Current Entry Point

```typescript
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

app.listen(PORT, () => {
  console.log(`🚀 Transcenda Hotels Backend running on http://localhost:${PORT}`);
});
```

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
│  • User clicks "Book Now"   │
│  • Axios POST /api/bookings │
└──────────┬──────────────────┘
           │ HTTP Request
           ▼
┌─────────────────────────────┐
│  Backend (Express + tsx)    │
│  • CORS middleware          │
│  • JSON body parser         │
│  • Route handler            │
│  • Controller logic         │
└──────────┬──────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│ Supabase│ │ Stripe  │
│ (DB)    │ │(Payment)│
└─────────┘ └─────────┘
     │           │
     └─────┬─────┘
           ▼
┌─────────────────────────────┐
│  Response (JSON)            │
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
| Backend ↔ Supabase | Backend → DB | HTTPS + REST | JSON |
| Backend ↔ Stripe | Backend → Stripe | HTTPS + REST | JSON |

---

> 📖 See [Environment Variables](environment-variables) for configuration details, or [Frontend Dependencies](frontend-dependencies) / [Backend Dependencies](backend-dependencies) for package breakdowns.
