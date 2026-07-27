import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { randomUUID } from 'crypto';
import { recordPaidBooking, CURRENCY } from '../controllers/bookingController.js';
import { findByPaymentId } from '../models/bookingModel.js';
import type { VerifiedPayment } from '../services/paymentService.js';
import { withSilencedErrorLog } from './helpers/stripeNock.js';

/**
 * recordPaidBooking — the one place a captured charge becomes a booking row.
 *
 * Both /confirm and the webhook funnel through here, which is why it is tested
 * directly rather than only through them: the two callers must not be able to
 * drift, and half of what this function refuses is unreachable over HTTP
 * because the simulator would never produce it. A charge whose amount disagrees
 * with a re-priced quote, or whose metadata is unreadable, only arrives from a
 * tampered session or a Stripe-side change — and both are precisely the cases
 * that must not silently become a booking.
 *
 * Outcomes are returned rather than thrown, and `status` doubles as the retry
 * signal the webhook reads: 5xx is worth redelivering, 4xx never will be.
 */

const GUEST = {
  salutation: 'Ms',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
};

const STAY = {
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 0,
};

/** deluxe-king × 3 nights, +9% tax, in the minor units Stripe reports. */
const EXPECTED_MINOR = 78480;

/** Mirrors toSessionMetadata: the guest and stay travel as one JSON value each. */
const metadataFor = (
  overrides: { guest?: unknown; stay?: unknown; extras?: Record<string, string> } = {}
): Record<string, string> => ({
  guest: JSON.stringify(overrides.guest ?? GUEST),
  stay: JSON.stringify(overrides.stay ?? STAY),
  ...overrides.extras,
});

/**
 * Payment ids are derived from a per-call UUID. The in-memory store lives for
 * the whole run, so a shared id would let one test resolve another test's
 * booking — that has already caused a real failure once.
 */
const paymentFixture = (overrides: Partial<VerifiedPayment> = {}): VerifiedPayment => ({
  paid: true,
  paymentIntentId: `pi_record_${randomUUID()}`,
  amountTotal: EXPECTED_MINOR,
  currency: CURRENCY.toLowerCase(),
  payeeId: 'cus_test_record',
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  clientReferenceId: randomUUID(),
  metadata: metadataFor(),
  // Provenance, not mode. recordPaidBooking itself ignores this, but
  // postConfirmBooking keys the demo-card allowance off it, so the default here
  // is the safe one: a payment that did not come from the simulator.
  simulated: false,
  ...overrides,
});

/** Narrows the outcome union so assertions do not need casts. */
const mustSucceed = async (payment: VerifiedPayment) => {
  const outcome = await recordPaidBooking(payment);
  if (!outcome.ok) {
    throw new Error(`expected a booking, got ${outcome.status}: ${outcome.error}`);
  }
  return outcome.booking;
};

const mustFail = async (payment: VerifiedPayment) => {
  const outcome = await withSilencedErrorLog(() => recordPaidBooking(payment));
  if (outcome.ok) {
    throw new Error(`expected a refusal, got booking ${outcome.booking.id}`);
  }
  return outcome;
};

/** The confirmation email logs a line per booking; silence it as noise. */
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
};

