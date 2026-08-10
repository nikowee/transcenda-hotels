import { createHash, randomUUID } from 'crypto';
import { type Request, type Response } from 'express';
import type { AuthenticatedUser } from '../middleware/auth.js';
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
import {
  demoRateTable,
  fetchHotelName,
  resolveRateTable,
  type RateTable,
} from '../services/hotelRoomService.js';

/**
 * Booking controller — the «Express Router» box from the class diagram.
 *
 *   get_checkout(req, res)         → getCheckout          GET  /api/bookings/checkout
 *   post_guest_details(req, res)   → postGuestDetails     POST /api/bookings/guest-details
 *   post_payment(req, res)         → postPayment          POST /api/bookings/payment
 *   post_confirm_booking(req, res) → postConfirmBooking   POST /api/bookings/confirm
 *   get_booking(req, res)          → getBookingById       GET  /api/bookings/:id
 *   get_user_bookings(req, res)    → getBookingsByUser    GET  /api/bookings/user/:userId
 *
 * Flow rule: pay first, write second. bookings has payment_id and price_paid
 * NOT NULL with no status column, so there is no PENDING row to create up
 * front — payment is minted first and the row is written once Stripe says the
 * charge cleared, with the customer's details riding the metadata across the
 * redirect.
 *
 * Pricing rule: never read an amount from a request body. Every figure comes
 * from a rate table built server-side by hotelRoomService (supplier rates for
 * real rooms, the demo catalogue for the four offline slugs), both when
 * quoting and when charging.
 */

/**
 * Exported limits: tests assert against these rather than restating them, so
 * changing a boundary changes the tests with it.
 */
export const CURRENCY = 'SGD';
export const MAX_NIGHTS = 30;
export const MAX_ROOMS = 8;
export const MAX_GUESTS = 20;

/** Fits inside one Stripe metadata value, which is the real constraint. */
const MAX_SPECIAL_REQUESTS = 500;

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
 * weakens that check; nothing at the database layer enforces it. Rejecting here
 * costs a re-submitted form; rejecting at insert time would cost a captured
 * charge with nowhere to record it.
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
export const buildQuote = (
  input: unknown,
  /**
   * Omitted, the four offline demo rooms are all that can be priced. The live
   * path passes a table that also carries the supplier's rooms for this exact
   * stay — see quoteStay, which is what the HTTP handlers call.
   */
  rates?: RateTable
): { quote: Quote } | { error: string } => {
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

  /**
   * Priced after the dates are known, because a supplier quote is for a stay
   * rather than for a night — the table handed in is built for these exact
   * check-in and check-out dates and is meaningless without them.
   *
   * Object.hasOwn, not a plain lookup: rates['constructor'] resolves to a
   * function off Object.prototype rather than undefined, so `=== undefined`
   * waves prototype keys straight past this guard. They are then multiplied into
   * a NaN subtotal and only stopped by the isFinite check at the bottom — safe,
   * but by accident, and with the wrong error.
   */
  const table = rates ?? demoRateTable(nights);

  const nightlyRates: number[] = [];
  const roomLabels: string[] = [];
  let subtotal = 0;
  let taxes = 0;

  for (const roomType of roomTypes) {
    const room = Object.hasOwn(table, roomType) ? table[roomType] : undefined;
    if (!room) return { error: 'That room type is not available.' };

    nightlyRates.push(room.nightlyRate);
    roomLabels.push(room.label);
    subtotal += room.subtotal;
    taxes += room.taxes;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  taxes = Math.round(taxes * 100) / 100;

  const nightlyTotal = Math.round(nightlyRates.reduce((sum, rate) => sum + rate, 0) * 100) / 100;
  const totalPrice = Math.round((subtotal + taxes) * 100) / 100;

  if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
    return { error: 'Could not price that stay.' };
  }

  return {
    quote: {
      destinationId, hotelId, hotelName, roomTypes, startDate, endDate, adults, children,
      nights, currency: CURRENCY, roomLabels, nightlyRates, nightlyTotal, subtotal, taxes,
      totalPrice,
    },
  };
};

/**
 * Ascenda counts heads per room and spells it "2" for one room, "2|2" for two.
 * Guests are spread as evenly as the party divides, because a room asked to
 * sleep the whole party is quoted at a different rate — or reported unavailable
 * — than the same rooms asked to sleep two each.
 */
