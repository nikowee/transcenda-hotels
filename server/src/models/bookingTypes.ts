/** Canonical booking shapes, mirroring the deployed Supabase `bookings` table. */

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

/** Billing address, as it appears on the card statement. */
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

/** Card metadata, read back from Stripe after the charge. */
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

/** The priced quote returned by GET /api/bookings/checkout, kept in the shared contract so the client renders exactly the fields the server sends. */
export interface CheckoutQuote extends StayDetails {
  nights: number;
  currency: string;
  /** Human names for the rooms, index-aligned with roomTypes (a supplier room id is an opaque UUID, unreadable on screen). */
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
