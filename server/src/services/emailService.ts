import axios from 'axios';
import type { BookingRecord } from '../models/bookingTypes.js';

/**
 * EmailService — the «External API» box from the UC4 class diagram.
 *
 * Both env vars set → Resend; either absent → log-only. Plain axios, not the
 * SDK: one POST, no new dependency. Env read per call, like isSimulated().
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

/** Boot-time reporting; the pairing rule lives here, not in index.ts. */
export const emailConfigStatus = (): { mode: 'resend' | 'log-only'; missing?: string } => {
  if (isConfigured()) return { mode: 'resend' };
  if (process.env.RESEND_API_KEY) return { mode: 'log-only', missing: 'EMAIL_FROM' };
  if (process.env.EMAIL_FROM) return { mode: 'log-only', missing: 'RESEND_API_KEY' };
  return { mode: 'log-only' };
};

/** RFC 2606/6761 reserved domains: no real guest, guaranteed hard bounce. */
const RESERVED_RECIPIENT = /@(?:[^@\s]+\.)?(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;

/** In-flight sends, so shutdown can outwait them: the caller does not await, and server.close alone would kill one mid-POST. */
const pendingSends = new Set<Promise<unknown>>();
export const whenSendsSettled = async (): Promise<void> => {
  await Promise.allSettled([...pendingSends]);
};

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

/** Sequence steps 9→10, after the row exists and the charge cleared. Never rejects: a throw would report a paid booking as a failed request. */
export const sendConfirmation = async (
  email: string,
  bookingDetails: BookingRecord
): Promise<DeliveryReceipt> => {
  try {
    if (isConfigured() && !RESERVED_RECIPIENT.test(email)) {
      const message = renderCustomerMessage(bookingDetails);
      const send = axios.post<{ id: string }>(
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
      pendingSends.add(send);
      const response = await send.finally(() => pendingSends.delete(send));
      // The Resend id is the only trace handle, and the caller discards the receipt on success.
      console.log(
        `📧 Confirmation sent — booking ${bookingDetails.id} → ${email} (resend ${response.data.id})`
      );
      return { delivered: true, messageId: response.data.id };
    }

    console.log(renderLogLine(email, bookingDetails));
    return { delivered: true, messageId: `log_${bookingDetails.id}` };
  } catch (error: any) {
    // Resend puts the cause in the response body; axios's message is the status code alone.
    const providerDetail = error?.response?.data?.message;
    const errorMessage =
      (providerDetail ? `${error.message}: ${providerDetail}` : error?.message) ??
      'Email delivery failed';
    return { delivered: false, errorMessage };
  }
};
