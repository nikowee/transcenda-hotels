import type { BillingAddress, GuestDetails, StayDetails } from '../types/booking';

/**
 * What travels from the checkout page to the payment page, and back again if
 * the payment does not go through.
 *
 * sessionStorage rather than router state so a refresh on /payment does not
 * strand a customer with no booking to pay for. Both pages used to spell the
 * key as a bare string literal and re-declare the shape; one definition means a
 * rename cannot half-land.
 *
 * Note what is deliberately absent: any price. The browser carries the guest
 * and the stay across the two pages and must never carry an amount — the server
 * prices the stay again when it mints the payment intent, and again at confirm
 * time. Adding a total here would create a figure a client could edit.
 */
export interface CheckoutHandoff {
  guestDetails: GuestDetails;
  billingAddress: BillingAddress;
  stay: StayDetails;
}

const KEY = 'transcenda:checkout';

/**
 * Shape check — sessionStorage is user-writable and may hold anything.
 *
 * The stay is checked field by field, not just for its presence. Every consumer
 * of a handoff dereferences it structurally — stayToParams calls
 * `roomTypes.join`, the payment page posts the whole object — so a stay that is
 * merely *present* is not enough. A hand-edited entry missing roomTypes used to
 * pass this guard and then throw during render, which blanks the page: there is
 * no ErrorBoundary anywhere in this bundle, so a throw inside render unmounts
 * the tree and leaves nothing at all on screen.
 *
 * billingAddress is the deliberate exception — it is not required here even
 * though CheckoutPage always writes one and the payment endpoint refuses
 * without it. The difference is what happens on rejection: nothing here reads
 * the address unchecked, so a missing one cannot throw, and refusing the whole
 * handoff over it would discard a guest's name, email and phone to avoid an
 * error the server states precisely. The authority on whether an address is
 * valid is the validator that already exists server-side. What this guard is
 * for is the fields that would crash the page before it could ask.
 */
const isStay = (value: unknown): value is StayDetails => {
  if (!value || typeof value !== 'object') return false;
  const stay = value as Partial<StayDetails>;
  return (
    typeof stay.destinationId === 'string' &&
    typeof stay.hotelId === 'string' &&
    Array.isArray(stay.roomTypes) &&
    stay.roomTypes.every((room) => typeof room === 'string') &&
    typeof stay.startDate === 'string' &&
    typeof stay.endDate === 'string' &&
    Number.isFinite(stay.adults) &&
    Number.isFinite(stay.children)
  );
};

const isHandoff = (value: unknown): value is CheckoutHandoff => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CheckoutHandoff>;
  return !!candidate.guestDetails && isStay(candidate.stay);
};

/**
 * Reads the handoff, or null when there is none or it is unusable.
 *
 * Never throws. sessionStorage is unavailable in private-mode Safari and when
 * site storage is disabled, and the stored JSON can be malformed or hand-edited
 * — none of which should take down the page that reads it.
 */
export const readHandoff = (): CheckoutHandoff | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isHandoff(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Throws on failure, deliberately: the caller must not navigate if this fails. */
export const writeHandoff = (handoff: CheckoutHandoff): void => {
  sessionStorage.setItem(KEY, JSON.stringify(handoff));
};

/**
 * Cleared only once a booking is confirmed.
 *
 * A failed or abandoned payment must leave it in place — it is what lets the
 * customer return to the review step with their details intact rather than
 * re-entering the whole booking.
 */
export const clearHandoff = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: the page is navigating away regardless.
  }
};

/**
 * A stay in the string form /checkout deals in.
 *
 * The checkout page reads its stay from URL parameters, which are strings; the
 * handoff holds it as a typed object. Both the "back to details" link and the
 * comparison below need to cross that boundary, and they were encoding it
 * separately — a third and fourth spelling of a contract already written out in
 * CheckoutPage. One conversion, used by both.
 */
type StayParams = Record<keyof StayDetails & string, string>;

export const stayToParams = (stay: StayDetails): StayParams => ({
  destinationId: stay.destinationId,
  hotelId: stay.hotelId,
  hotelName: stay.hotelName ?? '',
  // Comma-joined, matching how `room_types` is stored and how the hotel page
  // emits it, so the string survives the round trip without re-encoding.
  roomTypes: stay.roomTypes.join(','),
  startDate: stay.startDate,
  endDate: stay.endDate,
  adults: String(stay.adults),
  children: String(stay.children),
});

/**
 * The query string /checkout needs in order to price the stay again.
 *
 * A bare /checkout link lands on "this checkout link is missing destinationId,
 * hotelId, …" — which is how the payment page's own "Back to details" link used
 * to dead end. hotelName rides along when known so the server need not
 * re-resolve it, and is omitted rather than sent empty when it is not.
 */
export const stayToCheckoutQuery = (stay: StayDetails): string => {
  const { hotelName, ...rest } = stayToParams(stay);
  const params = new URLSearchParams(rest);
  if (hotelName) params.set('hotelName', hotelName);
  return params.toString();
};

/**
 * Is this stored stay the same stay the URL is asking to price?
 *
 * The question matters because the handoff outlives the booking it belongs to.
 * Someone who abandons a payment for hotel A and then starts a fresh booking
 * for hotel B still has A's handoff in storage, and resuming it would seat the
 * previous guest's name, email and phone on B's review step — a booking
 * confirmed and emailed to the wrong person, under a total they never saw.
 *
 * hotelName is excluded on purpose: it is a display label the URL may or may
 * not carry, and a stay is not a different stay because a link omitted it.
 */
const IDENTIFYING_PARAMS = [
  'destinationId',
  'hotelId',
  'roomTypes',
  'startDate',
  'endDate',
  'adults',
  'children',
] as const;

export const matchesStay = (
  stay: StayDetails,
  params: Record<(typeof IDENTIFYING_PARAMS)[number], string>
): boolean => {
  const encoded = stayToParams(stay);
  return IDENTIFYING_PARAMS.every((key) => encoded[key] === params[key]);
};
