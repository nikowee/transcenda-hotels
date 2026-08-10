# Migrations

Two changes the deployed database needs before it takes real traffic. Both are
idempotent; apply in either order.

Paste into **Supabase Dashboard → SQL Editor → New query**, or apply the
directory with the CLI:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref <ref>   # subdomain of SUPABASE_URL
npx supabase@latest db push
```

| File | What it closes | Risk |
|---|---|---|
| `…_unique_payment_id.sql` | The duplicate-booking race. bookingModel's in-process lock holds for one instance only; this constraint is what its `23505` handler catches. **Required before running more than one server instance.** | **Deletes duplicate rows.** Run its step-1 inspect query first. |
| `…_row_level_security.sql` | The anon key in every browser bundle can otherwise read `bookings` and `profiles` directly over PostgREST. Also adds the two lookup indexes and a date-order check. | None — additive, and every server path uses the service role, which bypasses RLS. |

## Why these are files rather than code

The server reaches Postgres only through PostgREST, which exposes CRUD and no
DDL, and defines no `.rpc()` functions — so no application code path can issue
`ALTER TABLE`. Schema changes are applied by a human or by the CLI's direct
Postgres connection, and these files are their version control.

Verification queries sit at the bottom of each file.
