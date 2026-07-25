import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { app } from './setup.js';
import { findByPaymentId } from '../models/bookingModel.js';
import { resetRateLimits } from '../middleware/rateLimit.js';

/**
 * Webhook delivery end to end, with genuinely signed payloads.
 *
 * Signatures are produced by Stripe's own generateTestHeaderString against the
 * secret in ../env.ts, so these exercise the real constructEvent verification
 * rather than stubbing past it. That matters more than it used to: the handler
 * no longer flips a flag on an existing row, it *creates* the booking. An
 * anonymous POST that got past verification would mint paid reservations.
 *
 * The recovery path is the other half of this file. If the customer closes the
 * tab on Stripe's success page, or a 3DS challenge completes hours later, the
 * browser never calls /confirm and nothing has been persisted — the money is
 * captured and no record of the stay exists anywhere but Stripe. This handler
 * is the only thing that fixes that.
 */

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

/** Only used to sign fixtures; no network calls are made through it. */
const signer = new Stripe('sk_test_00000000000000000000000000', {
  apiVersion: '2026-06-24.dahlia',
});

const post = (payload: unknown, signature?: string) => {
  const body = JSON.stringify(payload);
  const header =
    signature ??
    signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });

  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', header)
    .send(body);
};

const envelope = (type: string, object: Record<string, unknown>) => ({
  id: `evt_test_${randomUUID()}`,
  object: 'event',
  type,
  api_version: '2026-06-24.dahlia',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  data: { object },
});

const sessionEvent = (params: {
  sessionId: string;
  paymentIntentId?: string | null;
  paymentStatus?: 'paid' | 'unpaid';
  type?: string;
}) =>
  envelope(params.type ?? 'checkout.session.completed', {
    id: params.sessionId,
    object: 'checkout.session',
    payment_status: params.paymentStatus ?? 'paid',
    payment_intent: params.paymentIntentId === undefined ? null : params.paymentIntentId,
    mode: 'payment',
    status: 'complete',
  });

const chargeRefundedEvent = (params: {
  paymentIntentId: string;
  refunded: boolean;
  amount?: number;
  amountRefunded?: number;
  refundId?: string;
}) =>
  envelope('charge.refunded', {
    id: 'ch_test_charge',
    object: 'charge',
    payment_intent: params.paymentIntentId,
    amount: params.amount ?? 78480,
    amount_refunded: params.amountRefunded ?? 78480,
    currency: 'sgd',
    refunded: params.refunded,
    refunds: {
      object: 'list',
      data: [{ id: params.refundId ?? 're_test_hook', object: 'refund' }],
    },
  });

const VALID_GUEST = {
  salutation: 'Ms',
  firstName: 'Jane',
  lastName: 'Tan',
  email: 'jane@example.com',
  phone: '+65 9123 4567',
};

const VALID_STAY = {
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 0,
};

/** A complete billing address. Required by the payment endpoints now that Stripe
 *  runs an AVS check against it, so every payment fixture has to carry one. */
const VALID_BILLING = {
  line1: '10 Bayfront Avenue',
  line2: '#12-34',
  city: 'Singapore',
  state: null,
  postalCode: '018956',
  country: 'SG',
};

/** Silences the confirmation-email and warning logs a passing run does not need. */
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
  }
};

/**
 * Opens a real checkout session so the simulator holds its metadata, exactly as
 * a customer arriving at the hosted page would. The ids are derived from the
 * per-attempt UUID the controller mints, so every test gets its own payment
 * intent — the in-memory store lives for the whole run, and a shared id lets
 * one test resolve another test's booking.
 */
const openCheckout = async (body: Record<string, unknown> = {}) => {
  const response = await request(app)
    .post('/api/bookings/payment')
    .send({ guestDetails: VALID_GUEST, stay: VALID_STAY, billingAddress: VALID_BILLING, ...body });

  expect(response.status, JSON.stringify(response.body)).to.equal(200);

  const sessionId = new URL(response.body.redirectUrl).searchParams.get('session_id') as string;
  const reference = sessionId.replace('sim_sess_', '');

  return { sessionId, paymentIntentId: `sim_pi_${reference}` };
};

