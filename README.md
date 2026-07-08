# Transcenda Hotels

Transcenda Hotels is an enterprise-grade, white-label hotel booking platform and AI-driven itinerary planner. Built as a decoupled monorepo, the project pairs a high-performance frontend client with a secure, hardened Express API gateway proxy.

The entire runtime infrastructure is fully containerized, operating under strict non-root security policies and absolute environment parity to abstract away cross-platform dependency footprints.

---

## 🏗️ System Architecture & Layout

This project operates as a monorepo utilizing structural layer isolation. Frontend presentation assets are strictly partitioned from backend business workflows, integration modules, and data engines.

```text
├── client/                     # FRONTEND APPLICATIONS LAYER
│   ├── src/
│   │   ├── components/         # Reusable presentation view boxes
│   │   ├── pages/              # Router page view boundaries (Features 1-4)
│   │   └── App.tsx             # React Router v7 configuration center
│   ├── Vite.config.ts          # Managed via React SWC & Tailwind v4 execution channels
│   └── Dockerfile              # Secure non-root frontend runtime manifest
├── server/                     # BACKEND INFRASTRUCTURE LAYER
│   ├── src/
│   │   ├── controllers/        # Request/Response validation and traffic directors
│   │   ├── services/           # Heavy programmatic processes (API Polling, AI Engines)
│   │   └── index.ts            # Central runtime execution server hub
│   ├── tsconfig.json           # Optimized type-checking schema configurations
│   └── Dockerfile              # Hardened non-root server runtime manifest
├── data/                       # Shared storage vault for static JSON asset maps
└── docker-compose.yml          # Global multi-service orchestrator script

```

---

## ⚡ Quick Start & Loading Environment Setup

### Prerequisites

* **Docker Desktop** installed and running on your host system.
* **Git** version control tool interface active.

### Workspace Ignition

To download system dependencies, link secure internal networks, configure local mount boundaries, and launch the localized execution environments, navigate to your root directory terminal and deploy the orchestration runtime command:

```bash
docker compose up --build

```

> ⚠️ **Critical Runtime Note:** The local system architecture executes real-time hot-reloading file mirrors (Bind Mounts) while utilizing **Docker Anonymous Volumes** to isolate the containerized `node_modules` folders. This completely blocks local operating system discrepancies (e.g., Windows paths vs. Mac ARM binaries) from altering the internal application build states.

Once the logging channels stabilize:

* The Frontend UI interface is accessible at: `http://localhost:3000`
* The Backend API health checkpoint is active at: `http://localhost:5000/api/health`

---

## 🌿 Collaborative Git Workflow Protocol

To protect main environments from regression bugs and keep code histories pristine, all developers must strictly adhere to the following branching rules and lifecycle steps.

### Branching Architecture Rules

* **`main` (Production Tracking):** Sacred space containing stable, fully deployed milestones. Direct pushes or unreviewed integrations are physically blocked by repository rule sets.
* **`development` (Staging Ground):** The target hub for continuous integration testing. All developers merge here to review cohesive system mechanics.
* **`feature/issue-id-descriptive-slug` (The Sandbox):** Completely isolated sandbox spaces where individual ticket logic is completed.

### The 5-Step Execution Cycle

Whenever a teammate claims a functional task or starts building out an assigned ticket on the Kanban tracking system, they must execute this exact command pipeline sequentially:

#### 1. Synchronize Staging Environments

Switch your terminal instance context back over to the staging branch and capture the absolute newest changes from origin:

```bash
git checkout development
git pull origin development

```

#### 2. Initialize a Sandbox Branch

Isolate a fresh development sandbox branched away from the updated staging grounds:

```bash
git checkout -b feature/your-ticket-id-summary-slug

```

*(Example: `git checkout -b feature/14-hotel-card-styling`)*

#### 3. Execute Infrastructure Builds

Launch the local multi-container network array inside your sandbox to write your component codes with hot-reloading active:

```bash
docker compose up --build

```

> 🚫 **The Lockfile Mandate:** If you add custom auxiliary libraries or system adjustments, **never run `npm install**`. You must execute **`npm ci` (Clean Install)** inside the localized directory parameters. This forces the system to map dependencies precisely against the unchangeable `package-lock.json` manifest, keeping package configurations stable across all computers.

#### 4. Stage and Deliver Contributions

Commit your modifications using descriptive, semantic tags and push your sandbox parameters straight to remote management tracking layers:

```bash
git add .
git commit -m "feat: complete layout schema and prop definitions for result card components"
git push origin feature/your-ticket-id-summary-slug

```

#### 5. Request Peer Review & Code Integration

1. Navigate to the online repository interface on GitHub.
2. Select **Pull Request** and map your branch parameters precisely: **`base: development`** $\leftarrow$ **`compare: feature/your-branch`**.
3. Detail your testing confirmations within the submission context window and tag the Technical Lead to execute core checks before your sandbox code is allowed inside the main build engine.


# [Transcenda Hotels Documentation]([./docs/getting-started.md]([https://github.com/nikowee/transcenda-hotels/blob/main/docs/environment-variables.md](https://nikowee.github.io/transcenda-hotels/)))