const toGuestsParam = (adults: number, children: number, rooms: number): string => {
  const total = adults + children;
  const base = Math.floor(total / rooms);
  const remainder = total % rooms;

  return Array.from({ length: rooms }, (_, index) =>
    String(Math.max(1, base + (index < remainder ? 1 : 0)))
  ).join('|');
};

/**
 * buildQuote with the rate table fetched first — what every HTTP handler calls.
 *
 * The stay is read twice: loosely here, only far enough to address the supplier,
 * and then properly inside buildQuote, which stays the sole authority on whether
 * a stay is valid. Anything this pre-read cannot make sense of falls through
 * with no table, so a malformed request gets buildQuote's specific error rather
 * than a supplier lookup failure that says nothing about what was wrong.
 */
export const quoteStay = async (
  input: unknown
): Promise<{ quote: Quote } | { error: string; status?: number }> => {
  const raw = (input ?? {}) as Record<string, unknown>;

  const roomTypes = toRoomTypeList(raw.roomTypes) ?? [];
  const hotelId = asTrimmed(raw.hotelId);
  const destinationId = asTrimmed(raw.destinationId);
  const startDate = raw.startDate;
  const endDate = raw.endDate;

  const addressable =
    hotelId !== '' &&
    destinationId !== '' &&
    roomTypes.length > 0 &&
    roomTypes.length <= MAX_ROOMS &&
    isIsoDate(startDate) &&
    isIsoDate(endDate);

  if (!addressable) return buildQuote(input);

  const nights = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000);
  if (!Number.isFinite(nights) || nights < 1 || nights > MAX_NIGHTS) return buildQuote(input);

  const adults = Number(raw.adults);
  const children = raw.children === undefined || raw.children === null ? 0 : Number(raw.children);
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) {
    return buildQuote(input);
  }

  /**
   * RoomList starts a booking with a hotel id and a room key and nothing else —
   * the name is on the page it navigated away from. Resolve it from the supplier
   * rather than adding a query parameter two screens have to agree on.
   *
   * Only when the caller did not supply one: search results legitimately know
   * the name already, and asking again would add a round trip per quote.
   */
  const suppliedName = asTrimmed(raw.hotelName);
  const hotelName = suppliedName || ((await fetchHotelName(hotelId)) ?? '');

  const lookup = await resolveRateTable(
    {
      hotelId,
      destinationId,
      checkin: startDate,
      checkout: endDate,
      guests: toGuestsParam(adults, children, roomTypes.length),
      nights,
      currency: CURRENCY,
    },
    roomTypes
  );

  if (!lookup.ok) return { error: lookup.error, status: lookup.status };

  // hotelName folded back in, so buildQuote validates the resolved name rather
  // than the absent one the caller sent.
  return buildQuote({ ...raw, hotelName }, lookup.table);
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
  /**
   * What the stay was quoted at when the payment was created, in major units.
   *
   * Written by the server into Stripe's own metadata store, which the browser
   * can neither read back nor alter, so this is as trustworthy as re-deriving
   * the price and — unlike re-deriving it — cannot move. Supplier rates change
   * between minting a PaymentIntent and confirming it; without this the
   * confirm-time amount check would reject a charge that already succeeded and
   * strand the guest with a payment and no booking.
   *
   * Null for a session created before this key existed, which falls back to the
   * reprice.
   */
  quotedTotal: number | null;
}

