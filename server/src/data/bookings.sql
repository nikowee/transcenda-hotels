-- UC4 "Book & Make Payment" — bookings table
-- Run in the Supabase SQL editor before pointing the API at real credentials.
--
-- Columns 3-12 are the BookingModel attributes from the UC4 class diagram.
-- id / created_at are infrastructure the diagram omits but Postgres needs.

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
  payment_status    text        not null default 'PENDING'
                                check (payment_status in ('PENDING','PAID','REFUNDED','FAILED')),

  created_at        timestamptz not null default now(),

  constraint bookings_dates_ordered check (check_out > check_in)
);

create index if not exists bookings_reference_idx on public.bookings (booking_reference);
create index if not exists bookings_guest_email_idx on public.bookings (guest_email);

-- Writes go through the service role from the Express gateway, so RLS stays on
-- with no public policy attached.
alter table public.bookings enable row level security;

-- ---------------------------------------------------------------------------
-- Deferred: needed by UC5 (Manage Booking), not by UC4. Left out so this branch
-- stays scoped to what the assets specify.
--
--   alter table public.bookings add column user_id uuid references auth.users(id);
--   alter table public.bookings add column status text not null default 'ACTIVE'
--     check (status in ('ACTIVE','CANCELLED_BY_USER','CANCELLED_BY_HOTEL','COMPLETED'));
--   alter table public.bookings add column cancelled_at timestamptz;
-- ---------------------------------------------------------------------------
