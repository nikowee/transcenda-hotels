import { randomUUID } from 'crypto';
import { type Request, type Response } from 'express';
import { insertOne, findById, findByPaymentId, findByUserId } from '../models/bookingModel.js';
import { sendConfirmation } from '../services/emailService.js';
import type {
  BillingAddress,
  CheckoutQuote,
  BookingRecord,
  CardDetails,
  GuestDetails,
  StayDetails,
} from '../models/bookingTypes.js';
import {
  createCheckoutSession,
  createPaymentIntent,
  verifySession,
  verifyPaymentIntent,
  isConfigured,
  isSimulated,
  toMinorUnits,
  toSafeError,
  type VerifiedPayment,
} from '../services/paymentService.js';

/**
 * Booking controller — the «Express Router» box from the UC4 class diagram.
 *
 *   get_checkout(req, res)         → getCheckout          GET  /api/bookings/checkout
 *   post_guest_details(req, res)   → postGuestDetails     POST /api/bookings/guest-details
 *   post_payment(req, res)         → postPayment          POST /api/bookings/payment
 *   post_confirm_booking(req, res) → postConfirmBooking   POST /api/bookings/confirm
 *   get_booking(req, res)          → getBookingById       GET  /api/bookings/:id
 *   get_user_bookings(req, res)    → getBookingsByUser    GET  /api/bookings/user/:userId
 *
 * The flow runs the opposite way round from the first cut of this file. bookings
 * has payment_id and price_paid NOT NULL and no status column, so there is no
 * such thing as a PENDING booking to write up front: postPayment only mints a
 * Stripe session, and postConfirmBooking writes the row once Stripe says the
 * charge cleared. What the customer typed has to survive that redirect, so it
 * travels in the session metadata rather than in a database row.
 *
 * Prices are never read from a request body. Every amount below is derived from
 * ROOM_RATES on the server, both when quoting and when charging.
 */

/**
 * Exported so tests can assert against the limits rather than restating them.
 * A test that hardcodes 31 silently stops testing the boundary the day someone
 * changes MAX_NIGHTS.
 */
export const CURRENCY = 'SGD';
export const MAX_NIGHTS = 30;
export const MAX_ROOMS = 8;
export const MAX_GUESTS = 20;

/** Fits inside one Stripe metadata value, which is the real constraint. */
const MAX_SPECIAL_REQUESTS = 500;

const TAX_RATE = 0.09;

/**
 * Version-agnostic on purpose. Pinning the variant nibbles to v4 would reject
 * any id Postgres starts issuing from a different generator, and a lookup id is
 * not the place to enforce a UUID version — the storage layer either finds the
 * row or it does not.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Free-text salutations end up printed on correspondence and stored forever, so
 * the column takes an allowlisted value or nothing.
 */
const SALUTATIONS = new Set(['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof']);

/**
 * Storage faults carry configuration detail (connection strings, key prefixes)
 * that must not reach a response body, so the cause is logged against a
 * correlation id and only the id travels out — the same contract toSafeError
 * uses for Stripe, but without the payment-flavoured wording.
 */
