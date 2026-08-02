# Three stages, two consumers.
#
#   dev      → what docker-compose targets: full dependencies (tsx included),
#              source bind-mounted over /app at run time, dev watcher as the
#              command. Behaviourally identical to the old single-stage image.
#   build    → compiles TypeScript and copies src/data (destinations.json is
#              read at boot relative to the compiled controller).
#   runtime  → the default `docker build` output: compiled dist/, production
#              dependencies only, and a real CMD. The old image had no CMD at
#              all — started by anything but compose it exited immediately.
#
# Exact base tag, not a floating one: the toolchain expects node >=22.22, and a
# floating node:22 makes the build depend on whatever 22.x it points at today.

# ── Stage: dev (docker-compose target) ───────────────────────────────────────
FROM node:22.22-alpine AS dev

WORKDIR /app

COPY package*.json ./
# Full install: tsx and the test toolchain are devDependencies, and this stage
# also seeds the anonymous /app/node_modules volume compose declares.
RUN npm ci

RUN chown -R node:node /app
USER node

COPY --chown=node:node . .

EXPOSE 5000

# ── Stage: build ─────────────────────────────────────────────────────────────
FROM dev AS build

RUN npm run build

# ── Stage: runtime (default docker build output) ─────────────────────────────
FROM node:22.22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only the compiled output crosses the boundary — no src/, no tsx, no
# TypeScript toolchain in the shipped image.
COPY --from=build /app/dist ./dist

RUN chown -R node:node /app
USER node

EXPOSE 5000

CMD ["node", "dist/index.js"]
