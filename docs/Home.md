---
title: Welcome
nav_order: 0
description: Welcome to Transcenda Hotels - a modern, full-stack hotel booking platform.
---

# 🏨 Welcome to Transcenda Hotels

> **A modern, full-stack hotel booking platform built with React, Express, Docker, and Supabase.**

Transcenda Hotels is a production-ready hotel reservation system designed with developer experience, security, and scalability in mind. From hot-reloading containers to Stripe payment integration, every component is crafted for real-world deployment.

---

## ✨ Key Features

- 🔐 **Secure by Default** — Containers run as a non-root `node` user; no root privileges inside Docker.
- ⚡ **Instant Hot Reload** — Both frontend (Vite + SWC) and backend (tsx watch) update in real time during development.
- 🐳 **Zero-Config Docker Setup** — One command (`docker compose up --build`) spins up the entire stack.
- 🔍 **Smart Destination Search** — Fuzzy autocomplete search powered by Fuse.js on the backend with debounced API calls.
- 🏠 **Landing Page** — Modern hero section with search form, date pickers, and guest/room selectors.
- 💳 **Stripe Payments** — Full payment processing pipeline ready for integration.
- 🗄️ **Supabase PostgreSQL** — Cloud-native database with row-level security.
- 🧩 **TypeScript Everywhere** — End-to-end type safety across frontend and backend.
- 🎨 **Tailwind CSS v4** — Utility-first styling with the latest Tailwind engine.
- 🔮 **AI Ready** — LangChain architecture planned for future AI-powered features.

---

## 🧰 Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript 6 + Vite 8 + SWC + Tailwind CSS 4 |
| **Backend** | Express 5 + TypeScript 6 + tsx |
| **Database** | Supabase PostgreSQL |
| **Payments** | Stripe SDK |
| **Containerization** | Docker + Docker Compose |
| **Linting** | Oxlint |
| **Future AI** | LangChain |

---

## 📖 Quick Links

| Page | Description |
|------|------------|
| [🏁 Getting Started](getting-started) | Prerequisites, setup, and first run |
| [🛠️ Development Workflow](development-workflow) | Hot reloading, Docker commands, local dev |
| [🏗️ Architecture](architecture) | System design, data flow, container security |
| [📦 Frontend Dependencies](frontend-dependencies) | Client package breakdown |
| [📦 Backend Dependencies](backend-dependencies) | Server package breakdown |
| [🔐 Environment Variables](environment-variables) | Required config and secrets |
| [💳 UC4 — Book & Make Payment](uc4-book-and-make-payment) | Booking flow diagrams and security properties |
| [🧪 Testing](testing) | Test suites, how to run them, security regressions |
| [📡 API Reference](api-reference) | Complete API endpoint documentation |
| [🚀 Deployment](deployment) | AWS + Supabase: images, secrets, migrations, webhook, scale rules |
| [🐛 Troubleshooting](troubleshooting) | Common issues and fixes |
| [🤝 Contributing](contributing) | Branch naming, commits, PRs |

---

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/transcenda-hotels.git
cd transcenda-hotels

# 2. Create environment files
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Launch everything
docker compose up --build
```

- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:5000](http://localhost:5000)
- **Health Check:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

---

> 💡 **First time?** Head over to the [Getting Started](getting-started) guide for a detailed walkthrough.
