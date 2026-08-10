import type { BookingRecord } from '../models/bookingTypes.js';

/**
 * EmailService — the «External API» box from the class diagram.
 *
 * Log-only delivery: no mail transport is configured (the lockfile mandate
 * rules out adding one), so the confirmation is printed rather than sent. The
 * signature and return shape are the real ones, making a future provider a
 * change to this file only.
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
 * Runs only after the booking row exists — meaning the charge already cleared,
 * so there is never a confirmation for an unpaid stay. The booking id leads
 * the message as the customer's only handle.
 *
 * Safety guardrail: never reject. The card is charged and the row committed by
 * the time this runs, so a throw here would report a completed booking as a
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
    // Swallow, never throw: the money is taken and the row committed, so a
    // failed email must not sink a paid booking.
    return { delivered: false, errorMessage: error?.message ?? 'Email delivery failed' };
  }
};
