import type { CardDetails } from '../types/booking';

/**
 * Display formatting shared by the booking pages.
 *
 * These lived as private copies in CheckoutPage, PaymentPage and
 * ConfirmationPage — formatMoney four times over (three top-level and one
 * inline), formatOccupancy three times, CURRENCY twice. Copies of a formatter
 * drift: PaymentPage's occupancy already said "1 children" where the other two
 * said "1 child", because one used `=== 1 ? '' : 's'` on the wrong stem. A
 * single definition is the only way that stops recurring.
 *
 * In lib/ rather than components/ because none of these render anything. They
 * sit beside amenityIcons and amenityLabels, which are the same kind of thing.
 */

/** The schema stores no currency column: the platform prices everything in SGD. */
export const CURRENCY = 'SGD';

/**
 * `SGD 1,234.50`.
 *
 * Always two decimal places, even when the amount is whole — a price rendered
 * as "SGD 480" next to one rendered as "SGD 479.90" reads as a different kind
 * of number. The currency is a parameter because a server-priced quote carries
 * its own, and only falls back to the platform default when it does not.
 */
export const formatMoney = (amount: number, currency: string = CURRENCY): string =>
  `${currency} ${amount.toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * `2 adults, 1 child` — and never `1 adults` or `1 childs`.
 *
 * Children are omitted entirely at zero rather than shown as "0 children",
 * which reads like a correction.
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
 * `Visa •••• 4242`.
 *
 * Brand, last four and expiry are the only card fields PCI-DSS permits storing,
 * and this renders two of them as a receipt line. Nothing here is card data in
 * the sense that matters — no PAN or CVC exists anywhere in this application.
 */
export const formatCard = (card: CardDetails): string =>
  `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}`;

/**
 * Room names for display, falling back to the supplier id per room.
 *
 * Per room rather than for the whole list, deliberately: a quote from before
 * roomLabels existed has none, and a supplier that names some rooms and not
 * others should still show the names it gave. A raw id reads badly but reads —
 * an empty line does not.
 */
export const formatRooms = (roomTypes: string[], roomLabels?: (string | null)[]): string =>
  roomTypes.map((id, index) => roomLabels?.[index] ?? id).join(' · ');
