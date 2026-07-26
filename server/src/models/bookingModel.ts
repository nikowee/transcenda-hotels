import { randomUUID } from 'crypto';
import type {
  BookingInput,
  BookingRecord,
  BookingRow,
} from './bookingTypes.js';

export type {
  BookingInput,
  BookingRecord,
  BookingRow,
  CardDetails,
  GuestDetails,
  StayDetails,
} from './bookingTypes.js';

/**
 * BookingModel — the «Database Model» box from the UC4 class diagram, written
 * against the deployed schema in ../data/schema.sql.
 *
 * The table has payment_id and price_paid NOT NULL and no status column, so a
 * booking cannot be represented before it is paid for. insertOne is therefore
 * only ever called after Stripe has confirmed the charge, and there is no
 * PENDING state to transition out of.
 *
 * The cost of that is stated plainly: if this insert fails, the customer has
 * been charged and no row exists. findByPaymentId plus the webhook retry are
 * the recovery path — see webhookController. Adding a unique constraint on
 * payment_id (see schema.sql) is what would make that recovery airtight.
 */

const TABLE = 'bookings';

/**
 * In-process fallback so the flow stays demoable without credentials. Single
 * process only, and cleared on restart.
 */
const memoryStore = new Map<string, BookingRecord>();

export const isSupabaseConfigured = (): boolean => {
  if (process.env.BOOKINGS_STORAGE === 'memory') return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
};

/** Lazy: ../lib/supabaseClient throws at module scope when env vars are absent. */
const getClient = async () => {
  const { supabaseAdmin } = await import('../lib/supabaseClient.js');
  return supabaseAdmin;
};

const toRow = (input: BookingInput) => ({
  user_id: input.userId,
  destination_id: input.stay.destinationId,
  hotel_id: input.stay.hotelId,
  hotel_name: input.stay.hotelName,
  // Stored as text; joined here so the split lives in exactly one place.
  room_types: input.stay.roomTypes.join(','),
  start_date: input.stay.startDate,
  end_date: input.stay.endDate,
  nights_count: input.nights,
  adults_count: input.stay.adults,
  children_count: input.stay.children,
  special_requests: input.guest.specialRequests ?? null,
  guest_salutation: input.guest.salutation,
  guest_first_name: input.guest.firstName,
  guest_last_name: input.guest.lastName,
  guest_email: input.guest.email,
  guest_phone: input.guest.phone,
  /**
   * BILLING-PENDING-MIGRATION — grep this token to restore. See
   * ../data/migrations/001_billing_address.sql.
   *
   * The six billing_* columns are not on the deployed table yet. PostgREST
   * rejects an insert wholesale if any column in it is unknown, so leaving these
   * in does not merely fail to store the address — it fails the entire booking,
   * after the charge has already been captured. That is the worst possible place
   * to discover a schema gap, and it is what the two e2e failures are.
   *
   * Commented out rather than deleted because nothing else about the billing
   * address changes: the form still collects it, validateBillingAddress still
   * enforces it, and it still travels to Stripe in the PaymentIntent's
   * billing_details for the AVS check. Only the write to our own table is
   * suspended. Uncomment once the migration is applied.
   */
  // billing_line1: input.billing?.line1 ?? null,
  // billing_line2: input.billing?.line2 ?? null,
  // billing_city: input.billing?.city ?? null,
  // billing_state: input.billing?.state ?? null,
  // billing_postal_code: input.billing?.postalCode ?? null,
  // // character(2) — normalised on write so the stored code is always comparable.
  // billing_country: input.billing?.country ? input.billing.country.toUpperCase().slice(0, 2) : null,
  price_paid: input.pricePaid,
  payment_id: input.paymentId,
  payee_id: input.payeeId,
  card_brand: input.card.brand,
  // character(4) — Postgres blank-pads anything shorter, so normalise on write.
  card_last4: input.card.last4.slice(-4).padStart(4, '0'),
  card_exp_month: input.card.expMonth,
  card_exp_year: input.card.expYear,
});

const fromRow = (row: BookingRow): BookingRecord => ({
  id: row.id,
  userId: row.user_id,
  destinationId: row.destination_id,
  hotelId: row.hotel_id,
  hotelName: row.hotel_name,
  roomTypes: row.room_types ? row.room_types.split(',').filter(Boolean) : [],
  startDate: row.start_date,
  endDate: row.end_date,
  nights: row.nights_count,
  adults: row.adults_count,
  children: row.children_count,
  specialRequests: row.special_requests,
  guest: {
    salutation: row.guest_salutation,
    firstName: row.guest_first_name,
    lastName: row.guest_last_name,
    email: row.guest_email,
    phone: row.guest_phone,
    specialRequests: row.special_requests,
  },
  /**
   * BILLING-PENDING-MIGRATION — this read needs no change and is left alone.
   *
   * A column that does not exist is simply absent from a `select('*')` response,
   * so row.billing_line1 is undefined and this resolves to null — the same
   * answer it already gives for a booking written before the columns existed.
   * Commenting it out too would mean two places to restore and would break
   * reads the moment the migration lands.
   */
  billing: row.billing_line1
    ? {
        line1: row.billing_line1,
        line2: row.billing_line2,
        city: row.billing_city ?? '',
        state: row.billing_state,
        postalCode: row.billing_postal_code ?? '',
        country: (row.billing_country ?? '').trim(),
      }
    : null,
  pricePaid: Number(row.price_paid),
  paymentId: row.payment_id,
  payeeId: row.payee_id,
  card: {
    brand: row.card_brand,
    // character(4) comes back blank-padded when the stored value was shorter.
    last4: row.card_last4.trim(),
    expMonth: row.card_exp_month,
    expYear: row.card_exp_year,
  },
  createdAt: row.created_at,
});

