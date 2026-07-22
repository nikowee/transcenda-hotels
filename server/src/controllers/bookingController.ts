import { type Request, type Response } from 'express';
import {
  insertOne,
  findOne,
  attachSession,
  markPaid,
  generateBookingReference,
  type BookingData,
} from '../models/bookingModel.js';
import {
  createCheckoutSession,
  verifySession,
  isConfigured,
  toSafeError,
} from '../services/paymentService.js';
import { sendConfirmation } from '../services/emailService.js';

/**
 * Booking controller — the «Express Router» box from the UC4 class diagram.
 *
 *   get_checkout(req, res)         → getCheckout          GET  /api/bookings/checkout
 *   post_guest_details(req, res)   → postGuestDetails     POST /api/bookings/guest-details
 *   post_payment(req, res)         → postPayment          POST /api/bookings/payment
 *   post_confirm_booking(req, res) → postConfirmBooking   POST /api/bookings/confirm
 *
 * postPayment no longer charges a card directly. It creates a PENDING booking
 * and hands back a Stripe-hosted checkout URL, so no card data reaches this
 * process. postConfirmBooking verifies the completed session against Stripe on
 * return; the webhook does the same asynchronously, and both are idempotent.
 *
 * Prices are never read from a request body. Every amount below is derived from
 * ROOM_RATES on the server.
 */

const CURRENCY = 'SGD';
const MAX_NIGHTS = 30;
const MAX_ROOMS = 8;

interface GuestDetails {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
}

/**
 * Placeholder inventory. Unknown IDs are rejected rather than priced, so a
 * client cannot invent a room to get a cheaper rate.
 * TODO: replace with AscendaService.searchHotels once feature/search-results
 * merges — MergedHotel.price is the real source.
 */
const ROOM_RATES: Record<string, number> = {
  'standard-queen': 180,
  'deluxe-king': 240,
  'executive-suite': 420,
  'family-room': 310,
};

/** Alternative flow 1a: detect missing/invalid guest details */
const validateGuestDetails = (body: Partial<GuestDetails>): Record<string, string> => {
  const errors: Record<string, string> = {};

  const name = body.guestName?.trim();
  const email = body.guestEmail?.trim();
  const contact = body.contactNumber?.trim();

  if (!name) {
    errors.guestName = 'Full name is required.';
  } else if (name.length < 2 || name.length > 100) {
    errors.guestName = 'Please enter your full name.';
  }

  if (!email) {
    errors.guestEmail = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    errors.guestEmail = 'Please enter a valid email address.';
  }

  if (!contact) {
    errors.contactNumber = 'Contact number is required.';
  } else if (!/^\+?[\d\s-]{7,20}$/.test(contact)) {
    errors.contactNumber = 'Please enter a valid contact number.';
  }

  return errors;
};

interface StayInput {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

interface Quote extends StayInput {
  nights: number;
  currency: string;
  nightlyRate: number;
  subtotal: number;
  taxes: number;
  totalPrice: number;
}

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * Single source of truth for pricing. Both the displayed quote and the amount
 * sent to Stripe come from here, so the two can never disagree.
 */
const buildQuote = (input: unknown): { quote: Quote } | { error: string } => {
  const raw = (input ?? {}) as Record<string, unknown>;

  const hotelId = typeof raw.hotelId === 'string' ? raw.hotelId.trim() : '';
  const roomId = typeof raw.roomId === 'string' ? raw.roomId.trim() : '';
  const checkIn = raw.checkIn;
  const checkOut = raw.checkOut;
  const guests = Number(raw.guests);
  const rooms = Number(raw.rooms);

  if (!hotelId || hotelId.length > 64) return { error: 'A valid hotelId is required.' };

  const nightlyRate = ROOM_RATES[roomId];
  if (nightlyRate === undefined) return { error: 'That room type is not available.' };

  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return { error: 'checkIn and checkOut must be YYYY-MM-DD dates.' };
  }

  const nights = Math.round(
    (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000
  );
  if (nights < 1) return { error: 'Check-out must be after check-in.' };
  if (nights > MAX_NIGHTS) return { error: `Stays are limited to ${MAX_NIGHTS} nights.` };

  if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
    return { error: 'Guests must be between 1 and 20.' };
  }
  if (!Number.isInteger(rooms) || rooms < 1 || rooms > MAX_ROOMS) {
    return { error: `Rooms must be between 1 and ${MAX_ROOMS}.` };
  }

  const subtotal = nightlyRate * nights * rooms;
  const taxes = Math.round(subtotal * 0.09 * 100) / 100;
  const totalPrice = Math.round((subtotal + taxes) * 100) / 100;

  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    return { error: 'Could not price that stay.' };
  }

  return {
    quote: {
      hotelId, roomId, checkIn, checkOut, guests, rooms,
      nights, currency: CURRENCY, nightlyRate, subtotal, taxes, totalPrice,
    },
  };
};

