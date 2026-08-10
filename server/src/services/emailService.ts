import type { BookingRecord } from '../models/bookingTypes.js';

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
    return { delivered: false, errorMessage: error?.message ?? 'Email delivery failed' };
  }
};
