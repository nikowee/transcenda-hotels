/**
 * Canonical booking shapes, mirroring the deployed Supabase `bookings` table.
 *
 * Split out from bookingModel so the controller, the webhook handler and the
 * tests can share one definition of the row without importing the storage
 * layer. If a column changes in the database, it changes here first.
 *
 * Naming: camelCase everywhere in TypeScript, snake_case only at the SQL
 * boundary. bookingModel's toRow/fromRow are the only places both appear.
 */

/** Row shape exactly as Postgres stores it. */
export interface BookingRow {
  id: string;
  user_id: string | null;
  destination_id: string;
  hotel_id: string;
  hotel_name: string;
  room_types: string;
  start_date: string;
  end_date: string;
  nights_count: number;
  adults_count: number;
  children_count: number;
  special_requests: string | null;
  guest_salutation: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  price_paid: number;
  payment_id: string;
  payee_id: string;
  card_brand: string;
  card_last4: string;
  card_exp_month: number;
  card_exp_year: number;
  created_at: string;
}

/**
 * Billing address, as it appears on the card statement.
 *
 * Its primary job is not display — it is what Stripe runs the AVS check
 * against, which is one of the cheaper fraud signals available. It is sent as
 * `billing_details` on the PaymentIntent for that reason, and stored so the
 * booking record matches what was authorised.
 *
 * `line2` and `state` are optional because plenty of the world has neither.
 * `country` is an ISO 3166-1 alpha-2 code, which is what Stripe expects.
 */
export interface BillingAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
}

/** Guest identity, matching the table's split-name columns. */
export interface GuestDetails {
  salutation: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialRequests?: string | null;
}

/** The stay being booked, before it is priced. */
export interface StayDetails {
  destinationId: string;
  hotelId: string;
  hotelName: string;
  /** One or more room type ids. Stored comma-joined in `room_types`. */
  roomTypes: string[];
  startDate: string;
  endDate: string;
  adults: number;
  children: number;
}

/**
 * Card metadata, read back from Stripe after the charge.
 *
 * Brand, last four and expiry are the only card fields PCI-DSS permits storing,
 * and they are obtained by expanding payment_method on the completed session —
 * never collected by us. No PAN or CVC exists anywhere in this application.
 */
export interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Everything needed to insert a booking. Only assembled after payment clears. */
export interface BookingInput {
  userId: string | null;
  guest: GuestDetails;
  billing: BillingAddress | null;
  stay: StayDetails;
  nights: number;
  pricePaid: number;
  /** Stripe PaymentIntent id. */
  paymentId: string;
  /** Stripe Customer id, or the session's customer reference when absent. */
  payeeId: string;
  card: CardDetails;
}

/**
 * The priced quote returned by GET /api/bookings/checkout.
 *
 * Lives in the shared contract rather than in the controller because the client
 * renders it field by field. When it was defined independently on both sides,
 * the server sent `nightlyRates`/`nightlyTotal` and the client read
 * `nightlyRate` — `undefined.toLocaleString()` threw during render, React
 * unmounted the tree, and the checkout page went blank with no error shown.
 *
 * Display only. No figure here is ever accepted back as an amount; the server
 * reprices from ROOM_RATES when it creates the session and again before it
 * writes the row.
 */
export interface CheckoutQuote extends StayDetails {
  nights: number;
  currency: string;
  /**
   * Human names for the rooms, index-aligned with roomTypes.
   *
   * A supplier room id is an opaque UUID, so roomTypes is unreadable on screen
   * the moment a booking comes from a real hotel rather than the demo
   * catalogue. Carried separately because roomTypes is what the room_types
   * column stores and what re-pricing keys on — the label is display only and
   * must never be the thing a rate is looked up by.
   */
  roomLabels: string[];
  /** Index-aligned with roomTypes so a multi-room stay can be itemised. */
  nightlyRates: number[];
  /** Sum of nightlyRates — the per-night cost of the whole booking. */
  nightlyTotal: number;
  subtotal: number;
  taxes: number;
  totalPrice: number;
}

/** A persisted booking, as the API returns it. */
export interface BookingRecord {
  id: string;
  userId: string | null;
  destinationId: string;
  hotelId: string;
  hotelName: string;
  roomTypes: string[];
  startDate: string;
  endDate: string;
  nights: number;
  adults: number;
  children: number;
  specialRequests: string | null;
  guest: GuestDetails;
  billing: BillingAddress | null;
  pricePaid: number;
  paymentId: string;
  payeeId: string;
  card: CardDetails;
  createdAt: string;
}
