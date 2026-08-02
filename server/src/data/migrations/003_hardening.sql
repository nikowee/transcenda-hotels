-- 003 — defence the schema recommends but does not yet have
--
-- Three independent pieces, safe to run as one block and safe to run twice.
-- None of them changes what the application can do: every server write goes
-- through the service role, which bypasses RLS by design.
--
-- What each closes:
--
--   RLS        The anon (publishable) key ships inside every browser bundle.
--              Without RLS it can read bookings and profiles directly over
--              PostgREST — no Express gateway, no rate limit, no ownership
--              check. Enabling RLS with no public policy means the anon key
--              can do nothing at all, which is the intended amount.
--
--   Indexes    GET /api/bookings/user/:userId filters on user_id and the
--              confirmation flow looks up by guest_email. Both are sequential
--              scans today; fine at demo size, a table scan per page view at
--              real size.
--
--   Date check Mirrors the buildQuote validation server-side. The server
--              already refuses end_date <= start_date; the constraint is for
--              whatever writes rows without going through it.
--
-- Run in: Supabase Dashboard → SQL Editor → New query

alter table public.bookings enable row level security;
alter table public.profiles enable row level security;

create index if not exists bookings_user_id_idx     on public.bookings (user_id);
create index if not exists bookings_guest_email_idx on public.bookings (guest_email);

do $$
begin
  alter table public.bookings
    add constraint bookings_dates_ordered check (end_date > start_date);
exception
  when duplicate_object then null;  -- already added on a previous run
end $$;

-- Verify:
--   select relname, relrowsecurity from pg_class
--   where relname in ('bookings', 'profiles');          -- both rows: t
--
--   select indexname from pg_indexes
--   where tablename = 'bookings' and indexname like 'bookings_%_idx';
--
--   select conname from pg_constraint
--   where conname = 'bookings_dates_ordered';           -- exactly one row
