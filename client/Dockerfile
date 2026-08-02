# Three stages, two consumers.
#
#   dev      → what docker-compose targets: full dependencies, source
#              bind-mounted at run time, Vite dev server as the command.
#              Behaviourally identical to the old single-stage image.
#   build    → `vite build` with the VITE_* values passed as build args.
#              These are baked into the bundle at compile time — there is no
#              such thing as injecting them into a built SPA at run time.
#   runtime  → nginx serving the static bundle. A Vite dev server must never
#              face the internet; the old image had no production story at all.
#
# The build stage runs `npx vite build`, not `npm run build`: the npm script
# also runs `tsc -b`, which is a type-check, and type-checking belongs in CI —
# an image build should assemble the artifact, not re-lint it.
#
# ⚠ Building without real VITE_SUPABASE_* values does NOT fail — it silently
# tree-shakes the entire Supabase client out (~200 kB smaller bundle) and the
# app throws on first load. The build below asserts the bundle still contains
# supabase to make that mistake loud.
#
# Exact base tag, not a floating one: react-router 8.3 requires node >=22.22.

# ── Stage: dev (docker-compose target) ───────────────────────────────────────
FROM node:22.22-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN chown -R node:node /app
USER node

COPY --chown=node:node . .

EXPOSE 3000

# ── Stage: build ─────────────────────────────────────────────────────────────
FROM dev AS build

ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY

# "auth/v1" is the GoTrue REST path literal — measured to exist only when the
# working Supabase client is in the bundle. Looser markers ("supabase",
# "GoTrueClient") survive the partial tree-shake and pass on broken builds.
RUN npx vite build && grep -rq "auth/v1" dist/assets/ \
    || (echo "BUILD REFUSED: Supabase client absent from bundle — VITE_SUPABASE_* args were empty, the app would throw on load" && exit 1)

# ── Stage: runtime (default docker build output) ─────────────────────────────
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000