/** Sequence steps 1-2: GET /checkout → a priced quote for display only. */
export const getCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = buildQuote({
      hotelId: req.query.hotelId,
      roomId: req.query.roomId,
      checkIn: req.query.checkIn,
      checkOut: req.query.checkOut,
      guests: req.query.guests,
      rooms: req.query.rooms,
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result.quote);
  } catch (error) {
    console.error('Checkout quote exception:', error);
    res.status(500).json({ error: 'Could not build your checkout summary.' });
  }
};

/** Sequence step 3 + alternative flow 1a-3a */
export const postGuestDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validateGuestDetails(req.body ?? {});

    if (Object.keys(errors).length > 0) {
      res.status(422).json({ valid: false, errors });
      return;
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Guest detail validation exception:', error);
    res.status(500).json({ error: 'Could not validate your details.' });
  }
};

/**
 * Sequence steps 4-5. Creates the PENDING booking, then a Stripe-hosted
 * checkout session priced from server state, and returns where to redirect.
 */
export const postPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'Payments are not available right now.' });
      return;
    }

    const { guestDetails, stay } = req.body ?? {};

    const errors = validateGuestDetails(guestDetails ?? {});
    if (Object.keys(errors).length > 0) {
      res.status(422).json({ errors });
      return;
    }

    const result = buildQuote(stay);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { quote } = result;

    const booking: BookingData = {
      guestName: guestDetails.guestName.trim(),
      guestEmail: guestDetails.guestEmail.trim(),
      contactNumber: guestDetails.contactNumber.trim(),
      roomId: quote.roomId,
      hotelId: quote.hotelId,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      totalPrice: quote.totalPrice,
      currency: quote.currency,
      paymentStatus: 'PENDING',
      bookingReference: generateBookingReference(),
    };

    // Written before payment so a successful charge can never be orphaned.
    const record = await insertOne(booking);

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const session = await createCheckoutSession({
      bookingReference: record.bookingReference,
      amount: quote.totalPrice,
      currency: quote.currency,
      guestEmail: record.guestEmail,
      description: `${quote.nights} night${quote.nights > 1 ? 's' : ''} · ${quote.roomId}`,
      successUrl: `${appUrl}/confirmation?ref=${record.bookingReference}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/checkout?cancelled=1`,
    });

    await attachSession(record.bookingReference, session.sessionId);

    res.json({
      bookingReference: record.bookingReference,
      redirectUrl: session.redirectUrl,
    });
  } catch (error) {
    const safe = toSafeError(error);
    res.status(502).json({ error: safe.message, correlationId: safe.correlationId });
  }
};

/**
 * Sequence steps 6-10. Called when the browser returns from Stripe. Payment
 * state is read from Stripe, never from the request. Idempotent: markPaid
 * returns null if the webhook already flipped this booking.
 */
export const postConfirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, bookingReference } = req.body ?? {};

    if (typeof sessionId !== 'string' || typeof bookingReference !== 'string') {
      res.status(400).json({ error: 'sessionId and bookingReference are required.' });
      return;
    }

    const payment = await verifySession(sessionId);

    if (payment.bookingReference !== bookingReference) {
      res.status(400).json({ error: 'That payment does not belong to this booking.' });
      return;
    }

    if (!payment.paid) {
      res.status(402).json({ error: 'Payment has not completed.' });
      return;
    }

    const booking = await findOne({ bookingReference });
    if (!booking) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    // Cross-check the charged amount against what we priced.
    if (payment.amountTotal !== null) {
      const expected = Math.round(booking.totalPrice * 100);
      if (payment.amountTotal !== expected) {
        console.error(
          `Amount mismatch on ${bookingReference}: charged ${payment.amountTotal}, expected ${expected}`
        );
        res.status(409).json({ error: 'Payment amount did not match the booking.' });
        return;
      }
    }

    const updated = await markPaid(bookingReference, payment.paymentIntentId ?? 'unknown');

    // Non-null only on the first transition, so the email sends exactly once.
    if (updated) {
      const receipt = await sendConfirmation(updated.guestEmail, updated);
      res.status(200).json({ booking: updated, emailDelivered: receipt.delivered });
      return;
    }

    res.status(200).json({ booking: { ...booking, paymentStatus: 'PAID' }, emailDelivered: true });
  } catch (error) {
    const safe = toSafeError(error);
    res.status(502).json({ error: safe.message, correlationId: safe.correlationId });
  }
};

/** Supports the confirmation page, and UC5 later. */
export const getBookingByReference = async (req: Request, res: Response): Promise<void> => {
  try {
    const reference = req.params.reference;

    if (typeof reference !== 'string' || !/^TRX-[A-Z0-9]{6,16}$/.test(reference)) {
      res.status(400).json({ error: 'A valid booking reference is required.' });
      return;
    }

    const record = await findOne({ bookingReference: reference });

    if (!record) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    res.json(record);
  } catch (error) {
    console.error('Booking lookup exception:', error);
    res.status(500).json({ error: 'Could not retrieve that booking.' });
  }
};
