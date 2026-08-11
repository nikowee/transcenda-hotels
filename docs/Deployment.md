# Deployment — AWS (compute) + Supabase (database)

The repo is deployment-ready as of the UC4 branch: images that build and start
themselves, a compiled server that has actually been executed, graceful
shutdown, and a CI pipeline. This page is the order of operations for standing
it up.

## The shape

```
Browser ── Vercel (client bundle)
   │
   └── ALB ──► ECS Fargate: server image ──► Supabase (auth + Postgres, via PostgREST)
                    │                   ──► Stripe (payments + webhook back in)
                    │                   ──► Ascenda hotel API (rates)
                    └──────────────────────► ElastiCache Redis (optional cache)
```

Long-lived containers, not Lambda: the server holds an 8 MB destinations
dataset and its Fuse index in memory (paid once at boot), and the Stripe
webhook needs raw request bytes — both fit a warm task and fight a cold start.

## 1. Database first: the schema prerequisites

Two migrations in `supabase/migrations/` cover the schema prerequisites — see
that directory's README for how to apply them and what each one risks:

- a **unique constraint on `bookings.payment_id`** — see the scale rule below.
  Deletes duplicate rows, so run its inspect query first
- **Row Level Security** on `bookings` and `profiles` (no public policy) — the
  publishable key baked into every browser bundle can otherwise read both
  tables directly over PostgREST, bypassing the API entirely — plus lookup
  indexes on `user_id` and `guest_email`

Also confirm `NODE_ENV=production` reaches the container: it disables the demo
room catalogue, whose hardcoded rates must never back a real charge.

**Why the constraint matters for scale:** until it exists, duplicate-booking
protection is an in-process lock — the comment in
`server/src/middleware/rateLimit.ts` names the two multi-instance gates. With
the constraint in place, gate 1 (money-correctness) is closed; only the shared
rate-limit store remains before desired-count > 1.

## 2. Server image → ECR → ECS

```bash
docker build -t transcenda-server server/     # default target = production stage
```

The image is self-contained: compiled `dist/`, production deps only,
`CMD ["node","dist/index.js"]`, SIGTERM drain (verified: close listener →
finish in-flight → release Redis → exit, 10 s backstop). Health check for the
target group: `GET /api/health` (no auth, no Origin needed).

Task definition env:

| Source | Variables |
|---|---|
| **Secrets Manager** | `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` |
| **Plain env** | `NODE_ENV=production`, `PORT=5000`, `SUPABASE_URL`, `APP_URL` (public frontend URL — Stripe return URLs build from it), `CORS_ORIGINS` (deployed frontend origin), `REDIS_URL` (ElastiCache), `EMAIL_FROM` (an address on the Resend-verified domain) |
| **Leave unset** | `BOOKINGS_STORAGE` (memory = bookings vanish per task), `PAYMENTS_MODE` (ignored in production anyway) |

Trust-proxy depth is fixed at 1 hop in `server/src/index.ts` (the single-ALB
shape); change the literal there if the topology ever differs. Confirmation
email sends through Resend when `RESEND_API_KEY` and `EMAIL_FROM` are both
set, and falls back to logging when either is blank — set them only in
production, so test bookings never mail their throwaway addresses.

Boot refusals are deliberate: with `NODE_ENV=production` and no
`STRIPE_SECRET_KEY` the process exits rather than silently accepting every
card — a crash loop right after launch usually means a missed secret.

Networking: tasks make outbound calls to Supabase, Stripe, Ascenda and (if
set) Resend — private subnets need a NAT gateway or VPC endpoints.

## 3. Client bundle → Vercel

The client deploys to Vercel, not a container. Connect the GitHub repo, set
the project root to `client/`, and put the `VITE_*` values in the Vercel
project settings (Environment Variables). They are baked into the bundle at
build time — there is no runtime injection into a static bundle, so **each
environment needs its own build**.

Vercel handles the two things the old nginx config did by hand:

- **SPA fallback** — unknown routes (deep-link refreshes on /checkout etc.)
  answer with `index.html` by default, so the router can take over.
- **Caching** — hashed assets are served immutable; `index.html` is revalidated
  so a deploy never pins users to a dead build.

The client Dockerfile is dev-only now (single stage, no nginx): it exists for
`docker-compose` local development and is not part of the production path.

## 4. Stripe webhook

Register `https://<api-domain>/api/webhooks/stripe` in the Stripe dashboard
and put the signing secret in Secrets Manager. Two constraints, both already
encoded in the repo:

- The route mounts with `express.raw` **before** `express.json()` — Stripe
  signs the raw bytes. Do not "tidy" the mount order.
- ALB passes bodies through untouched. **API Gateway's default body handling
  breaks the HMAC silently** — if it must sit in the path, configure binary
  passthrough explicitly.

## 5. Scale rules

| Desired count | Requirement |
|---|---|
| 1 | Nothing beyond the above |
| > 1 | The unique `payment_id` constraint in place (step 1) **and** a shared rate-limit store — the in-memory buckets make every limit N× at N tasks. Auth-token cache staying per-task is fine (hit-rate only) |

## 6. Smoke checklist after first deploy

- `GET /api/health` → 200 through the ALB
- A search from the deployed frontend (CORS proves `CORS_ORIGINS`; results
  prove outbound to Ascenda; a repeat proves Redis if configured)
- A full test-mode booking **with your own email as the guest address** —
  with Resend configured this sends a real confirmation, and a throwaway
  address hard-bounces against the freshly verified domain. Expect: a booking
  id on the confirmation page, exactly one row in `bookings`, one
  `Confirmation sent` line (with the Resend id) in the task logs, and the
  email in your inbox
- `stripe listen`/dashboard: webhook deliveries answering 200
- Kill a task: draining, not 502s (SIGTERM handler)

## Related

- `docs/Environment-Variables.md` — every variable the server and client read
- `docs/Testing.md` — what green looks like (server 386,
  client 178, E2E 22)
