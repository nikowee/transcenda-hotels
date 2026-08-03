-- 002 — one booking per Stripe payment
--
-- Three writers reach insertOne for a single charge: the browser posting
-- /confirm, the Stripe webhook recovering, and Stripe redelivering that
-- webhook. bookingModel serialises them by payment_id, but that lock is
-- per-process — it holds for exactly one Express instance. This constraint is
-- the version that does not care how many processes there are, and
-- bookingModel already catches the 23505 it raises; until it exists that
-- handler has nothing to catch. It is the gate for scaling past one instance.
--
-- ⚠ This migration DELETES rows. A unique constraint cannot be added while
-- duplicates exist, so they must go first. The DELETE keeps the EARLIEST row
-- per payment_id — the one the guest was shown on the confirmation page, so
-- its id may live in bookmarks, emails and support tickets — and removes only
-- true duplicates of it. Observed before the in-process lock: 7 of 11
-- payments carried 2-3 rows each, written 9-164 ms apart.
--
-- To preview what will be removed, run this read-only inspect first:
--
--   select payment_id, count(*) as rows,
--          min(created_at) as keeping, count(*) - 1 as would_delete
--   from public.bookings
--   group by payment_id having count(*) > 1
--   order by min(created_at);
--
-- No begin/commit here: the CLI wraps each migration file in a transaction,
-- so a failed ALTER rolls the DELETE back with it. Idempotent via the
-- pg_constraint guard — a re-run against a constrained table does nothing.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_payment_id_key'
  ) then
    delete from public.bookings dupe
    using public.bookings keep
    where dupe.payment_id = keep.payment_id
      and keep.created_at < dupe.created_at;

    alter table public.bookings
      add constraint bookings_payment_id_key unique (payment_id);
  end if;
end $$;

-- Verify:
--   select conname from pg_constraint where conname = 'bookings_payment_id_key';
--   -- expect exactly one row
