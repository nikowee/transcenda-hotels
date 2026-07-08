# 🛠️ Development Workflow

This guide covers day-to-day development practices for Transcenda Hotels.

---

## 🔄 Hot Reloading

Both the frontend and backend support **hot reloading** out of the box when running via Docker Compose.

### How It Works

| Service | Tool | Mechanism | File Watcher |
|---------|------|-----------|-------------|
| **Frontend** | Vite + SWC | HMR (Hot Module Replacement) | Vite dev server watches `client/` |
| **Backend** | tsx watch | File watcher + Node.js restart | tsx watches `server/` |

### Key Detail: Bind Mounts

In `docker-compose.yaml`, bind mounts are configured to sync your local files into the container:

```yaml
volumes:
  - ./server:/app          # Bind Mount: Local changes → container
  - /app/node_modules      # Anonymous Volume: Ignores local node_modules
```

This means:
- ✅ **Any edit** to a file in `client/` or `server/` instantly triggers a reload inside the container.
- ✅ **No rebuild needed** for code changes — just save the file.
- ❌ **Do NOT** install npm packages locally — always run `npm install` inside the container.

> 💡 **Tip:** Use `docker compose up` (without `--build`) after the initial build to skip the image rebuild and go straight to running containers.

---

## 🐳 Common Docker Commands

| Command | Description |
|---------|-------------|
| `docker compose up --build` | Build images and start all services |
| `docker compose up` | Start services (reuses existing images) |
| `docker compose down` | Stop and remove containers |
| `docker compose down -v` | Stop, remove containers + volumes (clean slate) |
| `docker compose build` | Rebuild images without starting |
| `docker compose logs -f` | Follow live logs from all services |
| `docker compose logs -f backend` | Follow logs from backend only |
| `docker compose exec backend sh` | Open a shell inside the backend container |
| `docker compose exec frontend sh` | Open a shell inside the frontend container |
| `docker ps` | List running containers |

### Installing New Packages

To add an npm package, open a shell inside the container and install it there:

```bash
# Install a backend dependency
docker compose exec backend npm install some-package

# Install a frontend dependency
docker compose exec frontend npm install some-package
```

After installing, **rebuild the images** to persist the dependency:

```bash
docker compose up --build
```

---

## 💻 Running Locally Without Docker

If you prefer to run services directly on your host machine (without Docker), follow these steps:

### Backend

```bash
cd server
npm install
npm run dev
```

The backend starts at [http://localhost:5000](http://localhost:5000).

### Frontend

```bash
cd client
npm install
npm run dev
```

The frontend starts at [http://localhost:3000](http://localhost:3000).

> ⚠️ **Note:** When running locally, make sure:
> - You have **Node.js 20+** installed
> - The backend `.env` file is properly configured
> - No other services are running on ports 3000 or 5000

---

## 📝 Available Scripts

### Backend (`server/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/index.ts` | Start dev server with hot reload |
| `build` | `tsc` | Compile TypeScript to JavaScript |
| `type-check` | `tsc --noEmit` | Check types without emitting files |

### Frontend (`client/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Start Vite dev server with HMR |
| `build` | `tsc -b && vite build` | Type-check and build for production |
| `lint` | `oxlint` | Run Oxlint static analysis |
| `preview` | `vite preview` | Preview production build locally |

---

## 🧪 Git Workflow

### Branch Naming

Use descriptive names with forward slashes:

```
feature/add-payment-form
fix/stripe-webhook-error
chore/update-dependencies
refactor/api-middleware
docs/add-troubleshooting-guide
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Stripe payment intent endpoint
fix: resolve CORS issue on booking creation
chore: bump axios to 1.18.1
docs: update getting-started guide
refactor: extract validation middleware
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear, atomic commits
3. Push the branch and open a PR
4. Ensure all checks pass (type-check, lint)
5. Request a review
6. Squash-merge into `main`

---

> 📖 For detailed contribution guidelines, see [Contributing](Contributing).