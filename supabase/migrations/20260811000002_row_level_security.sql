-- Close the browser's direct read path into bookings and profiles.
--
-- The publishable (anon) key is inlined into every client bundle and is
-- world-readable by design. Without RLS that key can query PostgREST directly
-- — no Express gateway, no rate limit, no ownership check — and read every
-- booking row: guest names, email addresses, phone numbers, stay dates, card
-- brand and last four. Enabling RLS with no public policy denies the anon role
-- outright, which is the intended amount of access for a client that is
-- supposed to go through the API.
--
-- Safe for this application, verified against the code: every server read and
-- write goes through supabaseAdmin (the service-role key), which bypasses RLS
-- by design, and the client uses its key only for auth — no `from('bookings')`
-- exists anywhere in client/src. Nothing the app does today stops working.
--
-- Additive and idempotent: nothing is dropped, and re-running changes nothing.
--
-- Run in: Supabase Dashboard → SQL Editor → New query

alter table public.bookings enable row level security;
alter table public.profiles enable row level security;

-- Lookup indexes for the two columns the API filters on: GET
-- /api/bookings/user/:userId reads by user_id, and reconciliation reads by
-- guest_email. Sequential scans are fine at demo size and not at real size.
create index if not exists bookings_user_id_idx     on public.bookings (user_id);
create index if not exists bookings_guest_email_idx on public.bookings (guest_email);

-- Mirrors the server-side check in buildQuote, for anything that ever writes a
-- row without going through it.
do $$
begin
  alter table public.bookings
    add constraint bookings_dates_ordered check (end_date > start_date);
exception
  when duplicate_object then null;  -- already added on a previous run
end $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--   where relname in ('bookings', 'profiles');        -- both rows: t
--
--   select indexname from pg_indexes
--   where tablename = 'bookings' and indexname like 'bookings_%_idx';
--
--   select conname from pg_constraint
--   where conname = 'bookings_dates_ordered';         -- exactly one row
