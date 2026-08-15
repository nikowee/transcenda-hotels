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

/** BookingModel — the «Database Model» box from the class diagram, written against the deployed Supabase `bookings` table. */

const TABLE = 'bookings';

/** Written over erased personal fields. A constant, not empty string, so a row that was anonymised is distinguishable from one that was never filled in. */
const REDACTED = '[deleted]';

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
  /** Safety guardrail: write no billing_* columns. */
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
  /** Tolerant read: a column that does not exist is simply absent from the select('*') response, so billing resolves to null. */
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

/** Duplicate-write lock: writes in progress, keyed by payment_id. */
const writesInFlight = new Map<string, Promise<BookingRecord>>();

/**
 * Idempotent by payment_id: the in-flight lock, then findByPaymentId, then
 * Postgres 23505. onCreated fires only for the caller that wrote the row.
 */
export const insertOne = async (
  input: BookingInput,
  onCreated?: (record: BookingRecord) => void | Promise<void>
): Promise<BookingRecord> => {
  /** Ordering guardrail: no await between the lookup and the set, so a second caller cannot slip past before the first registers its write. */
  const inFlight = writesInFlight.get(input.paymentId);
  if (inFlight) return inFlight;

  const write = performWrite(input, onCreated).finally(() => {
    writesInFlight.delete(input.paymentId);
  });

  writesInFlight.set(input.paymentId, write);
  return write;
};

/** Run onCreated without letting it affect the write. */
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

  /** Race handler: 23505 is Postgres' unique_violation. */
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

/**
 * Erases the personal data on a user's bookings, keeping the financial record.
 *
 * Deleting the rows outright is the wrong answer: a booking is an accounting
 * artefact, and the money moved. What has to go is everything identifying —
 * name, email, phone, free-text requests, the Stripe payee handle, and the
 * link back to the account. What stays is the stay, the amount, the payment id
 * and the card's brand and expiry, none of which names anybody.
 *
 * Returns how many rows were anonymised, so the caller can log it.
 */
export const anonymiseBookingsForUser = async (userId: string): Promise<number> => {
  if (!isSupabaseConfigured()) {
    let count = 0;
    for (const [id, record] of memoryStore) {
      if (record.userId !== userId) continue;
      memoryStore.set(id, {
        ...record,
        userId: null,
        payeeId: REDACTED,
        specialRequests: null,
        guest: {
          salutation: REDACTED,
          firstName: REDACTED,
          lastName: REDACTED,
          email: REDACTED,
          phone: REDACTED,
          specialRequests: null,
        },
      });
      count += 1;
    }
    return count;
  }

  const supabase = await getClient();
  const { data: rows, error } = await supabase
    .from(TABLE)
    .update({
      user_id: null,
      payee_id: REDACTED,
      special_requests: null,
      guest_salutation: REDACTED,
      guest_first_name: REDACTED,
      guest_last_name: REDACTED,
      guest_email: REDACTED,
      guest_phone: REDACTED,
    })
    .eq('user_id', userId)
    .select('id');

  if (error) throw new Error(`Booking anonymisation failed: ${error.message}`);
  return (rows ?? []).length;
};

/** Test seam: the in-process store outlives a single suite otherwise. */
export const __clearMemoryStore = (): void => {
  memoryStore.clear();
};