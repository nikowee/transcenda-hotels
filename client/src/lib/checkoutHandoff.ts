import type { BillingAddress, GuestDetails, StayDetails } from '../types/booking';

/** What travels from the checkout page to the payment page, and back again if the payment does not go through. */
export interface CheckoutHandoff {
  guestDetails: GuestDetails;
  billingAddress: BillingAddress;
  stay: StayDetails;
}

const KEY = 'transcenda:checkout';

/** Shape check — sessionStorage is user-writable and may hold anything. */
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

/** Read the handoff, or null when there is none or it is unusable. */
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

/** Clear only once a booking is confirmed. */
export const clearHandoff = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do: the page is navigating away regardless.
  }
};

/** Convert a stay to the string form /checkout deals in (URL parameters are strings; the handoff holds a typed object). */
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

/** The query string /checkout needs in order to price the stay again. */
export const stayToCheckoutQuery = (stay: StayDetails): string => {
  const { hotelName, ...rest } = stayToParams(stay);
  const params = new URLSearchParams(rest);
  if (hotelName) params.set('hotelName', hotelName);
  return params.toString();
};

/** Match check: is this stored stay the same stay the URL is pricing? */
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
