/** Shared shapes for UC4 — Book & Make Payment. */

/** Billing address, as it appears on the card statement. */
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

/** There is deliberately no card *entry* type here. */
export interface CardDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Priced quote returned by GET /api/bookings/checkout. */
export interface CheckoutQuote extends StayDetails {
  nights: number;
  currency: string;
  /** Human names for the rooms, index-aligned with roomTypes. */
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

export type GuestFieldErrors = Partial<Record<keyof GuestDetails, string>>;
