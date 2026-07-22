import { type Request, type Response } from 'express';
import { insertOne, findOne, generateBookingReference, type BookingData } from '../models/bookingModel.js';
import { processPayment, type PaymentMethodInput } from '../services/paymentService.js';
import { sendConfirmation } from '../services/emailService.js';

/**
 * Booking controller — the «Express Router» box from the UC4 class diagram.
 *
 * Diagram method names are snake_case; these are camelCase to match the
 * existing destinationController. Mapping:
 *
 *   get_checkout(req, res)         → getCheckout          GET  /api/bookings/checkout
 *   post_guest_details(req, res)   → postGuestDetails     POST /api/bookings/guest-details
 *   post_payment(req, res)         → postPayment          POST /api/bookings/payment
 *   post_confirm_booking(req, res) → postConfirmBooking   POST /api/bookings/confirm
 *
 * The diagram never wires post_confirm_booking into the sequence. It is read
 * here as sequence steps 7-10 (persist + email), split from postPayment so a
 * successful charge is never rolled back by a failed write in the same request.
 */

const CURRENCY = 'SGD';

interface GuestDetails {
  guestName: string;
  guestEmail: string;
  contactNumber: string;
}

/** Alternative flow 1a: detect missing/invalid guest details */
const validateGuestDetails = (body: Partial<GuestDetails>): Record<string, string> => {
  const errors: Record<string, string> = {};

  const name = body.guestName?.trim();
  const email = body.guestEmail?.trim();
  const contact = body.contactNumber?.trim();

  if (!name) {
    errors.guestName = 'Full name is required.';
  } else if (name.length < 2) {
    errors.guestName = 'Please enter your full name.';
  }

  if (!email) {
    errors.guestEmail = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.guestEmail = 'Please enter a valid email address.';
  }

  if (!contact) {
    errors.contactNumber = 'Contact number is required.';
  } else if (!/^\+?[\d\s-]{7,20}$/.test(contact)) {
    errors.contactNumber = 'Please enter a valid contact number.';
  }

  return errors;
};

const countNights = (checkIn: string, checkOut: string): number => {
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
};

/**
 * Nightly rate placeholder. There is no hotel/room price source yet — the
 * results page is still a stub — so the rate is derived deterministically from
 * roomId to keep quotes stable across a session.
 * TODO: replace with the real rate lookup once UC3 lands.
 */
const nightlyRate = (roomId: string): number => {
  const seed = [...roomId].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return 180 + (seed % 12) * 15;
};

/** Sequence step 1-2: GET /checkout → render checkout with a priced quote */
export const getCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const hotelId = (req.query.hotelId as string) || 'demo-hotel';
    const roomId = (req.query.roomId as string) || 'deluxe-king';
    const checkIn = req.query.checkIn as string;
    const checkOut = req.query.checkOut as string;
    const guests = Number(req.query.guests) || 2;
    const rooms = Number(req.query.rooms) || 1;

    if (!checkIn || !checkOut) {
      res.status(400).json({ error: 'checkIn and checkOut are required.' });
      return;
    }

    const nights = countNights(checkIn, checkOut);
    const rate = nightlyRate(roomId);
    const subtotal = rate * nights * rooms;
    const taxes = Math.round(subtotal * 0.09 * 100) / 100;

    res.json({
      hotelId,
      roomId,
      checkIn,
      checkOut,
      guests,
      rooms,
      nights,
      currency: CURRENCY,
      nightlyRate: rate,
      subtotal,
      taxes,
      totalPrice: Math.round((subtotal + taxes) * 100) / 100,
    });
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
      // 2a: return the page's error message set; client resumes from step 1
      res.status(422).json({ valid: false, errors });
      return;
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Guest detail validation exception:', error);
    res.status(500).json({ error: 'Could not validate your details.' });
  }
};

/** Sequence steps 4-6 + alternative flow 6a-9a */
export const postPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, paymentMethod } = req.body ?? {};

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ success: false, errorMessage: 'A valid amount is required.' });
      return;
    }

    const method = paymentMethod as PaymentMethodInput | undefined;
    if (!method?.cardNumber || !method.expiry || !method.cvc || !method.nameOnCard) {
      res.status(422).json({
        success: false,
        errorMessage: 'Complete card details are required.',
      });
      return;
    }

    const result = await processPayment(amount, CURRENCY, method);

    if (!result.success) {
      // 6a-8a: notify the user, let them supply an alternate method
      res.status(402).json({
        success: false,
        errorMessage: result.errorMessage,
        declineCode: result.declineCode,
      });
      return;
    }

    res.json({ success: true, transactionId: result.transactionId });
  } catch (error) {
    console.error('Payment processing exception:', error);
    res.status(500).json({ success: false, errorMessage: 'Payment could not be processed.' });
  }
};

/** Sequence steps 7-10: persist the booking, then send confirmation */
export const postConfirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { guestDetails, stay, transactionId } = req.body ?? {};

    const errors = validateGuestDetails(guestDetails ?? {});
    if (Object.keys(errors).length > 0) {
      res.status(422).json({ errors });
      return;
    }

    if (!transactionId) {
      res.status(400).json({ error: 'A completed payment is required before confirming.' });
      return;
    }

    if (!stay?.checkIn || !stay?.checkOut || typeof stay?.totalPrice !== 'number') {
      res.status(400).json({ error: 'Stay details are incomplete.' });
      return;
    }

    const booking: BookingData = {
      guestName: guestDetails.guestName.trim(),
      guestEmail: guestDetails.guestEmail.trim(),
      contactNumber: guestDetails.contactNumber.trim(),
      roomId: stay.roomId ?? 'deluxe-king',
      hotelId: stay.hotelId ?? 'demo-hotel',
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      totalPrice: stay.totalPrice,
      paymentStatus: 'PAID',
      bookingReference: generateBookingReference(),
    };

    // Step 7-8: insertOne(bookingData) → confirm write success
    const record = await insertOne(booking);

    // Step 9-10: sendConfirmation(email, bookingDetails) → delivery confirmed.
    // Awaited so the response can report delivery, but a bounce never fails the
    // booking — the record is already committed.
    const receipt = await sendConfirmation(record.guestEmail, record);

    res.status(201).json({
      booking: record,
      emailDelivered: receipt.delivered,
    });
  } catch (error) {
    console.error('Booking confirmation exception:', error);
    res.status(500).json({ error: 'Your payment succeeded but the booking could not be saved. Please contact support.' });
  }
};

/** Supports the confirmation page on reload, and UC5 later */
export const getBookingByReference = async (req: Request, res: Response): Promise<void> => {
  try {
    const reference = req.params.reference;

    if (typeof reference !== 'string' || !reference.trim()) {
      res.status(400).json({ error: 'A booking reference is required.' });
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
