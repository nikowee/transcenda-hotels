// Must precede the paymentService import — see the note in stripePayments.test.ts.
import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import { randomUUID } from 'crypto';
import { refundPayment, toSafeError } from '../services/paymentService.js';
import { insertOne, findByPaymentId } from '../models/bookingModel.js';
import type { BookingInput } from '../models/bookingTypes.js';
import {
  STRIPE_API,
  useStripeNock,
  withLiveStripe,
  expectAllMocksUsed,
  withSilencedErrorLog,
  refund as refundFixture,
  stripeError,
} from './helpers/stripeNock.js';

/** Stripe refunds over the live SDK path, and what a refund does — and does not — do to our own records. */

const decodeForm = (body: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(body).entries());

const PAID_INTENT = 'pi_test_refundme';

describe('Stripe refunds (live SDK path via nock)', () => {
  useStripeNock();

  describe('refundPayment', () => {
    it('refunds the full captured total by omitting the amount', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/refunds', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, refundFixture({ paymentIntentId: PAID_INTENT }));

      await withLiveStripe(() => refundPayment({ paymentIntentId: PAID_INTENT }));

      expect(received.payment_intent).to.equal(PAID_INTENT);
      // Sending no amount is what makes a full refund exact. A locally computed
      // "full" figure can drift from what Stripe actually captured.
      expect(received.amount).to.equal(undefined);
      expectAllMocksUsed();
    });

    it('converts a partial refund amount to minor units', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/refunds', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, refundFixture({ amount: 20000, paymentIntentId: PAID_INTENT }));

      await withLiveStripe(() =>
        refundPayment({ paymentIntentId: PAID_INTENT, amount: 200, currency: 'SGD' })
      );

      expect(received.amount).to.equal('20000');
    });

    it('does not scale a zero-decimal currency on refund either', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/refunds', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, refundFixture({ amount: 12000, currency: 'jpy' }));

      await withLiveStripe(() =>
        refundPayment({ paymentIntentId: PAID_INTENT, amount: 12000, currency: 'JPY' })
      );

      // Refunding 100x what was captured is the mirror of overcharging by 100x.
      expect(received.amount).to.equal('12000');
    });

    it('sends an idempotency key so a retry cannot refund twice', async () => {
      let idempotencyKey: string | undefined;

      nock(STRIPE_API)
        .post('/v1/refunds')
        .reply(function () {
          idempotencyKey = this.req.headers['idempotency-key'] as string | undefined;
          return [200, refundFixture({ paymentIntentId: PAID_INTENT })];
        });

      await withLiveStripe(() => refundPayment({ paymentIntentId: PAID_INTENT }));

      // Derived from the intent, so the same refund request always reuses it.
      expect(idempotencyKey).to.equal(`refund_${PAID_INTENT}`);
    });

    it('forwards a refund reason when one is given', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/refunds', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, refundFixture());

      await withLiveStripe(() =>
        refundPayment({ paymentIntentId: PAID_INTENT, reason: 'requested_by_customer' })
      );

      expect(received.reason).to.equal('requested_by_customer');
    });

    it('reports the amount Stripe refunded, not the amount we asked for', async () => {
      nock(STRIPE_API)
        .post('/v1/refunds')
        .reply(200, refundFixture({ id: 're_test_actual', amount: 78480, status: 'succeeded' }));

      const result = await withLiveStripe(() =>
        // Ask for 900; Stripe caps at what was captured.
        refundPayment({ paymentIntentId: PAID_INTENT, amount: 900, currency: 'SGD' })
      );

      expect(result.refundId).to.equal('re_test_actual');
      expect(result.amountRefunded).to.equal(78480);
      expect(result.status).to.equal('succeeded');
      expect(result.currency).to.equal('sgd');
    });

    it('surfaces a pending refund as pending rather than succeeded', async () => {
      nock(STRIPE_API).post('/v1/refunds').reply(200, refundFixture({ status: 'pending' }));

      const result = await withLiveStripe(() => refundPayment({ paymentIntentId: PAID_INTENT }));

      // Money has not moved yet; treating this as succeeded would tell a guest
      // they have been refunded when they have not.
      expect(result.status).to.equal('pending');
    });

    it('withholds Stripe detail when a charge has already been refunded', async () => {
      nock(STRIPE_API)
        .post('/v1/refunds')
        .reply(
          400,
          stripeError({
            type: 'invalid_request_error',
            code: 'charge_already_refunded',
            message: 'Charge ch_123 has already been refunded.',
          })
        );

      const safe = await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await refundPayment({ paymentIntentId: PAID_INTENT });
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      expect(safe.message).to.not.contain('ch_123');
      expect(safe.message).to.not.contain('sk_test');
      expect(safe.correlationId).to.be.a('string');
    });

    it('short-circuits without any HTTP call when simulating', async () => {
      const result = await refundPayment({ paymentIntentId: PAID_INTENT });

      expect(result.refundId).to.equal(`sim_re_${PAID_INTENT}`);
      expect(result.status).to.equal('succeeded');
      expect(nock.pendingMocks()).to.have.length(0);
    });
  });

  /** The reconciliation gap, pinned as a test rather than left as a comment. */
  describe('what a refund leaves behind in our own records', () => {
    const bookingInput = (): BookingInput => ({
      userId: null,
      billing: null,
      guest: {
        salutation: 'Ms',
        firstName: 'Jane',
        lastName: 'Tan',
        email: 'jane@example.com',
        phone: '+65 9123 4567',
        specialRequests: null,
      },
      stay: {
        destinationId: 'RsBU',
        hotelId: 'marina-bay',
        hotelName: 'Marina Bay Sands',
        roomTypes: ['deluxe-king'],
        startDate: '2026-08-01',
        endDate: '2026-08-04',
        adults: 2,
        children: 0,
      },
      nights: 3,
      pricePaid: 784.8,
      // Unique per call: the in-memory store outlives the file, so a shared id
      // would let one test resolve another's booking.
      paymentId: `pi_refund_${randomUUID()}`,
      payeeId: 'cus_test_refund',
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
    });

    it('leaves the booking reading as fully paid, because there is no column for it', async () => {
      const booking = await insertOne(bookingInput());

      const result = await refundPayment({ paymentIntentId: booking.paymentId });
      expect(result.status).to.equal('succeeded');

      const stored = await findByPaymentId(booking.paymentId);
      expect(stored?.pricePaid).to.equal(784.8);
      expect(stored).to.not.have.property('refundId');
      expect(stored).to.not.have.property('paymentStatus');
    });

    it('keeps the payment intent as the only handle tying the two systems together', async () => {
      // A Stripe Charge carries no booking reference — there is no such column
      // any more — so payment_id is the whole join key for reconciliation.
      const booking = await insertOne(bookingInput());

      expect((await findByPaymentId(booking.paymentId))?.id).to.equal(booking.id);
      expect(await findByPaymentId(`pi_refund_${randomUUID()}`)).to.equal(null);
    });
  });
});