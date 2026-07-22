import type { BookingRecord } from '../models/bookingModel.js';

/**
 * EmailService — the «External API» box from the UC4 class diagram.
 *
 * No mail transport is installed, and the README's lockfile mandate rules out
 * adding one on a feature branch, so delivery is logged rather than sent. The
 * signature and return shape are the real ones, so dropping in a provider later
 * is a change to this file only.
 */

export interface DeliveryReceipt {
  delivered: boolean;
  messageId?: string;
  errorMessage?: string;
}

const formatStayDates = (checkIn: string, checkOut: string) => `${checkIn} → ${checkOut}`;

/** Sequence diagram step 9: sendConfirmation(email, bookingDetails) → step 10 */
export const sendConfirmation = async (
  email: string,
  bookingDetails: BookingRecord
): Promise<DeliveryReceipt> => {
  try {
    // TODO: swap for a real transport (Resend / SendGrid / Supabase SMTP).
    console.log(
      [
        '📧 Booking confirmation queued',
        `   to:        ${email}`,
        `   reference: ${bookingDetails.bookingReference}`,
        `   stay:      ${formatStayDates(bookingDetails.checkIn, bookingDetails.checkOut)}`,
        `   total:     ${bookingDetails.totalPrice.toFixed(2)}`,
      ].join('\n')
    );

    return { delivered: true, messageId: `log_${bookingDetails.bookingReference}` };
  } catch (error: any) {
    // Confirmation email is not allowed to sink a paid booking — the record is
    // already committed by this point in the sequence.
    return { delivered: false, errorMessage: error?.message ?? 'Email delivery failed' };
  }
};
