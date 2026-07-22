import { randomBytes } from 'crypto';

/**
 * BookingModel — the «Database Model» box from the UC4 class diagram.
 *
 * The diagram draws a Mongo-flavoured surface (`insertOne` / `findOne`) but this
 * project runs Supabase/Postgres, so the two method names are kept as the public
 * API while the bodies speak SQL through supabase-js. Table DDL lives alongside
 * this file in ../data/bookings.sql
 *
 * Attributes mirror the diagram exactly. Postgres columns are snake_case, so
 * toRow/fromRow handle the boundary rather than leaking naming drift upward.
 */
export interface BookingData {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
  roomId: string;
  hotelId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  paymentStatus: string;
  bookingReference: string;
}

export interface BookingRecord extends BookingData {
  id: string;
  createdAt: string;
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
  payment_status: string;
  booking_reference: string;
  created_at: string;
};

const TABLE = 'bookings';

/**
 * Supabase is optional at boot so the checkout flow stays demoable without
 * credentials. When it is absent every write lands in this Map instead, which
 * keeps the UC4 sequence (steps 7-8) observable end to end.
 */
const memoryStore = new Map<string, BookingRecord>();

export const isSupabaseConfigured = (): boolean => {
  // Explicit opt-out, for running the flow against placeholder credentials.
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
  paymentStatus: row.payment_status,
  bookingReference: row.booking_reference,
  createdAt: row.created_at,
});

/**
 * Booking references are the customer-facing handle (TRX-9F2K7A), matching the
 * format the Manage Booking prototype already expects.
 */
export const generateBookingReference = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = randomBytes(6);
  let suffix = '';
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }
  return `TRX-${suffix}`;
};

/** Sequence diagram step 7: insertOne(bookingData) */
export const insertOne = async (data: BookingData): Promise<BookingRecord> => {
  if (!isSupabaseConfigured()) {
    const record: BookingRecord = {
      ...data,
      id: randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
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

/** findOne({ bookingReference }) — used by the confirmation page and, later, UC5 */
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
