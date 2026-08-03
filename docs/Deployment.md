# Deployment — AWS (compute) + Supabase (database)

The repo is deployment-ready as of the UC4 branch: images that build and start
themselves, a compiled server that has actually been executed, migrations as
code, graceful shutdown, and a CI pipeline. This page is the order of
operations for standing it up.

## The shape

```
Browser ── CloudFront/S3 or nginx container (client bundle)
   │
   └── ALB ──► ECS Fargate: server image ──► Supabase (auth + Postgres, via PostgREST)
                    │                   ──► Stripe (payments + webhook back in)
                    │                   ──► Ascenda hotel API (rates)
                    └──────────────────────► ElastiCache Redis (optional cache)
```

Long-lived containers, not Lambda: the server holds an 8 MB destinations
dataset and its Fuse index in memory (paid once at boot), and the Stripe
webhook needs raw request bytes — both fit a warm task and fight a cold start.

## 1. Database first: apply the migrations

One command (or the CI `migrate` job — workflow_dispatch, three repo secrets):

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <ref>   # subdomain of SUPABASE_URL
npx supabase@latest db push
```

This lands billing-address columns, the `bookings_payment_id_key` unique
constraint, RLS + indexes. Then flip the `BILLING-PENDING-MIGRATION` code
sites (grep the token) so the address persists and the 3 pending tests run.

**Why it matters for scale:** until the unique constraint exists, duplicate-
booking protection is an in-process lock — the comment in
`server/src/middleware/rateLimit.ts` names the two multi-instance gates. After
`db push`, gate 1 (money-correctness) is closed; only the shared rate-limit
store remains before desired-count > 1.

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
| **Secrets Manager** | `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, (`RESEND_API_KEY`) |
| **Plain env** | `NODE_ENV=production`, `PORT=5000`, `SUPABASE_URL`, `APP_URL` (public frontend URL — Stripe return URLs build from it), `CORS_ORIGINS` (deployed frontend origin), `TRUST_PROXY_HOPS=1` (per ALB hop — see `.env.example` for why both directions of wrong are bad), `REDIS_URL` (ElastiCache), `EMAIL_FROM` |
| **Leave unset** | `BOOKINGS_STORAGE` (memory = bookings vanish per task), `PAYMENTS_MODE` (ignored in production anyway) |

Boot refusals are deliberate: with `NODE_ENV=production` and no
`STRIPE_SECRET_KEY` the process exits rather than silently accepting every
card — a crash loop right after launch usually means a missed secret.

Networking: tasks make outbound calls to Supabase, Stripe, Ascenda and (if
set) Resend — private subnets need a NAT gateway or VPC endpoints.

## 3. Client bundle

```bash
docker build \
  --build-arg VITE_API_URL=https://api.example.com \
  --build-arg VITE_SUPABASE_URL=... \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=... \
  --build-arg VITE_STRIPE_PUBLISHABLE_KEY=pk_live_... \
  -t transcenda-client client/
```

`VITE_*` values are baked at build time — there is no runtime injection into a
static bundle, so **each environment needs its own build**. The build refuses
to produce an image when the Supabase args are empty (it greps the bundle for
`auth/v1`); without that guard the broken build is *smaller* and looks like an
optimisation. The image is nginx with an SPA fallback (deep-link refreshes on
/checkout etc. answer index.html, hashed assets cache immutable). Serving the
same `dist/` from S3+CloudFront instead is equivalent — keep the fallback
(403/404 → /index.html) and the no-cache rule for index.html.

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
| > 1 | Migration 002 applied (done in step 1) **and** a shared rate-limit store — the in-memory buckets make every limit N× at N tasks. Auth-token cache staying per-task is fine (hit-rate only) |

## 6. Smoke checklist after first deploy

- `GET /api/health` → 200 through the ALB
- A search from the deployed frontend (CORS proves `CORS_ORIGINS`; results
  prove outbound to Ascenda; a repeat proves Redis if configured)
- A full test-mode booking → confirmation page shows a booking id, exactly one
  row in `bookings`, one confirmation email (or one log line if Resend unset)
- `stripe listen`/dashboard: webhook deliveries answering 200
- Kill a task: draining, not 502s (SIGTERM handler)

## Related

- `server/src/data/migrations/README.md` — migration flow and verification SQL
- `docs/Environment-Variables.md` — every variable and the CI-only secrets
- `docs/Testing.md` — what green looks like (server 375+3 → 378 after step 1,
  client 166, E2E 22)
