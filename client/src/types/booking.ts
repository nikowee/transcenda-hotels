/** Shared shapes for UC4 — Book & Make Payment. Mirrors the server's BookingModel. */

export interface GuestDetails {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
}

/**
 * There is deliberately no card type here. Payment is taken on a Stripe-hosted
 * checkout page, so no card data is ever collected, typed, or transmitted by
 * this app — that is what keeps the platform out of PCI SAQ D scope.
 */

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

/** Priced quote returned by GET /api/bookings/checkout. Display only. */
export interface CheckoutQuote {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  nights: number;
  currency: string;
  nightlyRate: number;
  subtotal: number;
  taxes: number;
  totalPrice: number;
}

export interface BookingRecord extends GuestDetails {
  id: string;
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  currency: string;
  paymentStatus: PaymentStatus;
  bookingReference: string;
  stripeSessionId: string | null;
  paymentIntentId: string | null;
  createdAt: string;
}

export type GuestFieldErrors = Partial<Record<keyof GuestDetails, string>>;
