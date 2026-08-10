/**
 * Shared shapes for UC4 — Book & Make Payment.  Mirrors
 * server/src/models/bookingTypes.ts, which itself mirrors the deployed
 * Supabase schema.
 */

/**
 * Billing address, as it appears on the card statement.  Collected primarily
 * so Stripe can run an AVS check against it — one of the cheaper fraud signals
 * available — and stored so the record matches what was authorised.
 */
export interface BillingAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  country: string;
}

export type BillingFieldErrors = Partial<Record<keyof BillingAddress, string>>;

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
 * There is deliberately no card *entry* type here.  Payment is taken on a
 * Stripe-hosted checkout page, so no card data is ever collected, typed, or
 * transmitted by this app — that is what keeps the platform out of PCI SAQ D
 * scope.
 */
export interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * Priced quote returned by GET /api/bookings/checkout. Display only — the
 * server reprices the stay when the payment session is created, so nothing
 * here is ever sent back as an amount.
 */
export interface CheckoutQuote extends StayDetails {
  nights: number;
  currency: string;
  /**
   * Human names for the rooms, index-aligned with roomTypes.  A supplier room
   * id is an opaque UUID, so roomTypes is unreadable on screen the moment a
   * booking comes from a real hotel rather than the demo catalogue.
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

/**
 * A persisted booking, as the API returns it.  The row has price_paid and
 * payment_id NOT NULL and no status column, so the existence of one of these
 * is itself the proof that payment cleared.
 */
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

export type GuestFieldErrors = Partial<Record<keyof GuestDetails, string>>;
