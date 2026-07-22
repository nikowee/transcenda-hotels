/** Shared shapes for UC4 — Book & Make Payment. Mirrors the server's BookingModel. */

export interface GuestDetails {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
}

export interface PaymentMethodInput {
  nameOnCard: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
}

/** Priced quote returned by GET /api/bookings/checkout */
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
  paymentStatus: string;
  bookingReference: string;
  createdAt: string;
}

export type GuestFieldErrors = Partial<Record<keyof GuestDetails, string>>;
