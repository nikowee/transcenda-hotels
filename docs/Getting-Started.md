---
title: Getting Started
nav_order: 2
description: Set up the Transcenda Hotels project on your local machine for development and testing.
---

# 🏁 Getting Started with Transcenda Hotels

This guide will walk you through setting up the Transcenda Hotels project on your local machine for development and testing.

---

## 📋 Prerequisites

Make sure you have the following installed:

| Tool | Version | Purpose |
|------|---------|---------|
| **Docker Desktop** | Latest | Container orchestration for backend + frontend |
| **Git** | 2.x+ | Version control |
| **Node.js** (optional) | 20.x | Running locally without Docker |

> 🐳 **Docker Desktop is the recommended approach.** The entire stack runs in containers, so you don't need to install Node.js, npm, or any other runtime on your host machine.

---

## 🔽 Cloning the Repository

```bash
git clone https://github.com/your-org/transcenda-hotels.git
cd transcenda-hotels
```

The project structure looks like this:

```
transcenda-hotels/
├── client/              # React frontend (Vite + Tailwind)
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── server/              # Express backend API
│   ├── Dockerfile
│   ├── package.json
│   ├── .env
│   ├── src/
│   │   ├── index.ts
│   │   ├── controllers/
│   │   │   └── destinationController.ts  # Fuse.js search
│   │   └── data/
│   │       └── destinations.json         # Destination dataset
│   └── .env
├── docker-compose.yaml  # Orchestrates both services
├── docs/                # Documentation (Just-the-Docs)
└── README.md
```

---

## 🔐 Creating Environment Files

Both the backend and frontend require `.env` files for configuration. Copy the example files:

```bash
# Backend
cp server/.env.example server/.env

# Frontend
cp client/.env.example client/.env
```

> ⚠️ **Important:** If there is no `.env.example` file yet, create the `.env` files manually with the required variables. See the [Environment Variables](environment-variables) page for details.

### Backend

Open `server/.env` and fill in your credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
STRIPE_SECRET_KEY=your_stripe_secret_key
```

### Frontend

The frontend `.env` file configures the API base URL used by the search form and other API calls:

```env
VITE_API_URL=http://localhost:5000
```

> 💡 For cloud deployment, change `VITE_API_URL` to your production backend URL (e.g., `https://api.yourdomain.com`).

---

## 🚀 One-Command Start

Build and launch both services with a single command:

```bash
docker compose up --build
```

This command will:

1. 🏗️ **Build** the Docker images for `backend` and `frontend`
2. 📦 **Install** dependencies inside each container (`npm ci`)
3. 🔗 **Link** the services together (frontend depends on backend)
4. 🔄 **Start** hot-reloading development servers

### Expected Output

You should see logs from both containers:

```
backend  | 🚀 Transcenda Hotels Backend running natively on http://localhost:5000
frontend | ➜  Local:   http://localhost:3000/
```

---

## 🌐 Access Points

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | [http://localhost:3000](http://localhost:3000) | React UI |
| **Backend API** | [http://localhost:5000](http://localhost:5000) | Express REST API |
| **Health Check** | [http://localhost:5000/api/health](http://localhost:5000/api/health) | Backend health endpoint |

---

## ✅ Verification Steps

1. **Check the health endpoint:**

   ```bash
   curl http://localhost:5000/api/health
   ```

   Expected response:
   ```json
   { "status": "healthy", "project": "Transcenda Hotels Gateway Operational" }
   ```

2. **Verify the frontend loads:**
   Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the Transcenda Hotels UI.

3. **Check running containers:**

   ```bash
   docker ps
   ```

   You should see two containers running: `transcenda-hotels-backend` and `transcenda-hotels-frontend`.

---

## 🛑 Stopping the Services

```bash
# Stop containers (keep data)
docker compose down

# Stop containers and remove volumes (clean slate)
docker compose down -v
```

---

> ✅ **You're all set!** Next, check out the [Development Workflow](development-workflow) guide for tips on day-to-day development.
