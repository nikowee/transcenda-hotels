# Migrations moved → `supabase/migrations/`

The SQL now lives in the Supabase CLI's convention (timestamp-prefixed, applied
in order, tracked remotely), so applying it is one command instead of three
dashboard pastes:

```bash
npx supabase@latest login                       # or set SUPABASE_ACCESS_TOKEN
npx supabase@latest link --project-ref <ref>    # <ref> = subdomain of SUPABASE_URL
npx supabase@latest db push                     # prompts for the DB password
```

CI can do the same: the `migrate` job in `.github/workflows/ci.yml` is
`workflow_dispatch`-only (schema changes must never auto-apply on push) and
reads `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`
from repository secrets.

The files also remain valid to paste into the dashboard SQL editor by hand —
every one is idempotent, including 002's destructive step, which is guarded on
the constraint it creates.

## What is pending, and what each unlocks

| Migration | What it unlocks |
|---|---|
| `..._billing_address.sql` | The billing address persists. Then flip the code sites tagged `BILLING-PENDING-MIGRATION` (grep the token) → suite goes 375+3 pending → 378+0 |
| `..._unique_payment_id.sql` | Cross-process duplicate protection — **the gate for running more than one server instance**. Deletes true duplicate rows (keeping the earliest, the id the guest was shown) before adding the constraint; preview with the inspect query in the file header |
| `..._hardening.sql` | RLS (the anon key in every browser bundle currently has direct PostgREST read access to `bookings`/`profiles`), the two lookup indexes, the date-order check |

## Prove it applied

```sql
-- billing columns: six rows expected
select column_name from information_schema.columns
where table_name = 'bookings' and column_name like 'billing_%';

-- unique payment: exactly one row
select conname from pg_constraint where conname = 'bookings_payment_id_key';

-- RLS: both rows true
select relname, relrowsecurity from pg_class
where relname in ('bookings', 'profiles');
```

`schema.sql` (one directory up) still describes the deployed schema; PostgREST
cannot run DDL and no `.rpc()` functions exist, which is why migrations go
through the CLI's direct Postgres connection rather than any code path in this
server.