describe('recordPaidBooking', () => {
  describe('a cleared charge', () => {
    it('writes the booking from the quote, not from anything that travelled', async () => {
      const payment = paymentFixture();

      const booking = await quietly(() => mustSucceed(payment));

      expect(booking.paymentId).to.equal(payment.paymentIntentId);
      expect(booking.pricePaid).to.equal(784.8);
      expect(booking.nights).to.equal(3);
      expect(booking.roomTypes).to.deep.equal(['deluxe-king']);
      expect(booking.payeeId).to.equal('cus_test_record');
      expect(booking.card).to.deep.equal({
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      });
    });

    it('carries specialRequests and userId out of the metadata', async () => {
      const userId = randomUUID();
      const payment = paymentFixture({
        metadata: metadataFor({
          extras: { specialRequests: 'Cot for the baby, please.', userId },
        }),
      });

      const booking = await quietly(() => mustSucceed(payment));

      expect(booking.specialRequests).to.equal('Cot for the baby, please.');
      expect(booking.userId).to.equal(userId);
    });

    it('falls back to the payer email when a guest checkout has no Customer', async () => {
      // payee_id is NOT NULL and a guest checkout produces no Stripe Customer,
      // so refusing here would leave a captured charge with no booking.
      const payment = paymentFixture({ payeeId: null });

      const booking = await quietly(() => mustSucceed(payment));

      expect(booking.payeeId).to.equal('jane@example.com');
    });

    it('records an unknown card rather than refusing a non-card payment method', async () => {
      // The card columns are NOT NULL. A wallet or bank transfer reports no
      // card, and a row saying "unknown" is strictly better than a captured
      // charge with no booking at all.
      const payment = paymentFixture({ card: null });

      const booking = await quietly(() => mustSucceed(payment));

      expect(booking.card).to.deep.equal({
        brand: 'unknown',
        last4: '0000',
        expMonth: 0,
        expYear: 0,
      });
    });

    it('accepts a charge that reports no amount at all', async () => {
      // amount_total is nullable on a Checkout Session. Absent is not the same
      // as wrong, and refusing it would strand a real payment.
      const payment = paymentFixture({ amountTotal: null, currency: null });

      const booking = await quietly(() => mustSucceed(payment));

      expect(booking.pricePaid).to.equal(784.8);
    });
  });

  describe('the amount cross-check', () => {
    /**
     * The re-price is the last line of defence on price integrity. Everything
     * between the quote and the charge left our process, so the total is rebuilt
     * from the stay and compared against what Stripe actually captured — a
     * session whose amount was altered anywhere in between is refused here even
     * though the money cleared.
     */
    it('refuses a charge that disagrees with a re-priced quote', async () => {
      const outcome = await mustFail(paymentFixture({ amountTotal: 100 }));

      expect(outcome.status).to.equal(409);
      expect(outcome.error).to.match(/amount did not match/i);
    });

    it('refuses a charge that is too large as readily as one that is too small', async () => {
      const outcome = await mustFail(paymentFixture({ amountTotal: EXPECTED_MINOR * 100 }));

      expect(outcome.status).to.equal(409);
    });

    it('refuses a charge taken in the wrong currency', async () => {
      // A charge of 78480 minor units in JPY is not the same money as 78480 in
      // SGD, and the table stores no currency column to tell them apart later.
      const outcome = await mustFail(paymentFixture({ currency: 'jpy' }));

      expect(outcome.status).to.equal(409);
      expect(outcome.error).to.match(/currency did not match/i);
    });

    it('compares the currency case-insensitively', async () => {
      // Stripe reports lowercase, the quote is uppercase; a case-sensitive
      // comparison would refuse every single legitimate booking.
      const booking = await quietly(() => mustSucceed(paymentFixture({ currency: 'SGD' })));

      expect(booking.pricePaid).to.equal(784.8);
    });

    it('leaves no row behind when it refuses', async () => {
      const payment = paymentFixture({ amountTotal: 1 });

      await mustFail(payment);

      expect(await findByPaymentId(payment.paymentIntentId as string)).to.equal(null);
    });
  });

  describe('unusable metadata', () => {
    it('refuses a session carrying no booking details', async () => {
      // Nothing was written before payment, so metadata is the only record of
      // what was bought. Without it the charge cannot become a booking, and
      // guessing would be worse than escalating.
      const outcome = await mustFail(paymentFixture({ metadata: {} }));

      expect(outcome.status).to.equal(422);
      expect(outcome.error).to.match(/missing its booking details/i);
    });

    it('refuses metadata that is not valid JSON', async () => {
      const outcome = await mustFail(
        paymentFixture({ metadata: { guest: '{not json', stay: '{"also' } })
      );

      expect(outcome.status).to.equal(422);
    });

    it('refuses metadata whose JSON is not an object', async () => {
      const outcome = await mustFail(
        paymentFixture({ metadata: { guest: '"a string"', stay: 'null' } })
      );

      expect(outcome.status).to.equal(422);
    });

    it('refuses a stay that no longer prices, rather than inventing a total', async () => {
      // A room type withdrawn from the rate table between checkout and the
      // webhook lands here. There is no honest amount to write, so this is a
      // manual-intervention case, not a booking.
      const outcome = await mustFail(
        paymentFixture({ metadata: metadataFor({ stay: { ...STAY, roomTypes: ['gone'] } }) })
      );

      expect(outcome.status).to.equal(409);
      expect(outcome.error).to.match(/bookable stay/i);
    });

    it('refuses a stay whose occupancy is out of range', async () => {
      const outcome = await mustFail(
        paymentFixture({ metadata: metadataFor({ stay: { ...STAY, adults: 0 } }) })
      );

      expect(outcome.status).to.equal(409);
    });

    it('returns 4xx for every unusable case, so the webhook stops retrying', async () => {
      // Status is the webhook's retry signal. A permanent fault returned as 5xx
      // makes Stripe redeliver an event that can never succeed, burying the
      // charge in noise instead of escalating it once.
      const permanent = [
        paymentFixture({ metadata: {} }),
        paymentFixture({ metadata: { guest: 'x', stay: 'y' } }),
        paymentFixture({ amountTotal: 5 }),
        paymentFixture({ currency: 'usd' }),
      ];

      for (const payment of permanent) {
        const outcome = await mustFail(payment);
        expect(outcome.status, outcome.error).to.be.within(400, 499);
      }
    });
  });

  describe('a charge that is not usable as a key', () => {
    it('refuses a session that has not been paid', async () => {
      const outcome = await mustFail(paymentFixture({ paid: false }));

      expect(outcome.status).to.equal(402);
      expect(outcome.error).to.match(/not completed/i);
    });

    it('asks for a retry when a paid session carries no payment intent', async () => {
      // payment_id is the only reconciliation handle there is. Without one the
      // row could never be deduped, so this is refused — and as a 5xx, because
      // a later delivery may well carry the intent.
      const outcome = await mustFail(paymentFixture({ paymentIntentId: null }));

      expect(outcome.status).to.equal(502);
      expect(outcome.status).to.be.at.least(500);
    });
  });

  describe('repeat delivery', () => {
    /**
     * /confirm and the webhook race each other on every booking, and Stripe
     * redelivers events freely. Whichever arrives first writes the row; the
     * loser must be a no-op returning the same booking, not a second charge
     * record and not an error.
     */
    it('returns the existing booking rather than writing a second one', async () => {
      const payment = paymentFixture();

      const first = await quietly(() => mustSucceed(payment));
      const second = await quietly(() => mustSucceed(payment));
      const third = await quietly(() => mustSucceed({ ...payment, clientReferenceId: randomUUID() }));

      expect(second.id).to.equal(first.id);
      expect(third.id).to.equal(first.id);
    });

    it('short-circuits before the amount check, so a settled booking cannot be undone', async () => {
      // Once the row exists it is the record of what was charged. A redelivery
      // that disagrees about the amount must not be able to reject it.
      const payment = paymentFixture();
      const first = await quietly(() => mustSucceed(payment));

      const second = await quietly(() => mustSucceed({ ...payment, amountTotal: 1 }));

      expect(second.id).to.equal(first.id);
      expect(second.pricePaid).to.equal(784.8);
    });

    it('sends the confirmation email once when two deliveries arrive together', async () => {
      /**
       * The concurrent case, which the sequential test below cannot reach.
       *
       * The browser confirming while the webhook recovers is the exact race
       * writesInFlight exists for. Both callers pass the findByPaymentId
       * short-circuit, both call insertOne, and both are handed the *same*
       * record — so emailing from the return value emailed twice for one
       * booking. Only the caller that actually wrote the row may email.
       *
       * Verified failing before the fix (2 emails) and passing after (1).
       */
      const payment = paymentFixture();

      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        await Promise.all([
          recordPaidBooking(payment),
          recordPaidBooking(payment),
          recordPaidBooking(payment),
        ]);
      } finally {
        console.log = original;
      }

      const emails = lines.filter((line) => line.includes('Booking confirmation queued'));
      expect(emails).to.have.lengthOf(1);
    });

    it('sends the confirmation email once per booking, not once per delivery', async () => {
      // The findByPaymentId short-circuit is the whole guarantee here: both
      // callers reach this function, and only the one that writes the row gets
      // as far as sendConfirmation.
      const payment = paymentFixture();

      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        await recordPaidBooking(payment);
        await recordPaidBooking(payment);
        await recordPaidBooking(payment);
      } finally {
        console.log = original;
      }

      const emails = lines.filter((line) => line.includes('Booking confirmation queued'));
      expect(emails).to.have.lengthOf(1);
    });
  });
});
