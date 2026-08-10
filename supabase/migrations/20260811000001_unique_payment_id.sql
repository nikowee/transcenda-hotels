-- One booking per Stripe payment.
--
-- Three writers reach insertOne for a single charge: the browser posting
-- /confirm, the Stripe webhook recovering, and Stripe redelivering that
-- webhook. bookingModel serialises them with an in-process lock, which holds
-- for exactly one Express instance and stops holding the moment there are two.
-- This constraint is the version that does not care how many processes there
-- are, and bookingModel's 23505 handler is already written for it — until it
-- exists, that handler has nothing to catch.
--
-- ⚠️  DELETES ROWS. A unique constraint cannot be added while duplicates
--     exist, so they must go first. Step 1 shows exactly what step 2 would
--     remove; run it on its own before proceeding.
--
-- Run in: Supabase Dashboard → SQL Editor → New query

-- ── Step 1: inspect. Read-only, safe at any time. ───────────────────────────
--
--   select payment_id,
--          count(*)        as rows,
--          min(created_at) as keeping,
--          count(*) - 1    as would_delete
--   from public.bookings
--   group by payment_id
--   having count(*) > 1
--   order by min(created_at);

-- ── Step 2: dedupe and constrain, atomically. ───────────────────────────────
--
-- Wrapped in a transaction: if the ALTER fails the DELETE rolls back with it,
-- rather than stripping rows and still leaving the table unconstrained.
--
-- The survivor is the earliest row per payment_id — the id the guest was shown
-- on the confirmation page, so the one that may already exist in a bookmark, an
-- email or a support ticket. ctid breaks exact created_at ties: comparing
-- created_at alone leaves both rows of a tie in place (neither is strictly
-- earlier), and the ALTER then fails on the very databases dirty enough to
-- need this. Guarded on pg_constraint so a re-run is a no-op.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_payment_id_key'
  ) then
    delete from public.bookings dupe
    using public.bookings keep
    where dupe.payment_id = keep.payment_id
      and (keep.created_at, keep.ctid) < (dupe.created_at, dupe.ctid);

    alter table public.bookings
      add constraint bookings_payment_id_key unique (payment_id);
  end if;
end $$;

-- ── Step 3: verify. ─────────────────────────────────────────────────────────
--   select conname from pg_constraint where conname = 'bookings_payment_id_key';
--   -- expect exactly one row
