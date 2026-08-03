-- 001 — billing address on bookings
--
-- Additive and idempotent: every column is nullable and guarded by IF NOT
-- EXISTS, so this is safe to run against a table that already holds rows and
-- safe to run twice. Nothing is dropped, nothing is rewritten.
--
-- Nullable although the checkout form requires all four of line1/city/postal/
-- country. A booking row is only ever written after the money is captured, so a
-- NOT NULL here would turn any gap in the Stripe metadata round trip into a
-- charge that cannot be recorded at all. Validation belongs at the form, where
-- rejecting costs a re-submit rather than an orphaned payment.
--
-- Applied by `supabase db push` (see supabase/migrations layout); still safe to
-- paste into the dashboard SQL editor by hand.

alter table public.bookings add column if not exists billing_line1       text;
alter table public.bookings add column if not exists billing_line2       text;
alter table public.bookings add column if not exists billing_city        text;
alter table public.bookings add column if not exists billing_state       text;
alter table public.bookings add column if not exists billing_postal_code text;
alter table public.bookings add column if not exists billing_country     character(2);

-- Verify:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_name = 'bookings' and column_name like 'billing_%'
--   order by column_name;