/**
 * Writes in progress, keyed by payment_id.
 *
 * Three writers reach insertOne for a single charge: the browser posting
 * /confirm, the Stripe webhook recovering, and Stripe redelivering that webhook
 * when the first delivery is slow. They are concurrent requests, and they all
 * land in this one Express process.
 *
 * Without this map they interleave. `await findByPaymentId` yields, so every
 * one of them observes "no booking yet" before any of them has written, and
 * every one of them then writes. That is not theoretical: 7 of the 11 payments
 * in the development database had two or three rows each, written 9–164ms
 * apart. A read-then-write cannot fix itself — something has to serialise the
 * writers, and in a single-process deployment this is the cheapest thing that
 * can.
 *
 * Callers share the *promise*, so the second caller waits for the first write
 * and receives the row it produced rather than starting a second one.
 */
const writesInFlight = new Map<string, Promise<BookingRecord>>();

/**
 * Writes a paid booking.
 *
 * Idempotent by payment_id at three layers, because each closes a gap the one
 * below it cannot:
 *
 *   1. writesInFlight serialises concurrent writers inside this process. This
 *      is what stops the duplicates actually being produced today.
 *   2. findByPaymentId answers cheaply for a confirmation that arrives after
 *      an earlier one has already completed and left the map.
 *   3. A 23505 from Postgres catches a writer in *another* process — a second
 *      replica, or a restart mid-flight. That one needs the unique constraint
 *      in migrations/002_unique_payment_id.sql to exist; until it does, layer 3
 *      has nothing to catch and layers 1 and 2 are load-bearing.
 */
export const insertOne = async (input: BookingInput): Promise<BookingRecord> => {
  /**
   * No await between the lookup and the set, so a second caller entering here
   * cannot slip past before the first has registered its write. That ordering
   * is the entire mechanism — introducing an await above the `set` below would
   * silently restore the race this exists to close.
   */
  const inFlight = writesInFlight.get(input.paymentId);
  if (inFlight) return inFlight;

  const write = performWrite(input).finally(() => {
    writesInFlight.delete(input.paymentId);
  });

  writesInFlight.set(input.paymentId, write);
  return write;
};

const performWrite = async (input: BookingInput): Promise<BookingRecord> => {
  const existing = await findByPaymentId(input.paymentId);
  if (existing) return existing;

  if (!isSupabaseConfigured()) {
    const record: BookingRecord = {
      ...fromRow({
        ...(toRow(input) as unknown as BookingRow),
        id: randomUUID(),
        created_at: new Date().toISOString(),
      }),
    };
    memoryStore.set(record.id, record);
    return record;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .insert(toRow(input))
    .select()
    .single();

  /**
   * 23505 is Postgres' unique_violation: another request inserted this
   * payment_id between the findByPaymentId above and this insert.
   *
   * That gap is real. The browser confirms while the webhook recovers, or the
   * confirmation page mounts twice — both read no booking, both write one, and
   * the guest ends up with two rows for one charge. Losing that race is the
   * correct outcome, not an error: return whatever the winner wrote.
   *
   * This only bites once `bookings_payment_id_key` exists — see
   * ../data/migrations/002_unique_payment_id.sql. Without the constraint
   * Postgres accepts both rows and there is nothing here to catch.
   */
  if (error) {
    if (error.code === '23505') {
      const winner = await findByPaymentId(input.paymentId);
      if (winner) return winner;
    }
    throw new Error(`Booking write failed: ${error.message}`);
  }

  return fromRow(row as BookingRow);
};

/** The confirmation page looks a booking up by its UUID. */
export const findById = async (id: string): Promise<BookingRecord | null> => {
  if (!isSupabaseConfigured()) {
    return memoryStore.get(id) ?? null;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return row ? fromRow(row as BookingRow) : null;
};

/** Reconciliation handle: answers "have we already recorded this charge?" */
export const findByPaymentId = async (
  paymentId: string
): Promise<BookingRecord | null> => {
  if (!isSupabaseConfigured()) {
    for (const record of memoryStore.values()) {
      if (record.paymentId === paymentId) return record;
    }
    return null;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return row ? fromRow(row as BookingRow) : null;
};

/** Powers "my bookings" once a user is signed in. */
export const findByUserId = async (userId: string): Promise<BookingRecord[]> => {
  if (!isSupabaseConfigured()) {
    return [...memoryStore.values()].filter((record) => record.userId === userId);
  }

  const supabase = await getClient();
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return (rows as BookingRow[]).map(fromRow);
};

/** Test seam: the in-process store outlives a single suite otherwise. */
export const __clearMemoryStore = (): void => {
  memoryStore.clear();
};
