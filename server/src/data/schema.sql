-- Transcenda Hotels — canonical database schema.
--
-- This mirrors what is deployed in Supabase. The application is written to
-- match it; if you change a column here, change bookingModel.ts with it.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles — one row per authenticated user, keyed to Supabase auth.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid not null,
  full_name text not null,
  email text not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint profiles_pkey primary key (id),
  constraint profiles_email_key unique (email),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- bookings — one row per completed, paid reservation.
--
-- Note the shape of this table drives the payment flow: payment_id and
-- price_paid are NOT NULL and there is no status column, so a row can only be
-- written once Stripe has confirmed the charge. See the reconciliation note at
-- the bottom of this file.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.bookings (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  destination_id text not null,
  hotel_id text not null,
  hotel_name text not null,
  room_types text not null,
  start_date date not null,
  end_date date not null,
  nights_count integer not null,
  adults_count integer not null,
  children_count integer not null,
  special_requests text null,
  guest_salutation text not null,
  guest_first_name text not null,
  guest_last_name text not null,
  guest_email text not null,
  guest_phone text not null,

  -- BILLING-PENDING-MIGRATION — NOT ON THE DEPLOYED TABLE.
  --
  -- Verified absent against the live project; the six columns below are the
  -- migration in 001_billing_address.sql and nothing more. This file describes
  -- the schema as it *will* be, so they stay written out — but commented, so
  -- nobody reads this as a record of what is there today.
  --
  -- bookingModel.toRow has the matching writes commented out under the same
  -- token. Uncomment both together, after running the migration.
  --
  -- Billing address, as given to the card issuer. Collected primarily so Stripe
  -- can run an AVS check; stored so the record matches what was authorised.
  --
  -- Nullable on purpose, even though the form requires line1/city/postal/country.
  -- A booking is only ever written after the money is captured, so a NOT NULL
  -- here would turn any gap in the metadata round trip into a charge that cannot
  -- be recorded at all. Enforcing it in validation costs a rejected form;
  -- enforcing it here costs an orphaned payment.
  --
  -- billing_line1       text null,
  -- billing_line2       text null,
  -- billing_city        text null,
  -- billing_state       text null,
  -- billing_postal_code text null,
  -- billing_country     character(2) null,

  price_paid numeric(10, 2) not null,
  payment_id text not null,
  payee_id text not null,
  card_brand text not null,
  card_last4 character(4) not null,
  card_exp_month integer not null,
  card_exp_year integer not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint bookings_pkey primary key (id),
  constraint bookings_user_id_fkey foreign KEY (user_id) references profiles (id) on delete CASCADE
) TABLESPACE pg_default;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration, if the table already exists without the billing columns:
--
--   alter table public.bookings add column if not exists billing_line1 text;
--   alter table public.bookings add column if not exists billing_line2 text;
--   alter table public.bookings add column if not exists billing_city text;
--   alter table public.bookings add column if not exists billing_state text;
--   alter table public.bookings add column if not exists billing_postal_code text;
--   alter table public.bookings add column if not exists billing_country character(2);
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Recommended additions (not yet applied)
--
-- 1. payment_id must be unique. Without it, a retried confirmation or a
--    redelivered Stripe webhook inserts the same paid booking twice, and there
--    is no constraint to stop it. This is the single most valuable line to add.
--
--      alter table public.bookings
--        add constraint bookings_payment_id_key unique (payment_id);
--
-- 2. Lookup indexes for the confirmation page and "my bookings".
--
--      create index if not exists bookings_user_id_idx on public.bookings (user_id);
--      create index if not exists bookings_guest_email_idx on public.bookings (guest_email);
--
-- 3. Row Level Security. Writes go through the service role from the Express
--    gateway, so enabling RLS with no public policy is safe and closes direct
--    client access to other people's bookings.
--
--      alter table public.bookings enable row level security;
--      alter table public.profiles enable row level security;
--
-- 4. Date sanity, mirroring the server-side check in buildQuote.
--
--      alter table public.bookings
--        add constraint bookings_dates_ordered check (end_date > start_date);
-- ─────────────────────────────────────────────────────────────────────────────
