# Migrations — what to run, in what order, and what happens after

There is no migration runner and PostgREST cannot issue DDL, so these are
applied by a human: **Supabase Dashboard → SQL Editor → New query**, paste,
run. `schema.sql` (one directory up) describes the schema as deployed; these
files are the pending changes to it.

Status is verifiable without the dashboard — the server's own probe answers
42703 for a missing column, and the queries at the bottom of each file confirm
success.

## Order and effect

| # | File | Risk | What it unblocks |
|---|------|------|------------------|
| 1 | `001_billing_address.sql` | None — additive, idempotent, all columns nullable | The billing address actually persists. Then flip the code sites tagged `BILLING-PENDING-MIGRATION` (grep the token: `bookingModel.toRow` writes, `schema.sql` columns, three `it.skip` tests) → suite goes 372+3 pending → **375+0** |
| 2 | `002_unique_payment_id.sql` | **Deletes rows** — run its step 1 (inspect) alone first, then step 2 inside the provided transaction | Cross-process duplicate protection. `bookingModel`'s 23505 handler is already written and inert until this constraint exists. **This is the gate for running more than one server instance.** |
| 3 | `003_hardening.sql` | None — idempotent | RLS (the browser's anon key currently has direct PostgREST read access to `bookings`/`profiles`), the two lookup indexes, the date-order check |

## Why each is manual

- The app talks to Postgres only through PostgREST, which exposes CRUD and
  deliberately no DDL; no `.rpc()` functions exist either.
- 002 destroys data by design (existing duplicates must go before a unique
  constraint can exist) — exactly the migration that should never run
  unattended. Its dangerous half ships fully commented-out so pasting the
  whole file does nothing.

## After applying, prove it

```sql
-- 001: six rows expected
select column_name from information_schema.columns
where table_name = 'bookings' and column_name like 'billing_%';

-- 002: exactly one row
select conname from pg_constraint where conname = 'bookings_payment_id_key';

-- 003: see the Verify block at the bottom of the file
```
