import { randomBytes } from 'crypto';

/**
 * BookingModel — the «Database Model» box from the UC4 class diagram.
 *
 * The diagram draws a Mongo-flavoured surface (`insertOne` / `findOne`) but this
 * project runs Supabase/Postgres, so those names are kept as the public API
 * while the bodies speak SQL through supabase-js. Table DDL lives alongside this
 * file in ../data/bookings.sql
 *
 * Bookings are written PENDING before the customer is sent to pay, then flipped
 * to PAID by the Stripe webhook. A charge can therefore never succeed against a
 * booking that does not exist.
 */

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface BookingData {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
  roomId: string;
  hotelId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  currency: string;
  paymentStatus: PaymentStatus;
  bookingReference: string;
}

export interface BookingRecord extends BookingData {
  id: string;
  createdAt: string;
  stripeSessionId: string | null;
  paymentIntentId: string | null;
}

type BookingRow = {
  id: string;
  guest_name: string;
  guest_email: string;
  contact_number: string;
  room_id: string;
  hotel_id: string;
  check_in: string;
  check_out: string;
  total_price: number;
  currency: string;
  payment_status: PaymentStatus;
  booking_reference: string;
  stripe_session_id: string | null;
  payment_intent_id: string | null;
  created_at: string;
};

const TABLE = 'bookings';

/**
 * Supabase is optional at boot so the flow stays demoable without credentials.
 * Not suitable for more than one process, and cleared on every restart.
 */
const memoryStore = new Map<string, BookingRecord>();

export const isSupabaseConfigured = (): boolean => {
  if (process.env.BOOKINGS_STORAGE === 'memory') return false;
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
};

/**
 * Imported lazily: ../lib/supabaseClient throws at module scope when the env
 * vars are missing, and a require-time crash would take the whole server down.
 */
const getClient = async () => {
  const { supabaseAdmin } = await import('../lib/supabaseClient.js');
  return supabaseAdmin;
};

const toRow = (data: BookingData) => ({
  guest_name: data.guestName,
  guest_email: data.guestEmail,
  contact_number: data.contactNumber,
  room_id: data.roomId,
  hotel_id: data.hotelId,
  check_in: data.checkIn,
  check_out: data.checkOut,
  total_price: data.totalPrice,
  currency: data.currency,
  payment_status: data.paymentStatus,
  booking_reference: data.bookingReference,
});

const fromRow = (row: BookingRow): BookingRecord => ({
  id: row.id,
  guestName: row.guest_name,
  guestEmail: row.guest_email,
  contactNumber: row.contact_number,
  roomId: row.room_id,
  hotelId: row.hotel_id,
  checkIn: row.check_in,
  checkOut: row.check_out,
  totalPrice: Number(row.total_price),
  currency: row.currency,
  paymentStatus: row.payment_status,
  bookingReference: row.booking_reference,
  stripeSessionId: row.stripe_session_id,
  paymentIntentId: row.payment_intent_id,
  createdAt: row.created_at,
});

/** Customer-facing handle (TRX-9F2K7A), matching what Manage Booking expects. */
export const generateBookingReference = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = randomBytes(10);
  let suffix = '';
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }
  return `TRX-${suffix}`;
};

/** Sequence step 7: insertOne(bookingData) — always PENDING at this point. */
export const insertOne = async (data: BookingData): Promise<BookingRecord> => {
  if (!isSupabaseConfigured()) {
    const record: BookingRecord = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      stripeSessionId: null,
      paymentIntentId: null,
    };
    memoryStore.set(record.bookingReference, record);
    return record;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .insert(toRow(data))
    .select()
    .single();

  if (error) throw new Error(`Booking write failed: ${error.message}`);
  return fromRow(row as BookingRow);
};

export const findOne = async (
  query: { bookingReference: string }
): Promise<BookingRecord | null> => {
  if (!isSupabaseConfigured()) {
    return memoryStore.get(query.bookingReference) ?? null;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('booking_reference', query.bookingReference)
    .maybeSingle();

  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return row ? fromRow(row as BookingRow) : null;
};

/** Records the Stripe session against the pending booking, before redirecting. */
export const attachSession = async (
  bookingReference: string,
  stripeSessionId: string
): Promise<void> => {
  if (!isSupabaseConfigured()) {
    const record = memoryStore.get(bookingReference);
    if (record) memoryStore.set(bookingReference, { ...record, stripeSessionId });
    return;
  }

  const supabase = await getClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ stripe_session_id: stripeSessionId })
    .eq('booking_reference', bookingReference);

  if (error) throw new Error(`Session attach failed: ${error.message}`);
};

/**
 * Idempotent PENDING → PAID transition. Returns the record only on the first
 * successful flip, so callers can send the confirmation email exactly once even
 * if Stripe redelivers the webhook.
 */
export const markPaid = async (
  bookingReference: string,
  paymentIntentId: string
): Promise<BookingRecord | null> => {
  if (!isSupabaseConfigured()) {
    const record = memoryStore.get(bookingReference);
    if (!record || record.paymentStatus === 'PAID') return null;
    const updated: BookingRecord = { ...record, paymentStatus: 'PAID', paymentIntentId };
    memoryStore.set(bookingReference, updated);
    return updated;
  }

  const supabase = await getClient();
  const { data: row, error } = await supabase
    .from(TABLE)
    .update({ payment_status: 'PAID', payment_intent_id: paymentIntentId })
    .eq('booking_reference', bookingReference)
    .eq('payment_status', 'PENDING') // guard makes redelivery a no-op
    .select()
    .maybeSingle();

  if (error) throw new Error(`Payment status update failed: ${error.message}`);
  return row ? fromRow(row as BookingRow) : null;
};

export const markFailed = async (bookingReference: string): Promise<void> => {
  if (!isSupabaseConfigured()) {
    const record = memoryStore.get(bookingReference);
    if (record && record.paymentStatus === 'PENDING') {
      memoryStore.set(bookingReference, { ...record, paymentStatus: 'FAILED' });
    }
    return;
  }

  const supabase = await getClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ payment_status: 'FAILED' })
    .eq('booking_reference', bookingReference)
    .eq('payment_status', 'PENDING');

  if (error) throw new Error(`Payment status update failed: ${error.message}`);
};
