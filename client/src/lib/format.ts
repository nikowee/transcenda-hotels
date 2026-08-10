import type { CardDetails } from '../types/booking';

/**
 * Display formatting shared by the booking pages — one definition per
 * formatter, keeping copies from drifting apart ("1 child" on one page and
 * "1 children" on another). Lives in lib/ beside amenityIcons and
 * amenityLabels because nothing here renders.
 */

/** The schema stores no currency column: the platform prices everything in SGD. */
export const CURRENCY = 'SGD';

/**
 * `SGD 1,234.50` — always two decimal places, even on whole amounts, so
 * prices read as the same kind of number side by side. Currency is a
 * parameter because a server-priced quote carries its own.
 */
export const formatMoney = (amount: number, currency: string = CURRENCY): string =>
  `${currency} ${amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * `2 adults, 1 child` — never `1 adults` or `1 childs`, and children are
 * omitted entirely at zero rather than shown as "0 children".
 */
export const formatOccupancy = (adults: number, children: number): string => {
  const parts = [`${adults} ${adults === 1 ? 'adult' : 'adults'}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? 'child' : 'children'}`);
  return parts.join(', ');
};

/** `3 nights`, `1 night`. */
export const formatNights = (nights: number): string =>
  `${nights} ${nights === 1 ? 'night' : 'nights'}`;

/**
 * `Visa •••• 4242` — renders the receipt line from the only card fields
 * PCI-DSS permits storing. No PAN or CVC exists anywhere in this application.
 */
export const formatCard = (card: CardDetails): string =>
  `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}`;

/**
 * Room names for display, falling back to the supplier id per room — a
 * supplier that names some rooms and not others still shows the names it
 * gave, and a raw id reads badly but reads.
 */
export const formatRooms = (roomTypes: string[], roomLabels?: (string | null)[]): string =>
  roomTypes.map((id, index) => roomLabels?.[index] ?? id).join(' · ');
