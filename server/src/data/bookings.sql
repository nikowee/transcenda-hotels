-- UC4 "Book & Make Payment" — bookings table
-- Run in the Supabase SQL editor before pointing the API at real credentials.
--
-- Bookings are created PENDING before the customer is sent to Stripe, then
-- flipped to PAID by the webhook. The unique constraint on stripe_session_id is
-- what makes webhook redelivery safe.

create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  booking_reference text        not null unique,

  guest_name        text        not null,
  guest_email       text        not null,
  contact_number    text        not null,

  hotel_id          text        not null,
  room_id           text        not null,
  check_in          date        not null,
  check_out         date        not null,

  total_price       numeric(10,2) not null check (total_price >= 0),
  currency          text        not null default 'SGD',
  payment_status    text        not null default 'PENDING'
                                check (payment_status in ('PENDING','PAID','FAILED','REFUNDED')),

  stripe_session_id text        unique,
  payment_intent_id text        unique,

  created_at        timestamptz not null default now(),

  constraint bookings_dates_ordered check (check_out > check_in)
);

create index if not exists bookings_reference_idx on public.bookings (booking_reference);
create index if not exists bookings_guest_email_idx on public.bookings (guest_email);
create index if not exists bookings_status_idx on public.bookings (payment_status);

-- Writes go through the service role from the Express gateway, so RLS stays on
-- with no public policy attached.
alter table public.bookings enable row level security;

-- ---------------------------------------------------------------------------
-- Migration, if the earlier version of this table already exists:
--
--   alter table public.bookings add column if not exists currency text not null default 'SGD';
--   alter table public.bookings add column if not exists stripe_session_id text unique;
--   alter table public.bookings add column if not exists payment_intent_id text unique;
--   alter table public.bookings alter column payment_status set default 'PENDING';
--   alter table public.bookings drop constraint if exists bookings_payment_status_check;
--   alter table public.bookings add constraint bookings_payment_status_check
--     check (payment_status in ('PENDING','PAID','FAILED','REFUNDED'));
--
-- Deferred: needed by UC5 (Manage Booking), not by UC4.
--
--   alter table public.bookings add column user_id uuid references auth.users(id);
--   alter table public.bookings add column status text not null default 'ACTIVE'
--     check (status in ('ACTIVE','CANCELLED_BY_USER','CANCELLED_BY_HOTEL','COMPLETED'));
--   alter table public.bookings add column cancelled_at timestamptz;
-- ---------------------------------------------------------------------------
