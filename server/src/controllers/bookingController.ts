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

/** Booking controller — the «Express Router» box from the class diagram. */

/** Exported limits: tests assert against these rather than restating them, so changing a boundary changes the tests with it. */
export const CURRENCY = 'SGD';
export const MAX_NIGHTS = 30;
export const MAX_ROOMS = 8;
export const MAX_GUESTS = 20;

/** Fits inside one Stripe metadata value, which is the real constraint. */
const MAX_SPECIAL_REQUESTS = 500;

/** Version-agnostic on purpose. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Free-text salutations end up printed on correspondence and stored forever, so the column takes an allowlisted value or nothing. */
const SALUTATIONS = new Set(['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof']);

/** Storage faults carry configuration detail (connection strings, key prefixes) that must not reach a response body, so the cause is logged against a correlation id and only the id travels out. */
const logStorageFailure = (operation: string, error: unknown): string => {
  const correlationId = `db_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  console.error(`[storage ${correlationId}] ${operation} failed:`, error);
  return correlationId;
};

/** The quote shape is defined once, in the shared contract, and aliased here rather than redeclared. */
export type Quote = CheckoutQuote;

const asTrimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Alternative flow 1a: detect missing or invalid guest details, returning a field → message map so the client marks up the offending inputs instead of showing one banner for six fields. */
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

/** Validate the billing address, required at the form because Stripe runs AVS against it. */
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

/** Normalise roomTypes: query strings send an array for repeated keys or one comma-joined string, JSON bodies send an array. */
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

/** Single source of truth for pricing: the displayed quote, the amount sent to Stripe, and the confirm-time cross-check all come from here, so no two can disagree and nothing priced is ever read from a request body. */
export const buildQuote = (
  input: unknown,
  /** Omitted, the four offline demo rooms are all that can be priced. */
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

  /** Price only after the dates are known. */
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

/** Spell occupancy the way Ascenda counts it. */
const toGuestsParam = (adults: number, children: number, rooms: number): string => {
  const total = adults + children;
  const base = Math.floor(total / rooms);
  const remainder = total % rooms;

  return Array.from({ length: rooms }, (_, index) =>
    String(Math.max(1, base + (index < remainder ? 1 : 0)))
  ).join('|');
};

/** buildQuote with the rate table fetched first. */
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

  /** Resolve the hotel name from the supplier only when the caller did not supply one. */
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

/** Pack the stay and guest into Stripe metadata. */
const STRIPE_METADATA_VALUE_LIMIT = 500;

interface CarriedBooking {
  guest: GuestDetails;
  billing: BillingAddress | null;
  stay: StayDetails;
  userId: string | null;
  /** The stay's quoted amount at payment-creation time, in major units. */
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

/** Fallback card values: the card columns are NOT NULL, and a wallet or bank- transfer payment has no card to report. */
const UNKNOWN_CARD: CardDetails = {
  brand: 'unknown',
  last4: '0000',
  expMonth: 0,
  expYear: 0,
};

/** Return failures rather than throwing so the webhook can decide whether to make Stripe retry. */
export type RecordOutcome =
  | { ok: true; booking: BookingRecord }
  | { ok: false; status: number; error: string; correlationId?: string };

/** Turn a cleared Stripe payment into a booking row. */
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

  /** Recovery rule: a stay that will not reprice is not a stay that was never sold. */
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

  /** Check against the amount this server quoted at payment creation, not a fresh lookup. */
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
    /** Sequence steps 9-10, on insertOne's onCreated hook. Not awaited: a paid guest's response must not wait on a mail provider. */
    const emailOnce = (written: BookingRecord): void => {
      sendConfirmation(written.guest.email, written)
        .then((receipt) => {
          if (!receipt.delivered) {
            console.warn(
              `Booking ${written.id} saved but confirmation email failed: ${receipt.errorMessage}`
            );
          }
        })
        .catch((error) => {
          console.warn(`Booking ${written.id} saved but confirmation email threw:`, error);
        });
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
    /** Check billing here as well as at /payment-intent, keeping an address error on the page where the customer typed it instead of one page after they committed to paying. */
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

/** Sequence steps 4-5: price the stay server-side and open a Stripe-hosted checkout session. */
/** Validate the card metadata the demo form reports. */
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

/** Everything both payment flows do before money is involved: validate the guest, price the stay from the supplier's rates, and pack what must survive the trip to Stripe. */
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

  /** Identity rule: whose booking this is comes from `auth`. */
  const claimedUserId =
    userId === undefined || userId === null ? null : String(userId);

  // user_id is a foreign key to profiles, so a malformed one fails at insert
  // time — long after the card has been charged. Reject it while it is free.
  if (claimedUserId !== null && !UUID_PATTERN.test(claimedUserId)) {
    return { ok: false, status: 400, body: { error: 'userId must be a UUID.' } };
  }

  /** Reject an unbacked claim: recording it as a guest checkout instead would let anyone attach a booking to a stranger's history, and would hide from a genuinely signed-in guest that their token never arrived. */
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
   * Idempotency key over the full wire metadata plus amount: a narrower key
   * turns an ordinary edit into a 24-hour unpayable stay (Stripe rejects a
   * repeated key sent with different parameters).
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

/** Mints a PaymentIntent for the embedded Elements page and returns its client secret. */
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
      /** paymentService has always accepted `billing` and attached it to the intent, but this call site never passed it, so the parameter was dead and every intent went out with no address on it at all. */
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
      /** The whole priced quote, so the payment page can show what is being paid for rather than only how much. */
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

/** Sequence steps 6-10. */
export const postConfirmBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, paymentIntentId } = req.body ?? {};

    /** Two payment flows land here. */
    const hasSession = typeof sessionId === 'string' && sessionId.trim().length > 0;
    const hasIntent = typeof paymentIntentId === 'string' && paymentIntentId.trim().length > 0;

    if (!hasSession && !hasIntent) {
      res.status(400).json({ error: 'sessionId or paymentIntentId is required.' });
      return;
    }

    const payment = hasIntent
      ? await verifyPaymentIntent((paymentIntentId as string).trim())
      : await verifySession((sessionId as string).trim());

    /** Demo-only card metadata. */
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

/** Supports the confirmation page, and UC5 later. */
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

/** A guest's own booking history. */
export const getBookingsByUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId;

    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      res.status(400).json({ error: 'A valid userId is required.' });
      return;
    }

    /** 403 rather than 404: the caller is authenticated, just not entitled. */
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