const toSessionMetadata = (carried: CarriedBooking): Record<string, string> => {
  const { specialRequests, ...identity } = carried.guest;

  return {
    guest: JSON.stringify(identity),
    stay: JSON.stringify(carried.stay),
    ...(carried.quotedTotal !== null ? { quotedTotal: carried.quotedTotal.toFixed(2) } : {}),
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

    const quotedTotal = Number(metadata.quotedTotal);

    return {
      guest: { ...normaliseGuest(guest), specialRequests: metadata.specialRequests ?? null },
      billing:
        billing && typeof billing === 'object' ? normaliseBilling(billing) : null,
      stay,
      userId: metadata.userId ?? null,
      // Number('') is 0 and Number(undefined) is NaN, so both the absent key and
      // an empty one have to fail this test rather than only one of them.
      quotedTotal: Number.isFinite(quotedTotal) && quotedTotal > 0 ? quotedTotal : null,
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
  // the browser.
  const result = await quoteStay(carried.stay);
  const repriced = 'error' in result ? null : result.quote;

  /**
   * A stay that will not reprice is not the same as a stay that was never sold.
   *
   * Supplier room keys are scoped to the price search that issued them: ask
   * Ascenda for the same hotel and dates twice and "Premier Courtyard Room King"
   * comes back under a different uuid each time. Once hotelRoomService's cache
   * entry has expired, re-pricing a genuine booking therefore fails with "that
   * room type is not available" rather than with a different number — and a
   * webhook redelivered hours later hits precisely that.
   *
   * When this server quoted and charged the stay itself, the metadata is a
   * complete record of what was sold and the reprice was only ever a
   * cross-check. Refusing the insert because the check cannot be run turns a
   * recoverable charge into a lost one. With no quoted total there is nothing to
   * fall back on and the refusal stands.
   */
  if (!repriced && carried.quotedTotal === null) {
    console.error(
      `Paid session ${payment.paymentIntentId} carries an unpriceable stay: ` +
        `${(result as { error: string }).error}`
    );
    return { ok: false, status: 409, error: 'That payment does not match a bookable stay.' };
  }

  if (!repriced) {
    console.warn(
      `Could not reprice ${payment.paymentIntentId} — recording it at the quoted ` +
        `${carried.quotedTotal} ${CURRENCY}. Supplier room keys rotate per search, ` +
        'so this is expected once the rate cache has expired.'
    );
  }

  const nights = Math.round(
    (Date.parse(carried.stay.endDate) - Date.parse(carried.stay.startDate)) / 86_400_000
  );

  /**
   * The amount to check against is the one this server quoted when it created
   * the payment, not the one a fresh lookup returns now.
   *
   * Both are server-side figures — the metadata was written by preparePayment
   * and lives in Stripe, where the browser cannot reach it — so this is exactly
   * as strong against a tampered total. What it is not vulnerable to is the
   * supplier moving its rates mid-checkout, which the reprice alone would read
   * as fraud and answer with a 409, leaving a captured charge and no booking.
   */
  const expectedPrice = carried.quotedTotal ?? repriced!.totalPrice;
  const currency = repriced?.currency ?? CURRENCY;

  if (repriced && carried.quotedTotal !== null && carried.quotedTotal !== repriced.totalPrice) {
    console.warn(
      `Rate drift on ${payment.paymentIntentId}: quoted ${carried.quotedTotal} ${currency}, ` +
        `now ${repriced.totalPrice}. Honouring the quoted price.`
    );
  }

  if (payment.amountTotal !== null) {
    const expected = toMinorUnits(expectedPrice, currency);
    if (payment.amountTotal !== expected) {
      console.error(
        `Amount mismatch on ${payment.paymentIntentId}: charged ${payment.amountTotal}, expected ${expected}`
      );
      return { ok: false, status: 409, error: 'Payment amount did not match the booking.' };
    }
  }

  if (payment.currency && payment.currency.toUpperCase() !== currency.toUpperCase()) {
    console.error(
      `Currency mismatch on ${payment.paymentIntentId}: charged ${payment.currency}, expected ${currency}`
    );
    return { ok: false, status: 409, error: 'Payment currency did not match the booking.' };
  }

  /** The reprice when there was one, the metadata when there was not. */
  const stay = repriced ?? { ...carried.stay, nights };

  try {
    /**
     * Sequence steps 9-10, as insertOne's onCreated hook rather than a line
     * after it.
     *
     * This used to sit below the insert, on the reasoning that the
     * findByPaymentId short-circuit above meant a redelivery never reached it.
     * That holds for a *sequential* retry and not for the concurrent one: the
     * browser confirming while the webhook recovers is the exact race
     * writesInFlight was added for, and both callers pass the short-circuit,
     * both call insertOne, and both are handed the same record. Emailing from
     * the return value therefore emailed twice for one booking. The hook fires
     * only for whichever caller actually wrote the row.
     *
     * Never allowed to throw — the money is captured and the row is written,
     * and a bounced email must not turn a successful booking into a failed
     * request. insertOne isolates it too, so this is belt and braces.
     */
    const emailOnce = async (written: BookingRecord): Promise<void> => {
      try {
        const receipt = await sendConfirmation(written.guest.email, written);
        if (!receipt.delivered) {
          console.warn(
            `Booking ${written.id} saved but confirmation email failed: ${receipt.errorMessage}`
          );
        }
      } catch (error) {
        console.warn(`Booking ${written.id} saved but confirmation email threw:`, error);
      }
    };

    const booking = await insertOne({
      userId: carried.userId,
      guest: carried.guest,
      billing: carried.billing,
      stay: {
        destinationId: stay.destinationId,
        hotelId: stay.hotelId,
        hotelName: stay.hotelName,
        roomTypes: stay.roomTypes,
        startDate: stay.startDate,
        endDate: stay.endDate,
        adults: stay.adults,
        children: stay.children,
      },
      nights: stay.nights,
      // What the guest was actually charged, which is the quoted price whenever
      // one was carried — never a rate that moved after they paid it.
      pricePaid: expectedPrice,
      paymentId: payment.paymentIntentId,
      // payee_id is NOT NULL and a guest checkout produces no Stripe Customer,
      // so the payer's email is the identifier of last resort.
      payeeId: payment.payeeId ?? carried.guest.email,
      card: payment.card ?? UNKNOWN_CARD,
    }, emailOnce);

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
    const result = await quoteStay({
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
      // A supplier fault carries its own status (502/504); a rejected stay has
      // none and is the caller's problem.
      res.status(result.status ?? 400).json({ error: result.error });
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
  /** Same booking attempt → same key → Stripe replays one intent, not many. */
  idempotencyKey: string;
}

type PrepareOutcome =
  | { ok: true; prepared: PreparedPayment }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Everything both payment flows must do before money is involved: validate the
 * guest, price the stay from the supplier's rates, and pack what has to survive
 * the trip to Stripe.
 *
 * Shared rather than duplicated because a divergence here is a divergence in
 * what gets charged versus what gets stored — the two endpoints must build the
 * same amount from the same input every time.
 */
const preparePayment = async (
  body: unknown,
  auth: AuthenticatedUser | undefined
): Promise<PrepareOutcome> => {
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

  const result = await quoteStay(stay);
  if ('error' in result) {
    return { ok: false, status: result.status ?? 400, body: { error: result.error } };
  }
  const { quote } = result;

  /**
   * Whose booking this is.
   *
   * The answer comes from `auth` — a Supabase token this server verified — and
   * never from the body, because a user id in a payload is a claim rather than
   * a credential. The body is still *read*, but only to catch a client sending
   * one identity while authenticated as another, which is a bug worth naming
   * rather than silently resolving in either direction.
   */
  const claimedUserId =
    userId === undefined || userId === null ? null : String(userId);

  // user_id is a foreign key to profiles, so a malformed one fails at insert
  // time — long after the card has been charged. Reject it while it is free.
  if (claimedUserId !== null && !UUID_PATTERN.test(claimedUserId)) {
    return { ok: false, status: 400, body: { error: 'userId must be a UUID.' } };
  }

  /**
   * A claim with nothing backing it. Recording the booking as a guest checkout
   * instead would be quieter but wrong: it would let anyone attach a booking to
   * a stranger's history, and it would hide from a genuinely-signed-in guest
   * that their token never arrived — they would pay, and then not find the
   * booking on their history page.
   */
  if (!auth && claimedUserId !== null) {
    return {
      ok: false,
      status: 401,
      body: { error: 'Sign in to attach this booking to an account.' },
    };
  }

  if (auth && claimedUserId !== null && claimedUserId !== auth.userId) {
    return {
      ok: false,
      status: 403,
      body: { error: 'That booking cannot be attached to another account.' },
    };
  }

  const resolvedUserId = auth?.userId ?? null;

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
    userId: resolvedUserId,
    quotedTotal: quote.totalPrice,
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

  /**
   * Stable across retries of the same booking attempt, different for anything
   * else. Stripe replays the original intent for a repeated key, which is what
   * stops /payment minting a fresh one every time it mounts — a refresh or a
   * second trip through checkout used to leave abandoned intents behind.
   *
   * The priced total is folded in deliberately. Keyed on the stay alone, a
   * re-quoted booking would be handed back the old intent at the old amount,
   * and the guest would be charged a price this server no longer offers. Rate
   * drift is common enough with a live supplier that this is not theoretical.
   *
   * Guest email is in the key so two people booking the same room for the same
   * nights get their own intents rather than sharing one.
   *
   * Every field the request carries must be in the key, not just the ones that
   * decide the amount. Stripe rejects a repeated key used with *different
   * parameters*, so a key narrower than the request is worse than no key: it
   * turns an ordinary edit into a hard failure. A guest who goes back from
   * /payment to fix a phone number or an address line, or who signs in
   * mid-checkout and so adds a userId, would recompute the same key while
   * sending different metadata and shipping — Stripe answers 400
   * idempotency_error, which surfaces as a 502, and keeps answering it for the
   * 24 hours it holds the key. The stay would become unpayable.
   *
   * So the key is built from the metadata that actually goes on the wire, plus
   * the amount. Anything that changes the request changes the key, which mints
   * a new intent — the correct outcome, since it *is* a different request.
   */
  const idempotencyKey = createHash('sha256')
    .update(
      JSON.stringify([
        metadata,
        quote.totalPrice,
        quote.currency,
      ])
    )
    .digest('hex');

  const nightLabel = `${quote.nights} night${quote.nights > 1 ? 's' : ''}`;

  return {
    ok: true,
    prepared: {
      quote,
      guest,
      billing,
      metadata,
      idempotencyKey,
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

    const outcome = await preparePayment(req.body, req.auth);
    if (!outcome.ok) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    const { quote, guest, billing, metadata, description, idempotencyKey } = outcome.prepared;

    const intent = await createPaymentIntent({
      amount: quote.totalPrice,
      currency: quote.currency,
      guestEmail: guest.email,
      description,
      metadata,
      idempotencyKey,
      /**
       * paymentService has always accepted `billing` and attached it to the
       * intent, but this call site never passed it, so the parameter was dead
       * and every intent went out with no address on it at all.
       *
       * It matters because our own table stores no address: the Stripe object
       * is the only place it is recorded, and an address sent nowhere would be
       * one collected for nothing. Note this lands as `shipping`, not as the
       * billing_details an AVS check reads — see paymentService.
       */
      billing: {
        name: `${guest.firstName} ${guest.lastName}`.trim(),
        line1: billing.line1,
        line2: billing.line2 ?? null,
        city: billing.city,
        state: billing.state ?? null,
        postalCode: billing.postalCode,
        country: billing.country,
      },
    });

    // The amount is echoed for display only. postConfirmBooking reprices from
    // metadata and refuses on mismatch, so a tampered figure here buys nothing.
    res.json({
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.paymentIntentId,
      amount: quote.totalPrice,
      currency: quote.currency,
      /**
       * The whole priced quote, so the payment page can show what is being paid
       * for rather than only how much.
       *
       * It has to come from here and not from the checkout handoff: the browser
       * holds the guest and stay in sessionStorage, but it must never hold the
       * price. This is the same quote the PaymentIntent was minted from, so the
       * summary on screen and the amount on the card cannot disagree.
       *
       * `amount` and `currency` above are quote.totalPrice and quote.currency.
       * Kept because they are what the pay button reads and what the intent
       * response has always carried.
       */
      quote,
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
    const outcome = await preparePayment(req.body, req.auth);
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
 * A guest's own booking history.
 *
 * :userId names the account being asked about; it does not prove entitlement to
 * it. The response carries names, emails, phone numbers, stay dates and card
 * last-four, so what authorises the read is the verified session — requireUser
 * in index.ts guarantees req.auth exists by the time this runs, and the check
 * below is that its subject is the account in the path.
 *
 * Keeping :userId in the URL rather than reading it solely from the token is
 * deliberate: it makes the resource being requested visible in logs and caches,
 * and turns a client that mixes up accounts into a 403 instead of a silent
 * substitution of whichever account happens to be signed in.
 */
export const getBookingsByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId;

    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      res.status(400).json({ error: 'A valid userId is required.' });
      return;
    }

    /**
     * 403 rather than 404: the caller is authenticated, just not entitled. A
     * 404 would be the confidentiality-preserving answer if account existence
     * were a secret, but a booking history is only reachable by someone who
     * already knows the UUID, so the clearer error wins.
     */
    if (req.auth?.userId !== userId) {
      res.status(403).json({ error: 'You can only view your own bookings.' });
      return;
    }

    const bookings = await findByUserId(userId);
    res.json({ bookings });
  } catch (error) {
    const correlationId = logStorageFailure('findByUserId', error);
    res.status(503).json({ error: 'Could not retrieve those bookings.', correlationId });
  }
};
