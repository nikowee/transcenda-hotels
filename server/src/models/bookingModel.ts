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
 * BookingModel — the «Database Model» box from the class diagram, written
 * against the deployed Supabase `bookings` table.
 *
 * Schema rule: payment_id and price_paid are NOT NULL with no status column,
 * so a row cannot describe an unpaid booking. insertOne only ever runs after
 * Stripe confirms the charge — there is no PENDING state to transition out of.
 *
 * Trade-off: a failed insert leaves a charged customer with no row.
 * findByPaymentId plus the webhook retry are the recovery path (see
 * webhookController); a unique constraint on payment_id would make that
 * recovery airtight.
 */

const TABLE = 'bookings';

// In-memory fallback store: keeps the whole flow demoable without Supabase
// credentials (single process only, cleared on restart).
const memoryStore = new Map<string, BookingRecord>();

export const isSupabaseConfigured = (): boolean => {
  if (process.env.BOOKINGS_STORAGE === 'memory') return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
};

/** Lazy import: supabaseClient throws at module scope when env vars are absent. */
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
   * Safety guardrail: write no billing_* columns — the deployed table does not
   * have them, and PostgREST rejects the whole insert on any unknown column,
   * failing the booking after the charge is already captured. The address
   * still reaches Stripe in the PaymentIntent's billing_details for AVS.
   */
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
   * Tolerant read: a column that does not exist is simply absent from the
   * select('*') response, so billing resolves to null — covering the deployed
   * table (no billing_* columns) and any older rows alike.
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
 * Duplicate-write lock: writes in progress, keyed by payment_id.
 *
 * Three writers reach insertOne for one charge — the browser's /confirm, the
 * Stripe webhook, and Stripe's redelivery of it. Without this map their
 * read-then-write interleaves (await findByPaymentId yields, so each observes
 * "no booking yet" before any has written) and one charge becomes two or
 * three rows. Sharing the *promise* makes the second caller wait for the
 * first write and receive its row instead of starting another.
 */
const writesInFlight = new Map<string, Promise<BookingRecord>>();

/**
 * Write a paid booking, idempotent by payment_id at three layers:
 *
 *   1. writesInFlight serialises concurrent writers inside this process —
 *      the layer doing the real work today.
 *   2. findByPaymentId answers cheaply for a confirmation arriving after an
 *      earlier one already completed and left the map.
 *   3. A 23505 from Postgres catches a writer in another process, once a
 *      unique constraint on payment_id exists in the database; until then
 *      layers 1 and 2 are load-bearing.
 *
 * onCreated fires only for the caller that actually wrote the row, keeping
 * once-per-booking work (the confirmation email) from running once per
 * caller — concurrent confirmers all receive the same record and cannot tell
 * from the return value who produced it.
 */
export const insertOne = async (
  input: BookingInput,
  onCreated?: (record: BookingRecord) => void | Promise<void>
): Promise<BookingRecord> => {
  /**
   * Ordering guardrail: no await between the lookup and the set, so a second
   * caller cannot slip past before the first registers its write. An await
   * added above the set would silently restore the duplicate race.
   */
  const inFlight = writesInFlight.get(input.paymentId);
  if (inFlight) return inFlight;

  const write = performWrite(input, onCreated).finally(() => {
    writesInFlight.delete(input.paymentId);
  });

  writesInFlight.set(input.paymentId, write);
  return write;
};

/**
 * Run onCreated without letting it affect the write — it executes inside the
 * shared promise, so a throw here would reject the booking for every waiting
 * caller after the money is captured. Swallow and log instead.
 */
const announceCreated = async (
  record: BookingRecord,
  onCreated?: (record: BookingRecord) => void | Promise<void>
): Promise<void> => {
  if (!onCreated) return;
  try {
    await onCreated(record);
  } catch (error) {
    console.warn(`Booking ${record.id} written but its onCreated hook threw:`, error);
  }
};

const performWrite = async (
  input: BookingInput,
  onCreated?: (record: BookingRecord) => void | Promise<void>
): Promise<BookingRecord> => {
  // Someone else already recorded this charge, so this caller created nothing.
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
    await announceCreated(record, onCreated);
    return record;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .insert(toRow(input))
    .select()
    .single();

  /**
   * Race handler: 23505 is Postgres' unique_violation — another request
   * inserted this payment_id between the lookup above and this insert (the
   * browser confirms while the webhook recovers). Losing that race is the
   * correct outcome, not an error: return whatever the winner wrote. Only
   * fires once a unique constraint on payment_id exists in the database.
   */
  if (error) {
    if (error.code === '23505') {
      // Lost the race in another process: that writer created the row, and
      // will run its own onCreated. This one must not.
      const winner = await findByPaymentId(input.paymentId);
      if (winner) return winner;
    }
    throw new Error(`Booking write failed: ${error.message}`);
  }

  const created = fromRow(row as BookingRow);
  await announceCreated(created, onCreated);
  return created;
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
