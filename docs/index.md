---
title: Home
nav_order: 1
description: Welcome to the official documentation for the Transcenda Hotels booking platform.
---

# 🏨 Transcenda Hotels Documentation

Welcome to the official documentation for the Transcenda Hotels booking platform.

---

## 📖 Documentation Overview

| Section | Description |
| :--- | :--- |
| [Getting Started](getting-started) | Set up the project locally with Docker |
| [Development Workflow](development-workflow) | Daily commands, hot reloading, and Git workflow |
| [Architecture](architecture) | System design, Docker security, and tech stack |
| [Frontend Dependencies](frontend-dependencies) | React, Vite, Tailwind, and frontend packages |
| [Backend Dependencies](backend-dependencies) | Express, Supabase, Stripe, and backend packages |
| [Environment Variables](environment-variables) | Required env vars for Supabase and Stripe |
| [UC4 — Book & Make Payment](uc4-book-and-make-payment) | Booking flow diagrams and security properties |
| [Testing](testing) | Test suites, how to run them, security regressions |
| [Deployment](deployment) | AWS + Supabase: images, secrets, webhook, scale rules |
| [Troubleshooting](troubleshooting) | Common issues and how to fix them |
| [Contributing](contributing) | Branching, commits, code style, and PR process |

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