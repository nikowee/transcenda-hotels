import axios from 'axios';
import type { BookingRecord } from '../models/bookingTypes.js';

/**
 * EmailService — the «External API» box from the UC4 class diagram.
 *
 * Two transports, chosen per call:
 *
 *   RESEND_API_KEY + EMAIL_FROM set → a real delivery via Resend's HTTP API.
 *     Plain axios rather than the resend SDK on purpose: the lockfile mandate
 *     rules out new dependencies, and the API is one POST.
 *   either absent → the message is logged, which is what dev, docker-compose
 *     and the entire test suite run on. Same receipt shape either way.
 *
 * Keep both vars unset outside production: the E2E suite books with
 * throwaway @example.com addresses, and example.com accepts no mail — every
 * send would hard-bounce against the sending domain's reputation.
 *
 * Env is read per call, not at module scope, so a test can flip transports
 * without an import-order dance — the same pattern paymentService uses for
 * isSimulated().
 */

export interface DeliveryReceipt {
  delivered: boolean;
  messageId?: string;
  errorMessage?: string;
}

/** The platform prices in SGD; the bookings table stores no currency column. */
const CURRENCY = 'SGD';

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * How long a confirmation may block the booking response for. Half the
 * shutdown drain window in index.ts, never equal to it: a send racing SIGTERM
 * must lose to the drain, not tie it, or a stalled provider during a deploy
 * kills a paid booking's response mid-flight.
 */
const SEND_TIMEOUT_MS = 5_000;

const formatStayDates = (startDate: string, endDate: string, nights: number) =>
  `${startDate} → ${endDate} (${nights} night${nights === 1 ? '' : 's'})`;

const formatGuestName = (booking: BookingRecord) =>
  `${booking.guest.salutation} ${booking.guest.firstName} ${booking.guest.lastName}`;

const isConfigured = (): boolean =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

/**
 * What the guest receives. The booking id leads because it is the guest's
 * only handle — booking_reference does not exist in this schema, so a
 * confirmation without the id is unusable for support.
 */
const renderCustomerMessage = (booking: BookingRecord) => ({
  subject: `Booking confirmed — ${booking.hotelName} (${booking.id})`,
  text: [
    `Dear ${formatGuestName(booking)},`,
    '',
    `Your booking at ${booking.hotelName} is confirmed.`,
    '',
    `Booking reference: ${booking.id}`,
    `Rooms:             ${booking.roomTypes.join(', ')}`,
    `Stay:              ${formatStayDates(booking.startDate, booking.endDate, booking.nights)}`,
    `Amount paid:       ${CURRENCY} ${booking.pricePaid.toFixed(2)}`,
    '',
    'Please quote the booking reference in any correspondence.',
    '',
    'Transcenda Hotels',
  ].join('\n'),
});

/** What the server logs — operator-facing, never sent to a guest. */
const renderLogLine = (email: string, booking: BookingRecord) =>
  [
    '📧 Booking confirmation queued',
    `   to:        ${email}`,
    `   booking:   ${booking.id}`,
    `   guest:     ${formatGuestName(booking)}`,
    `   hotel:     ${booking.hotelName}`,
    `   rooms:     ${booking.roomTypes.join(', ')}`,
    `   stay:      ${formatStayDates(booking.startDate, booking.endDate, booking.nights)}`,
    `   paid:      ${CURRENCY} ${booking.pricePaid.toFixed(2)}`,
  ].join('\n');

/**
 * Sequence diagram step 9: sendConfirmation(email, bookingDetails) → step 10.
 *
 * Sent only after the booking row exists, which under this schema also means
 * after the charge cleared — there is no unpaid booking to send a confirmation
 * for.
 *
 * This function must never reject. By the time it runs the card is charged and
 * the row is committed; a throw here would report a completed booking as a
 * failed request and send the guest back to pay again. A failed email is a
 * `delivered: false` receipt, not an error.
 */
export const sendConfirmation = async (
  email: string,
  bookingDetails: BookingRecord
): Promise<DeliveryReceipt> => {
  try {
    if (isConfigured()) {
      const message = renderCustomerMessage(bookingDetails);
      const response = await axios.post<{ id: string }>(
        RESEND_URL,
        {
          from: process.env.EMAIL_FROM,
          to: [email],
          subject: message.subject,
          text: message.text,
        },
        {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          timeout: SEND_TIMEOUT_MS,
        }
      );
      return { delivered: true, messageId: response.data.id };
    }

    console.log(renderLogLine(email, bookingDetails));
    return { delivered: true, messageId: `log_${bookingDetails.id}` };
  } catch (error: any) {
    // Confirmation email is not allowed to sink a paid booking — the money is
    // already taken and the row is already committed by this point.
    return { delivered: false, errorMessage: error?.message ?? 'Email delivery failed' };
  }
};
