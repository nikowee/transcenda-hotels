import axios from 'axios';
import type { BookingRecord } from '../models/bookingTypes.js';

/**
 * EmailService — the «External API» box from the UC4 class diagram.
 *
 * Both env vars set → Resend delivery; either absent → log-only (dev, compose
 * and the test suite). Plain axios, not the resend SDK — one POST, no new
 * dependency. Env read per call like isSimulated(). Keep the vars unset
 * outside production: E2E books @example.com addresses, which hard-bounce.
 */

export interface DeliveryReceipt {
  delivered: boolean;
  messageId?: string;
  errorMessage?: string;
}

/** The platform prices in SGD; the bookings table stores no currency column. */
const CURRENCY = 'SGD';

const RESEND_URL = 'https://api.resend.com/emails';

/** Half the SIGTERM drain window, never equal: a send racing shutdown must lose to the drain. */
const SEND_TIMEOUT_MS = 5_000;

const formatStayDates = (startDate: string, endDate: string, nights: number) =>
  `${startDate} → ${endDate} (${nights} night${nights === 1 ? '' : 's'})`;

const formatGuestName = (booking: BookingRecord) =>
  `${booking.guest.salutation} ${booking.guest.firstName} ${booking.guest.lastName}`;

const isConfigured = (): boolean =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

/** Guest-facing. The booking id leads — it is the guest's only support handle. */
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
 * Sequence diagram steps 9→10. Runs only after the row exists, hence after the
 * charge cleared. Never rejects — a throw would report a paid booking as a
 * failed request; failure is a delivered:false receipt.
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
      // The Resend id is the only handle for tracing a delivery; the caller
      // discards the receipt on success, so the log is the record.
      console.log(
        `📧 Confirmation sent — booking ${bookingDetails.id} → ${email} (resend ${response.data.id})`
      );
      return { delivered: true, messageId: response.data.id };
    }

    console.log(renderLogLine(email, bookingDetails));
    return { delivered: true, messageId: `log_${bookingDetails.id}` };
  } catch (error: any) {
    // Resend puts the actionable cause in the response body; axios's own
    // message is just the status code.
    const providerDetail = error?.response?.data?.message;
    const errorMessage =
      (providerDetail ? `${error.message}: ${providerDetail}` : error?.message) ??
      'Email delivery failed';
    return { delivered: false, errorMessage };
  }
};
