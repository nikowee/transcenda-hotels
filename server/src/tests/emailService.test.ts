import { describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import { sendConfirmation } from '../services/emailService.js';
import type { BookingRecord } from '../models/bookingTypes.js';

/** EmailService — the last step of a paid booking, and until now the only production module with no suite of its own. */

const BOOKING: BookingRecord = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  userId: null,
  destinationId: 'WD0M',
  hotelId: 'diH7',
  hotelName: 'The Fullerton Hotel Singapore',
  roomTypes: ['deluxe-king', 'standard-queen'],
  startDate: '2026-10-01',
  endDate: '2026-10-04',
  nights: 3,
  adults: 2,
  children: 1,
  specialRequests: null,
  guest: {
    salutation: 'Dr',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
    specialRequests: null,
  },
  billing: null,
  pricePaid: 1990.49,
  paymentId: 'pi_test_abc',
  payeeId: 'jane@example.com',
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  createdAt: '2026-07-26T00:00:00.000Z',
};

/** Captures the delivery so its contents can be asserted rather than assumed. */
const capture = async (
  booking: BookingRecord = BOOKING,
  email = booking.guest.email
): Promise<{ receipt: Awaited<ReturnType<typeof sendConfirmation>>; output: string }> => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    const receipt = await sendConfirmation(email, booking);
    return { receipt, output: lines.join('\n') };
  } finally {
    console.log = original;
  }
};

describe('emailService', () => {
  it('reports delivery with a message id tied to the booking', async () => {
    const { receipt } = await capture();

    expect(receipt.delivered).to.equal(true);
    expect(receipt.messageId).to.contain(BOOKING.id);
    expect(receipt.errorMessage).to.equal(undefined);
  });

  /** The booking id is the guest's only handle — booking_reference does not exist in this schema — so a confirmation that omits it is unusable for support. */
  it('carries everything the guest needs to identify the stay', async () => {
    const { output } = await capture();

    expect(output).to.contain(BOOKING.id);
    expect(output).to.contain('jane@example.com');
    expect(output).to.contain('Dr Jane Tan');
    expect(output).to.contain('The Fullerton Hotel Singapore');
    expect(output).to.contain('2026-10-01 → 2026-10-04');
    expect(output).to.contain('3 nights');
    expect(output).to.contain('deluxe-king, standard-queen');
  });

  /** Money is printed to two places: 1990.5 on a receipt reads as wrong. */
  it('formats the amount to two decimal places', async () => {
    const { output } = await capture({ ...BOOKING, pricePaid: 1990.5 });
    expect(output).to.contain('SGD 1990.50');
  });

  it('says "1 night" rather than "1 nights"', async () => {
    const { output } = await capture({ ...BOOKING, nights: 1 });
    expect(output).to.contain('(1 night)');
    expect(output).to.not.contain('1 nights');
  });

  /** Sent to the address asked for, not the one on the booking. */
  it('sends to the address it was given', async () => {
    const { output } = await capture(BOOKING, 'someone.else@example.com');
    expect(output).to.contain('someone.else@example.com');
  });

  /** The contract recordPaidBooking relies on. */
  it('never rejects, even when the booking is malformed', async () => {
    const broken = { ...BOOKING, guest: undefined, roomTypes: undefined } as unknown as BookingRecord;

    // Email passed explicitly: capture()'s `email = booking.guest.email`
    // default would itself throw on this fixture, and the test would then be
    // asserting against the helper rather than against sendConfirmation.
    const receipt = await capture(broken, 'jane@example.com')
      .then((r) => r.receipt)
      .catch(() => null);

    expect(receipt, 'sendConfirmation must resolve, never reject').to.not.equal(null);
    expect(receipt?.delivered).to.equal(false);
    expect(receipt?.errorMessage).to.be.a('string');
  });

  /** The log path must be the only path: delivery that touched the network would leak bookings to a provider nobody opted into. */
  it('makes no HTTP request at all', async () => {
    const scope = nock('https://api.resend.com').post('/emails').reply(200, { id: 'nope' });

    const { receipt } = await capture();

    expect(receipt.delivered).to.equal(true);
    expect(receipt.messageId).to.contain('log_');
    expect(scope.isDone(), 'no request may leave the process').to.equal(false);
  });
});