describe('Stripe webhook delivery', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  /**
   * Verification is the entire access control on this endpoint. Everything
   * below it writes booking rows from an unauthenticated POST body.
   */
  describe('signature verification', () => {
    it('rejects a payload with no signature header at all', async () => {
      const response = await request(app)
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(sessionEvent({ sessionId: 'cs_unsigned' })));

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/signature/i);
    });

    it('rejects a payload signed with the wrong secret', async () => {
      const event = sessionEvent({ sessionId: 'cs_forged' });
      const forged = signer.webhooks.generateTestHeaderString({
        payload: JSON.stringify(event),
        secret: 'whsec_an_attackers_own_secret_000',
      });

      const response = await quietly(() => post(event, forged));

      expect(response.status).to.equal(400);
    });

    it('rejects a body altered after signing', async () => {
      const original = chargeRefundedEvent({ paymentIntentId: 'pi_hook_tamper', refunded: true });
      const signature = signer.webhooks.generateTestHeaderString({
        payload: JSON.stringify(original),
        secret: WEBHOOK_SECRET,
      });

      // Same signature, different bytes — exactly the tamper the check exists for.
      const tampered = { ...original, data: { object: { ...original.data.object, amount: 1 } } };
      const response = await quietly(() => post(tampered, signature));

      expect(response.status).to.equal(400);
    });

    it('rejects a garbage signature header', async () => {
      const response = await quietly(() =>
        post(sessionEvent({ sessionId: 'cs_garbage' }), 't=1,v1=deadbeef')
      );

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/signature/i);
    });

    /**
     * A missing secret is our fault, not the caller's. 503 keeps Stripe
     * retrying so the event survives until the config is fixed; a 400 here
     * would tell Stripe the event is bad and discard it permanently — and with
     * it, the only recovery path for a charge that has already been captured.
     */
    it('answers 503, not 400, when STRIPE_WEBHOOK_SECRET is missing', async () => {
      const previous = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;

      try {
        const response = await quietly(() =>
          post(sessionEvent({ sessionId: 'cs_unconfigured' }), 't=1,v1=deadbeef')
        );

        expect(response.status).to.equal(503);
        expect(response.body.error).to.match(/not configured/i);
      } finally {
        process.env.STRIPE_WEBHOOK_SECRET = previous;
      }
    });

    it('accepts a correctly signed payload', async () => {
      const response = await quietly(() =>
        post(chargeRefundedEvent({ paymentIntentId: 'pi_hook_signed', refunded: true }))
      );

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ received: true });
    });
  });

  /**
   * The recovery path, and the reason this handler exists at all. Without it a
   * customer who closes the tab on the success page has paid for a stay that
   * exists nowhere in our system.
   */
  describe('checkout.session.completed — recovery', () => {
    it('inserts the booking for a session the browser never confirmed', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      // Nothing has been written: /confirm was never called.
      expect(await findByPaymentId(paymentIntentId)).to.equal(null);

      const response = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));

      expect(response.status).to.equal(200);

      const booking = await findByPaymentId(paymentIntentId);
      expect(booking, 'the webhook did not recover the booking').to.not.equal(null);
      expect(booking?.pricePaid).to.equal(784.8);
      expect(booking?.hotelName).to.equal('Marina Bay Sands');
      expect(booking?.guest.email).to.equal('jane@example.com');
    });

    it('recovers a delayed payment through async_payment_succeeded too', async () => {
      // A bank-debit or 3DS payment can clear hours after the browser is gone,
      // and arrives as a different event type.
      const { sessionId, paymentIntentId } = await openCheckout();

      const response = await quietly(() =>
        post(
          sessionEvent({
            sessionId,
            paymentIntentId,
            type: 'checkout.session.async_payment_succeeded',
          })
        )
      );

      expect(response.status).to.equal(200);
      expect(await findByPaymentId(paymentIntentId)).to.not.equal(null);
    });

    it('writes the row the recovered booking needs, card columns included', async () => {
      const userId = randomUUID();
      const { sessionId, paymentIntentId } = await openCheckout({
        userId,
        guestDetails: { ...VALID_GUEST, specialRequests: 'Quiet room.' },
        stay: { ...VALID_STAY, roomTypes: ['deluxe-king', 'standard-queen'], children: 1 },
      });

      await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));

      const booking = await findByPaymentId(paymentIntentId);
      expect(booking?.userId).to.equal(userId);
      expect(booking?.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
      expect(booking?.children).to.equal(1);
      expect(booking?.specialRequests).to.equal('Quiet room.');
      expect(booking?.card.brand).to.equal('visa');
      expect(booking?.card.last4).to.equal('4242');
    });

    it('does nothing for a session that was never paid', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      const response = await quietly(() =>
        post(sessionEvent({ sessionId, paymentIntentId, paymentStatus: 'unpaid' }))
      );

      // An unpaid session is not a booking, and the table cannot hold one.
      expect(response.status).to.equal(200);
      expect(await findByPaymentId(paymentIntentId)).to.equal(null);
    });

    it('is idempotent across redelivery', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      const first = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));
      const second = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));
      const third = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));

      for (const response of [first, second, third]) {
        expect(response.status).to.equal(200);
      }

      // One charge, one row. insertOne dedupes on payment_id, and the
      // findByPaymentId short-circuit above it means the later deliveries never
      // even reach the insert.
      const booking = await findByPaymentId(paymentIntentId);
      expect(booking).to.not.equal(null);
    });

    /**
     * The race this whole design turns on: /confirm and the webhook both call
     * recordPaidBooking, and either may arrive first. Whichever writes the row
     * wins, and the loser must be a silent no-op — one booking, and one email.
     */
    it('does not duplicate a booking the browser already confirmed', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      const confirmed = await quietly(() =>
        request(app).post('/api/bookings/confirm').send({ sessionId })
      );
      expect(confirmed.status).to.equal(200);

      const response = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));

      expect(response.status).to.equal(200);
      const booking = await findByPaymentId(paymentIntentId);
      expect(booking?.id).to.equal(confirmed.body.booking.id);
    });

    it('emails the guest exactly once even when both paths run', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      const log = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        await request(app).post('/api/bookings/confirm').send({ sessionId });
        await post(sessionEvent({ sessionId, paymentIntentId }));
      } finally {
        console.log = log;
      }

      const emails = lines.filter((line) => line.includes('Booking confirmation queued'));
      expect(emails).to.have.lengthOf(1);
    });

    it('acknowledges a charge it can never book rather than retrying forever', async () => {
      // A session the simulator never issued carries no metadata, so there is
      // nothing to book. That will be just as unbookable on every redelivery,
      // so the handler acknowledges and escalates instead of asking Stripe to
      // keep sending it. The customer has paid and has no booking: that is a
      // manual-intervention case, not a retry.
      const sessionId = `sim_sess_${randomUUID()}`;
      const paymentIntentId = `sim_pi_${sessionId.replace('sim_sess_', '')}`;

      const response = await quietly(() => post(sessionEvent({ sessionId, paymentIntentId })));

      expect(response.status).to.equal(200);
      expect(await findByPaymentId(paymentIntentId)).to.equal(null);
    });

    it('asks Stripe to retry when the fault is transient', async function () {
      // Re-reading the session is what fetches the NOT NULL card columns, so a
      // Stripe outage there must not be acknowledged — a 200 would discard the
      // event and strand the charge. The SDK retries a refused connection
      // twice before giving up, which outruns the default timeout.
      this.timeout(15_000);

      const response = await quietly(() =>
        post(sessionEvent({ sessionId: 'cs_live_unreachable', paymentIntentId: 'pi_unreachable' }))
      );

      expect(response.status).to.equal(500);
    });
  });

  describe('sessions that ended without payment', () => {
    it('acknowledges an expired checkout without writing anything', async () => {
      // There is no status column to mark failed and no row was ever written,
      // so an abandoned checkout leaves no trace by design — the absence of a
      // booking is the record of the failure.
      const { sessionId, paymentIntentId } = await openCheckout();

      const response = await quietly(() =>
        post(sessionEvent({ sessionId, paymentIntentId, type: 'checkout.session.expired' }))
      );

      expect(response.status).to.equal(200);
      expect(await findByPaymentId(paymentIntentId)).to.equal(null);
    });

    it('acknowledges a failed async payment without writing anything', async () => {
      const { sessionId, paymentIntentId } = await openCheckout();

      const response = await quietly(() =>
        post(
          sessionEvent({
            sessionId,
            paymentIntentId,
            type: 'checkout.session.async_payment_failed',
          })
        )
      );

      expect(response.status).to.equal(200);
      expect(await findByPaymentId(paymentIntentId)).to.equal(null);
    });
  });

  describe('charge.refunded', () => {
    it('acknowledges a refund for a booking we hold, and changes nothing', async () => {
      // RECONCILIATION GAP: the schema has no refund_id, no refunded_at and no
      // status, so there is nowhere to put this. The booking goes on reading as
      // fully paid however much money went back. Asserted rather than assumed,
      // so adding the column later breaks this test instead of slipping by.
      const { sessionId, paymentIntentId } = await openCheckout();
      await quietly(() => request(app).post('/api/bookings/confirm').send({ sessionId }));

      const response = await quietly(() =>
        post(chargeRefundedEvent({ paymentIntentId, refunded: true, refundId: 're_test_full' }))
      );

      expect(response.status).to.equal(200);

      const booking = await findByPaymentId(paymentIntentId);
      expect(booking?.pricePaid).to.equal(784.8);
      expect(booking).to.not.have.property('refundId');
    });

    it('acknowledges a refund for an intent we have never seen', async () => {
      // 200 stops Stripe redelivering an event we can never reconcile; the
      // handler logs it so the divergence is still visible.
      const response = await quietly(() =>
        post(chargeRefundedEvent({ paymentIntentId: `pi_never_seen_${randomUUID()}`, refunded: true }))
      );

      expect(response.status).to.equal(200);
    });

    it('acknowledges a partial refund the same way', async () => {
      const response = await quietly(() =>
        post(
          chargeRefundedEvent({
            paymentIntentId: `pi_partial_${randomUUID()}`,
            refunded: false, // Stripe sets this only once the charge is fully refunded
            amountRefunded: 20000,
          })
        )
      );

      expect(response.status).to.equal(200);
    });
  });

  describe('event types the handler does not act on', () => {
    it('acknowledges them so Stripe stops retrying', async () => {
      const response = await quietly(() =>
        post(envelope('payment_intent.created', { id: 'pi_ignored', object: 'payment_intent' }))
      );

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal({ received: true });
    });
  });
});