const logStorageFailure = (operation: string, error: unknown): string => {
  const correlationId = `db_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  console.error(`[storage ${correlationId}] ${operation} failed:`, error);
  return correlationId;
};

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

/**
 * The quote shape is defined once, in the shared contract. It used to be
 * declared here as well, and the two drifted: the server sent nightlyRates and
 * the client read nightlyRate, which threw during render and blanked the
 * checkout page with no error shown. Aliased rather than redeclared so that
 * cannot recur.
 */
export type Quote = CheckoutQuote;

const asTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Alternative flow 1a: detect missing/invalid guest details.
 *
 * Returns a field → message map rather than a single string so the client can
 * mark up the offending inputs instead of showing one banner for six fields.
 *
 * Exported for direct testing. Reaching it only through HTTP means every case
 * costs a request and a route, which is why the boundary cases went uncovered.
 */
export const validateGuestDetails = (
  body: Partial<GuestDetails>
): Record<string, string> => {
  const errors: Record<string, string> = {};

  const salutation = asTrimmed(body.salutation);
  const firstName = asTrimmed(body.firstName);
  const lastName = asTrimmed(body.lastName);
  const email = asTrimmed(body.email);
  const phone = asTrimmed(body.phone);
  const specialRequests = asTrimmed(body.specialRequests);

  if (!salutation) {
    errors.salutation = 'Salutation is required.';
  } else if (!SALUTATIONS.has(salutation)) {
    errors.salutation = `Salutation must be one of ${[...SALUTATIONS].join(', ')}.`;
  }

  if (!firstName) {
    errors.firstName = 'First name is required.';
  } else if (firstName.length > 100) {
    errors.firstName = 'Please enter a shorter first name.';
  }

  if (!lastName) {
    errors.lastName = 'Last name is required.';
  } else if (lastName.length > 100) {
    errors.lastName = 'Please enter a shorter last name.';
  }

  if (!email) {
    errors.email = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!phone) {
    errors.phone = 'Contact number is required.';
  } else if (!/^\+?[\d\s-]{7,20}$/.test(phone)) {
    errors.phone = 'Please enter a valid contact number.';
  }

  // Optional, but not unbounded: it has to fit one Stripe metadata value on the
  // way out and one text column on the way in.
  if (specialRequests.length > MAX_SPECIAL_REQUESTS) {
    errors.specialRequests = `Special requests are limited to ${MAX_SPECIAL_REQUESTS} characters.`;
  }

  return errors;
};

/** ISO 3166-1 alpha-2, which is the shape Stripe expects for an AVS check. */
const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Validates the billing address.
 *
 * Required at the form because Stripe runs AVS against it and a missing address
 * weakens that check, but the columns themselves are nullable — see schema.sql.
 * Rejecting here costs a re-submitted form; rejecting at insert time would cost
 * a captured charge with nowhere to record it.
 */
export const validateBillingAddress = (
  body: Partial<BillingAddress> | undefined
): Record<string, string> => {
  const errors: Record<string, string> = {};
  const value = body ?? {};

  const line1 = asTrimmed(value.line1);
  const city = asTrimmed(value.city);
  const postalCode = asTrimmed(value.postalCode);
  const country = asTrimmed(value.country);

  if (!line1) {
    errors.line1 = 'Address line 1 is required.';
  } else if (line1.length > 200) {
    errors.line1 = 'Please enter a shorter address.';
  }

  if (asTrimmed(value.line2).length > 200) {
    errors.line2 = 'Please enter a shorter address.';
  }

  if (!city) {
    errors.city = 'City is required.';
  } else if (city.length > 100) {
    errors.city = 'Please enter a shorter city.';
  }

  if (asTrimmed(value.state).length > 100) {
    errors.state = 'Please enter a shorter state or region.';
  }

  if (!postalCode) {
    errors.postalCode = 'Postal code is required.';
  } else if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(postalCode)) {
    // Deliberately loose: postal formats vary far too much per country to
    // validate strictly, and a false rejection here blocks a sale.
    errors.postalCode = 'Please enter a valid postal code.';
  }

  if (!country) {
    errors.country = 'Country is required.';
  } else if (!COUNTRY_PATTERN.test(country)) {
    errors.country = 'Country must be a two-letter code, such as SG.';
  }

  return errors;
};

const normaliseBilling = (body: Partial<BillingAddress>): BillingAddress => ({
  line1: asTrimmed(body.line1),
  line2: asTrimmed(body.line2) || null,
  city: asTrimmed(body.city),
  state: asTrimmed(body.state) || null,
  postalCode: asTrimmed(body.postalCode).toUpperCase(),
  country: asTrimmed(body.country).toUpperCase(),
});

/** Post-validation normalisation, so trimming happens in exactly one place. */
const normaliseGuest = (body: Partial<GuestDetails>): GuestDetails => {
  const specialRequests = asTrimmed(body.specialRequests);
  return {
    salutation: asTrimmed(body.salutation),
    firstName: asTrimmed(body.firstName),
    lastName: asTrimmed(body.lastName),
    email: asTrimmed(body.email),
    phone: asTrimmed(body.phone),
    specialRequests: specialRequests || null,
  };
};


const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * A query string gives `roomTypes` as an array for repeated keys and as a
 * single comma-joined string otherwise; JSON bodies give an array. Both spellings
 * arrive here rather than at three call sites.
 */
const toRoomTypeList = (value: unknown): string[] | null => {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;

  if (!parts) return null;

  const ids: string[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') return null;
    const id = part.trim();
    if (id) ids.push(id);
  }
  return ids;
};

/**
 * Single source of truth for pricing. The displayed quote, the amount sent to
 * Stripe and the amount cross-checked on confirmation all come from here, so no
 * two of them can disagree and nothing priced is ever taken from a request body.
 *
 * Exported for direct testing: this is the whole price-integrity guarantee, and
 * exercising it only through HTTP left most of its outcomes unreached.
 */
export const buildQuote = (input: unknown): { quote: Quote } | { error: string } => {
  const raw = (input ?? {}) as Record<string, unknown>;

  const destinationId = asTrimmed(raw.destinationId);
  const hotelId = asTrimmed(raw.hotelId);
  const hotelName = asTrimmed(raw.hotelName);
  const startDate = raw.startDate;
  const endDate = raw.endDate;
  const adults = Number(raw.adults);
  const children = raw.children === undefined || raw.children === null ? 0 : Number(raw.children);

  if (!destinationId || destinationId.length > 64) {
    return { error: 'A valid destinationId is required.' };
  }
  if (!hotelId || hotelId.length > 64) return { error: 'A valid hotelId is required.' };
  if (!hotelName || hotelName.length > 200) {
    return { error: 'A valid hotelName is required.' };
  }

  const roomTypes = toRoomTypeList(raw.roomTypes);
  if (!roomTypes || roomTypes.length < 1 || roomTypes.length > MAX_ROOMS) {
    return { error: `Select between 1 and ${MAX_ROOMS} rooms.` };
  }

  const nightlyRates: number[] = [];
  for (const roomType of roomTypes) {
    // Object.hasOwn, not a plain lookup: ROOM_RATES['constructor'] resolves to a
    // function off Object.prototype rather than undefined, so `=== undefined`
    // waves prototype keys straight past this guard. They are then multiplied into
    // a NaN subtotal and only stopped by the isFinite check at the bottom — safe,
    // but by accident, and with the wrong error.
    const rate = Object.hasOwn(ROOM_RATES, roomType) ? ROOM_RATES[roomType] : undefined;
    if (rate === undefined) return { error: 'That room type is not available.' };
    nightlyRates.push(rate);
  }

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return { error: 'startDate and endDate must be YYYY-MM-DD dates.' };
  }

  const nights = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000);
  if (!Number.isFinite(nights) || nights < 1) {
    return { error: 'endDate must be after startDate.' };
  }
  if (nights > MAX_NIGHTS) return { error: `Stays are limited to ${MAX_NIGHTS} nights.` };

  // Number.isInteger rejects NaN and Infinity, so a non-numeric body reaches the
  // same message as an out-of-range one rather than pricing to NaN.
  if (!Number.isInteger(adults) || adults < 1) {
    return { error: 'At least one adult is required.' };
  }
  if (!Number.isInteger(children) || children < 0) {
    return { error: 'Children must be zero or more.' };
  }
  if (adults + children > MAX_GUESTS) {
    return { error: `A booking is limited to ${MAX_GUESTS} guests.` };
  }

  const nightlyTotal = nightlyRates.reduce((sum, rate) => sum + rate, 0);
  const subtotal = Math.round(nightlyTotal * nights * 100) / 100;
  const taxes = Math.round(subtotal * TAX_RATE * 100) / 100;
  const totalPrice = Math.round((subtotal + taxes) * 100) / 100;

  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    return { error: 'Could not price that stay.' };
  }

  return {
    quote: {
      destinationId, hotelId, hotelName, roomTypes, startDate, endDate, adults, children,
      nights, currency: CURRENCY, nightlyRates, nightlyTotal, subtotal, taxes, totalPrice,
    },
  };
};

/**
 * Stripe metadata is the only state that survives the hop out to the hosted
 * page and back, and the limits are hard: 50 keys, 500 characters per value.
 * The stay and the guest are therefore JSON-stringified compactly into one key
 * each, and specialRequests gets a key of its own because it is the single
 * field that can fill a value on its own.
 */
const STRIPE_METADATA_VALUE_LIMIT = 500;

interface CarriedBooking {
  guest: GuestDetails;
  billing: BillingAddress | null;
  stay: StayDetails;
  userId: string | null;
}

const toSessionMetadata = (carried: CarriedBooking): Record<string, string> => {
  const { specialRequests, ...identity } = carried.guest;

  return {
    guest: JSON.stringify(identity),
    stay: JSON.stringify(carried.stay),
    // Its own key rather than nested in guest: each Stripe metadata value is
    // capped at 500 characters, and an address plus an identity can exceed that.
    ...(carried.billing ? { billing: JSON.stringify(carried.billing) } : {}),
    ...(specialRequests ? { specialRequests } : {}),
    ...(carried.userId ? { userId: carried.userId } : {}),
  };
};

/** Reverses toSessionMetadata. Returns null for anything it did not write. */
const fromSessionMetadata = (metadata: Record<string, string>): CarriedBooking | null => {
  try {
    const guest = JSON.parse(metadata.guest ?? '') as Partial<GuestDetails>;
    const stay = JSON.parse(metadata.stay ?? '') as StayDetails;

    if (!guest || typeof guest !== 'object' || !stay || typeof stay !== 'object') {
      return null;
    }

    // Absent metadata means an older attempt, not a malformed one — recovering
    // a booking without a billing address beats refusing to record the charge.
    const billing = metadata.billing
      ? (JSON.parse(metadata.billing) as Partial<BillingAddress>)
      : null;

    return {
      guest: { ...normaliseGuest(guest), specialRequests: metadata.specialRequests ?? null },
      billing:
        billing && typeof billing === 'object' ? normaliseBilling(billing) : null,
      stay,
      userId: metadata.userId ?? null,
    };
  } catch {
    return null;
  }
};

/**
 * The card columns are NOT NULL. A wallet or bank-transfer payment method has no
 * card to report, and refusing the insert there would leave a captured charge
 * with no booking at all — strictly worse than a row that says "unknown".
 */
const UNKNOWN_CARD: CardDetails = {
  brand: 'unknown',
  last4: '0000',
  expMonth: 0,
  expYear: 0,
};

/**
 * Failures are returned rather than thrown so the webhook can decide whether to
 * make Stripe retry. `status` doubles as that signal: 5xx is worth redelivering,
 * 4xx never will be.
 */
export type RecordOutcome =
  | { ok: true; booking: BookingRecord }
  | { ok: false; status: number; error: string; correlationId?: string };

/**
 * Turns a cleared Stripe payment into a booking row.
 *
 * Shared by the browser's return trip and the webhook so the two cannot drift:
 * whichever arrives first writes the row, and insertOne's payment_id check makes
 * the loser a no-op.
 */
export const recordPaidBooking = async (
  payment: VerifiedPayment
): Promise<RecordOutcome> => {
  if (!payment.paid) {
    return { ok: false, status: 402, error: 'Payment has not completed.' };
  }

  if (!payment.paymentIntentId) {
    console.error('Paid session carries no payment intent; cannot key the booking.');
    return { ok: false, status: 502, error: 'Payment could not be reconciled.' };
  }

  const existing = await findByPaymentId(payment.paymentIntentId);
  if (existing) return { ok: true, booking: existing };

  const carried = fromSessionMetadata(payment.metadata);
  if (!carried) {
    console.error(
      `Paid session ${payment.paymentIntentId} has no usable booking metadata; ` +
        'the charge cannot be turned into a booking without manual intervention.'
    );
    return { ok: false, status: 422, error: 'That payment is missing its booking details.' };
  }

  // Re-priced from the stay rather than trusting any total that travelled with
  // the browser, then compared against what Stripe actually captured.
  const result = buildQuote(carried.stay);
  if ('error' in result) {
    console.error(
      `Paid session ${payment.paymentIntentId} carries an unpriceable stay: ${result.error}`
    );
    return { ok: false, status: 409, error: 'That payment does not match a bookable stay.' };
  }
  const { quote } = result;

  if (payment.amountTotal !== null) {
    const expected = toMinorUnits(quote.totalPrice, quote.currency);
    if (payment.amountTotal !== expected) {
      console.error(
        `Amount mismatch on ${payment.paymentIntentId}: charged ${payment.amountTotal}, expected ${expected}`
      );
      return { ok: false, status: 409, error: 'Payment amount did not match the booking.' };
    }
  }

  if (payment.currency && payment.currency.toUpperCase() !== quote.currency.toUpperCase()) {
    console.error(
      `Currency mismatch on ${payment.paymentIntentId}: charged ${payment.currency}, expected ${quote.currency}`
    );
    return { ok: false, status: 409, error: 'Payment currency did not match the booking.' };
  }

  try {
    const booking = await insertOne({
      userId: carried.userId,
      guest: carried.guest,
      billing: carried.billing,
      stay: {
        destinationId: quote.destinationId,
        hotelId: quote.hotelId,
        hotelName: quote.hotelName,
        roomTypes: quote.roomTypes,
        startDate: quote.startDate,
        endDate: quote.endDate,
        adults: quote.adults,
        children: quote.children,
      },
      nights: quote.nights,
      pricePaid: quote.totalPrice,
      paymentId: payment.paymentIntentId,
      // payee_id is NOT NULL and a guest checkout produces no Stripe Customer,
      // so the payer's email is the identifier of last resort.
      payeeId: payment.payeeId ?? carried.guest.email,
      card: payment.card ?? UNKNOWN_CARD,
    });

    /**
     * Sequence steps 9-10. Safe to fire here and nowhere else: the
     * findByPaymentId short-circuit above means a redelivered webhook or a
     * retried /confirm never reaches this line, so the guest is emailed exactly
     * once per booking even though both paths call into here.
     *
     * Awaited but never allowed to throw — the money is captured and the row is
     * written, and a bounced email must not turn a successful booking into a
     * failed request.
     */
    try {
      const receipt = await sendConfirmation(booking.guest.email, booking);
      if (!receipt.delivered) {
        console.warn(
          `Booking ${booking.id} saved but confirmation email failed: ${receipt.errorMessage}`
        );
      }
    } catch (error) {
      console.warn(`Booking ${booking.id} saved but confirmation email threw:`, error);
    }

    return { ok: true, booking };
  } catch (error) {
    // The money is already captured at this point, so this is not a payment
    // failure and must not be reported as one. The webhook retry is the recovery
    // path; the correlation id is what ties a support ticket to this log line.
    const correlationId = logStorageFailure(
      `insertOne after charge ${payment.paymentIntentId}`,
      error
    );
    return {
      ok: false,
      status: 503,
      error: 'Your payment went through but we could not save the booking. Support has been alerted.',
      correlationId,
    };
  }
};

/** Sequence steps 1-2: GET /checkout → a priced quote for display only. */
export const getCheckout = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = buildQuote({
      destinationId: req.query.destinationId,
      hotelId: req.query.hotelId,
      hotelName: req.query.hotelName,
      roomTypes: req.query.roomTypes,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      adults: req.query.adults,
      children: req.query.children,
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
    const { billingAddress, ...guest } = req.body ?? {};

    const errors = validateGuestDetails(guest);
    /**
     * Billing is checked here as well as at /payment-intent, even though only
     * the latter can block a charge. The customer fills both on the same step,
     * so surfacing an address error one page later — after they have committed
     * to paying — would send them backwards for a typo.
     *
     * Only when an address is supplied: the guest step is also used on its own.
     */
    const billingErrors = billingAddress
      ? validateBillingAddress(billingAddress as Partial<BillingAddress>)
      : {};

    if (Object.keys(errors).length > 0 || Object.keys(billingErrors).length > 0) {
      res.status(422).json({
        valid: false,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
        ...(Object.keys(billingErrors).length > 0 ? { billingErrors } : {}),
      });
      return;
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Guest detail validation exception:', error);
    res.status(500).json({ error: 'Could not validate your details.' });
  }
};

/**
 * Sequence steps 4-5. Prices the stay server-side and opens a Stripe-hosted
 * checkout session.
 *
 * Writes nothing. The table cannot hold an unpaid booking, so the guest and the
 * stay ride out in the session metadata and come back in postConfirmBooking.
 */
/**
 * Validates the card metadata the demo form reports.
 *
 * Deliberately narrow: brand, four digits, and a plausible expiry. Anything
 * else returns null and the caller falls back to the simulator's own card, so a
 * malformed demo payload can never write junk into columns that are NOT NULL.
 *
 * There is no PAN field here and there must never be one — the demo form
 * computes last4 in the browser precisely so the number itself never travels.
 */
const readDemoCard = (value: unknown): CardDetails | null => {
  if (!value || typeof value !== 'object') return null;

  const { brand, last4, expMonth, expYear } = value as Record<string, unknown>;

  const cleanBrand = typeof brand === 'string' ? brand.trim().slice(0, 20) : '';
  const cleanLast4 = typeof last4 === 'string' ? last4.trim() : '';
  const month = Number(expMonth);
  const year = Number(expYear);

  if (!cleanBrand) return null;
  if (!/^\d{4}$/.test(cleanLast4)) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;

  return { brand: cleanBrand, last4: cleanLast4, expMonth: month, expYear: year };
};

interface PreparedPayment {
  quote: Quote;
  guest: GuestDetails;
  billing: BillingAddress;
  metadata: Record<string, string>;
  description: string;
}

type PrepareOutcome =
  | { ok: true; prepared: PreparedPayment }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Everything both payment flows must do before money is involved: validate the
 * guest, reprice the stay from ROOM_RATES, and pack what has to survive the trip
 * to Stripe.
 *
 * Shared rather than duplicated because a divergence here is a divergence in
 * what gets charged versus what gets stored — the two endpoints must build the
 * same amount from the same input every time.
 */
const preparePayment = (body: unknown): PrepareOutcome => {
  const { guestDetails, stay, userId } = (body ?? {}) as Record<string, unknown>;

  const { billingAddress } = (body ?? {}) as Record<string, unknown>;

  const errors = validateGuestDetails((guestDetails ?? {}) as Partial<GuestDetails>);
  const billingErrors = validateBillingAddress(
    (billingAddress ?? {}) as Partial<BillingAddress>
  );

  if (Object.keys(errors).length > 0 || Object.keys(billingErrors).length > 0) {
    // Namespaced so the client can mark up the two forms independently rather
    // than guessing which section a bare `city` key belongs to.
    return {
      ok: false,
      status: 422,
      body: {
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
        ...(Object.keys(billingErrors).length > 0 ? { billingErrors } : {}),
      },
    };
  }

  const result = buildQuote(stay);
  if ('error' in result) {
    return { ok: false, status: 400, body: { error: result.error } };
  }
  const { quote } = result;

  // user_id is a foreign key to profiles, so a malformed one fails at insert
  // time — long after the card has been charged. Reject it while it is free.
  if (userId !== undefined && userId !== null && !UUID_PATTERN.test(String(userId))) {
    return { ok: false, status: 400, body: { error: 'userId must be a UUID.' } };
  }

  const guest = normaliseGuest(guestDetails as Partial<GuestDetails>);
  const billing = normaliseBilling(billingAddress as Partial<BillingAddress>);
  const metadata = toSessionMetadata({
    guest,
    billing,
    stay: {
      destinationId: quote.destinationId,
      hotelId: quote.hotelId,
      hotelName: quote.hotelName,
      roomTypes: quote.roomTypes,
      startDate: quote.startDate,
      endDate: quote.endDate,
      adults: quote.adults,
      children: quote.children,
    },
    userId: userId ? String(userId) : null,
  });

  // Stripe rejects the whole request if any value is over the limit, which would
  // surface as an opaque 502 at the last step of the funnel. Catching it here
  // names the field instead.
  const oversized = Object.entries(metadata).find(
    ([, value]) => value.length > STRIPE_METADATA_VALUE_LIMIT
  );
  if (oversized) {
    return {
      ok: false,
      status: 400,
      body: { error: `That booking is too long to carry through checkout (${oversized[0]}).` },
    };
  }

  const nightLabel = `${quote.nights} night${quote.nights > 1 ? 's' : ''}`;

  return {
    ok: true,
    prepared: {
      quote,
      guest,
      billing,
      metadata,
      description: `${quote.hotelName} · ${nightLabel} · ${quote.roomTypes.join(', ')}`,
    },
  };
};

/**
 * Mints a PaymentIntent for the embedded Elements page and returns its client
 * secret.
 *
 * The secret authorises exactly one payment and nothing else, which is why it
 * is safe in the browser — Stripe.js uses it to confirm the card directly, so
 * the PAN goes browser→Stripe and never touches this process.
 */
export const postPaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'Payments are not available right now.' });
      return;
    }

    const outcome = preparePayment(req.body);
    if (!outcome.ok) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    const { quote, guest, metadata, description } = outcome.prepared;

    const intent = await createPaymentIntent({
      amount: quote.totalPrice,
      currency: quote.currency,
      guestEmail: guest.email,
      description,
      metadata,
    });

    // The amount is echoed for display only. postConfirmBooking reprices from
    // metadata and refuses on mismatch, so a tampered figure here buys nothing.
    res.json({
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      amount: quote.totalPrice,
      currency: quote.currency,
      // Tells the page which card UI it can mount. Stripe Elements needs a real
      // client secret from a real intent; with no credentials there is nothing
      // for it to talk to, so the demo form stands in. The server decides this,
      // not the browser — a client that asked for demo mode could otherwise
      // request it against live Stripe.
      simulated: isSimulated(),
    });
  } catch (error) {
    const safe = toSafeError(error);
    res.status(502).json({ error: safe.message, correlationId: safe.correlationId });
  }
};

export const postPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'Payments are not available right now.' });
      return;
    }

    // Same preparation as the Elements path. Sharing it is the point: a
    // divergence here is a divergence between what gets charged and what gets
    // stored, and the two endpoints must build the same amount from the same
    // input every time.
    const outcome = preparePayment(req.body);
    if (!outcome.ok) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    const { quote, guest, metadata, description } = outcome.prepared;

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const session = await createCheckoutSession({
      // No booking id exists yet, so this is a fresh handle for the attempt.
      clientReferenceId: randomUUID(),
      amount: quote.totalPrice,
      currency: quote.currency,
      guestEmail: guest.email,
      description,
      successUrl: `${appUrl}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/checkout?cancelled=1`,
      metadata,
    });

    res.json({ redirectUrl: session.redirectUrl });
  } catch (error) {
    const safe = toSafeError(error);
    res.status(502).json({ error: safe.message, correlationId: safe.correlationId });
  }
};

/**
 * Sequence steps 6-10. Called when the browser returns from Stripe, and the
 * first chance the booking has to exist.
 *
 * Payment state is read from Stripe, never from the request. Idempotent, so a
 * refresh of the confirmation page returns the same booking rather than a
 * second one, and a race with the webhook resolves to whichever wrote first.
 */
export const postConfirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, paymentIntentId } = req.body ?? {};

    /**
     * Two payment flows land here. Hosted Checkout returns a sessionId; the
     * embedded Elements page returns a paymentIntentId. Both verify against
     * Stripe and produce the same VerifiedPayment, so everything downstream —
     * repricing, the amount cross-check, the insert — is shared and cannot
     * drift between them.
     */
    const hasSession = typeof sessionId === 'string' && sessionId.trim().length > 0;
    const hasIntent = typeof paymentIntentId === 'string' && paymentIntentId.trim().length > 0;

    if (!hasSession && !hasIntent) {
      res.status(400).json({ error: 'sessionId or paymentIntentId is required.' });
      return;
    }

    const payment = hasIntent
      ? await verifyPaymentIntent((paymentIntentId as string).trim())
      : await verifySession((sessionId as string).trim());

    /**
     * Demo-only card metadata.
     *
     * The demo payment form has no Stripe to report a real card, so it derives
     * brand/last4/expiry in the browser and sends just those — never the number
     * it was typed from.
     *
     * Gated on payment.simulated — the provenance of THIS payment — and not on
     * isSimulated(), the process-wide mode. They diverge: a genuine `pi_…`
     * posted to a box running PAYMENTS_MODE=simulate with real credentials
     * verifies against live Stripe, yet the mode flag still reads true. Keying
     * off the mode let a client-supplied card overwrite the real one on an
     * actual charge.
     */
    const withDemoCard =
      payment.simulated && payment.paid
        ? { ...payment, card: readDemoCard(req.body?.demoCard) ?? payment.card }
        : payment;

    const outcome = await recordPaidBooking(withDemoCard);

    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: outcome.error,
        ...(outcome.correlationId ? { correlationId: outcome.correlationId } : {}),
      });
      return;
    }

    res.status(200).json({ booking: outcome.booking });
  } catch (error) {
    const safe = toSafeError(error);
    res.status(502).json({ error: safe.message, correlationId: safe.correlationId });
  }
};

/**
 * Supports the confirmation page, and UC5 later. The UUID is the only
 * customer-facing handle a booking has now that there is no reference column.
 */
export const getBookingById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id ?? req.params.reference;

    // Checked before storage so a scan for `' or 1=1` or a 40KB path segment
    // costs a regex rather than a database round trip.
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      res.status(400).json({ error: 'A valid booking id is required.' });
      return;
    }

    const record = await findById(id);

    if (!record) {
      res.status(404).json({ error: 'Booking not found.' });
      return;
    }

    res.json(record);
  } catch (error) {
    const correlationId = logStorageFailure('findById', error);
    res.status(503).json({ error: 'Could not retrieve that booking.', correlationId });
  }
};

/**
 * ⚠️  TODO — MUST NOT SHIP AS-IS: this endpoint is unauthenticated.
 *
 * :userId is taken straight from the path, so anyone who can guess or harvest a
 * profile UUID can read that person's full booking history — names, emails,
 * phone numbers, stay dates and card last-four. This needs an authenticated
 * session whose subject equals :userId (and a 403 when it does not) before it is
 * exposed to anything but localhost.
 */
export const getBookingsByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId;

    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      res.status(400).json({ error: 'A valid userId is required.' });
      return;
    }

    const bookings = await findByUserId(userId);
    res.json({ bookings });
  } catch (error) {
    const correlationId = logStorageFailure('findByUserId', error);
    res.status(503).json({ error: 'Could not retrieve those bookings.', correlationId });
  }
};
