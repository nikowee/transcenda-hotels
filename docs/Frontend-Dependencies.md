# 📦 Frontend Dependencies

This page lists all production and development dependencies for the React frontend (`client/package.json`), along with explanations of why each was chosen.

---

## 🚀 Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | `^19.2.7` | Core UI library for building component-based interfaces |
| `react-dom` | `^19.2.7` | React renderer for the DOM (browser) |
| `react-router` | `^8.1.0` | Client-side routing with loaders, actions, and nested routes |
| `axios` | `^1.18.1` | HTTP client for API requests to the backend |
| `lucide-react` | `^1.23.0` | Lightweight, tree-shakeable icon library |
| `fuse.js` | `^7.4.2` | Fuzzy-search library for client-side search/filter |

### Why Each Was Chosen

#### ⚛️ React 19
The latest stable React release with improved concurrent features, server components support, and enhanced hooks. Chosen for its massive ecosystem, performance, and developer tooling.

#### 🌐 react-router 8
The newest version of the most popular React routing library. It introduces a data-loading pattern with loaders and actions, making data fetching co-located with routes. Chosen over alternatives like TanStack Router for its maturity and widespread adoption.

#### 📡 axios
A promise-based HTTP client with automatic JSON parsing, request/response interceptors, and timeout handling. Chosen over the native `fetch` API for:
- Automatic JSON transformation
- Request cancellation support
- Interceptors for auth tokens and error handling
- Better browser compatibility

#### 🎨 lucide-react
A community-driven fork of Feather Icons. Each icon is an individual React component that can be tree-shaken, resulting in zero unused icon code in the final bundle. Chosen over Font Awesome for its smaller footprint and modern SVG-based approach.

#### 🔍 fuse.js
A lightweight fuzzy-search library that works entirely on the client side. Chosen for implementing search functionality (hotel names, locations, amenities) without requiring additional backend endpoints or database full-text search.

---

## 🛠️ Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | `^8.1.1` | Build tool and dev server with native ESM and HMR |
| `@vitejs/plugin-react` | `^6.0.3` | Vite plugin enabling React Fast Refresh via SWC |
| `tailwindcss` | `^4.3.2` | Utility-first CSS framework |
| `@tailwindcss/vite` | `^4.3.2` | Tailwind CSS v4 Vite plugin for on-the-fly CSS generation |
| `typescript` | `~6.0.2` | TypeScript compiler for static type checking |
| `@types/react` | `^19.2.17` | TypeScript type definitions for React |
| `@types/react-dom` | `^19.2.3` | TypeScript type definitions for ReactDOM |
| `@types/node` | `^24.13.2` | TypeScript type definitions for Node.js APIs |
| `oxlint` | `^1.71.0` | Rust-based linter (replaces ESLint) |

### Why Each Was Chosen

#### ⚡ Vite 8
The next-generation build tool that leverages native ES modules for an instant dev server start and true HMR. Chosen over Webpack for:
- **10-100x faster** cold starts
- **Instant HMR** — updates in <50ms regardless of app size
- **SWC-based** compilation via `@vitejs/plugin-react`
- **Native TypeScript** support without additional plugins

#### 🔥 @vitejs/plugin-react (SWC)
Uses the SWC compiler (written in Rust) instead of Babel for React JSX transformation and Fast Refresh. SWC is **10-20x faster** than Babel, making builds and HMR significantly quicker.

#### 🎨 Tailwind CSS v4
The latest version of the utility-first CSS framework. Version 4 introduces:
- **CSS-first configuration** — no more `tailwind.config.js`
- **Smaller bundles** — automatic unused style removal
- **Native CSS cascade layers** — better specificity management
- **`@tailwindcss/vite` plugin** — zero-config integration with Vite

#### 🦀 Oxlint
A Rust-based linter that replaces ESLint entirely. It's **50-100x faster** than ESLint, has 500+ built-in rules, requires zero configuration, and supports TypeScript and JSX out of the box. Chosen over ESLint for its speed and simplicity.

#### 📘 TypeScript 6
The latest TypeScript compiler providing static type checking, better IDE support, and catch-at-compile-time error prevention. Chosen for:
- End-to-end type safety across the full stack
- Enhanced IDE autocompletion and refactoring
- Self-documenting code through type annotations

---

## 📊 Bundle Size Impact

| Category | Packages | Approximate Impact |
|----------|----------|-------------------|
| **Core** | react, react-dom, react-router | ~40 KB (gzipped) |
| **HTTP** | axios | ~14 KB (gzipped) |
| **Icons** | lucide-react | Tree-shaken — only used icons |
| **Search** | fuse.js | ~5 KB (gzipped) |
| **Total** | All production | ~60 KB (gzipped) |

> 💡 All development dependencies are excluded from the production build by Vite, resulting in a lean final bundle.

---

> 📖 See [Backend Dependencies](Backend-Dependencies) for the server-side package breakdown.