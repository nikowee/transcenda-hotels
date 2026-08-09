import type { BookingRecord } from '../models/bookingTypes.js';

/**
 * EmailService — the «External API» box from the UC4 class diagram.
 *
 * Delivery is logged, not sent: no mail transport is configured, and the
 * lockfile mandate rules out adding one on a feature branch. The signature and
 * return shape are the real ones, so dropping in a provider later is a change
 * to this file only.
 */

export interface DeliveryReceipt {
  delivered: boolean;
  messageId?: string;
  errorMessage?: string;
}

/** The platform prices in SGD; the bookings table stores no currency column. */
const CURRENCY = 'SGD';

const formatStayDates = (startDate: string, endDate: string, nights: number) =>
  `${startDate} → ${endDate} (${nights} night${nights === 1 ? '' : 's'})`;

const formatGuestName = (booking: BookingRecord) =>
  `${booking.guest.salutation} ${booking.guest.firstName} ${booking.guest.lastName}`;

/**
 * Sequence diagram step 9: sendConfirmation(email, bookingDetails) → step 10.
 *
 * Sent only after the booking row exists, which under this schema also means
 * after the charge cleared — there is no unpaid booking to send a confirmation
 * for. The booking id is the customer's only handle now that booking_reference
 * is gone, so it leads the message.
 *
 * This function must never reject. By the time it runs the card is charged and
 * the row is committed; a throw here would report a completed booking as a
 * failed request and send the guest back to pay again.
 */
export const sendConfirmation = async (
  email: string,
  bookingDetails: BookingRecord
): Promise<DeliveryReceipt> => {
  try {
    console.log(
      [
        '📧 Booking confirmation queued',
        `   to:        ${email}`,
        `   booking:   ${bookingDetails.id}`,
        `   guest:     ${formatGuestName(bookingDetails)}`,
        `   hotel:     ${bookingDetails.hotelName}`,
        `   rooms:     ${bookingDetails.roomTypes.join(', ')}`,
        `   stay:      ${formatStayDates(bookingDetails.startDate, bookingDetails.endDate, bookingDetails.nights)}`,
        `   paid:      ${CURRENCY} ${bookingDetails.pricePaid.toFixed(2)}`,
      ].join('\n')
    );

    return { delivered: true, messageId: `log_${bookingDetails.id}` };
  } catch (error: any) {
    // Confirmation email is not allowed to sink a paid booking — the money is
    // already taken and the row is already committed by this point.
    return { delivered: false, errorMessage: error?.message ?? 'Email delivery failed' };
  }
};
