# 🏨 Transcenda Hotels Documentation

Welcome to the official documentation for the Transcenda Hotels booking platform.

---

## 📖 Documentation Overview

| Section | Description |
| :--- | :--- |
| [Getting Started](./getting-started.md) | Set up the project locally with Docker |
| [Development Workflow](./development-workflow.md) | Daily commands, hot reloading, and Git workflow |
| [Architecture](./architecture.md) | System design, Docker security, and tech stack |
| [Frontend Dependencies](./frontend-dependencies.md) | React, Vite, Tailwind, and frontend packages |
| [Backend Dependencies](./backend-dependencies.md) | Express, Supabase, Stripe, and backend packages |
| [Environment Variables](./environment-variables.md) | Required env vars for Supabase and Stripe |
| [Troubleshooting](./troubleshooting.md) | Common issues and how to fix them |
| [Contributing](./contributing.md) | Branching, commits, code style, and PR process |

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/transcenda-hotels.git
cd transcenda-hotels

# Set up environment variables
# This isnt made yet so dont do this
cp server/.env.example server/.env

# Launch the entire stack
docker compose up --build
```