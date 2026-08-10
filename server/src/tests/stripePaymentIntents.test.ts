// Must precede the paymentService import: it reads STRIPE_SECRET_KEY at module
// scope, and ESM evaluates imports in declaration order.
import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import {
  createPaymentIntent,
  verifyPaymentIntent,
  toSafeError,
} from '../services/paymentService.js';
import {
  STRIPE_API,
  useStripeNock,
  withLiveStripe,
  expectAllMocksUsed,
  withSilencedErrorLog,
  cardPaymentMethod,
  retrievedPaymentIntent,
  stripeError,
} from './helpers/stripeNock.js';

/** The Elements / PaymentIntent path over the live SDK, with nock standing in for Stripe — the counterpart of stripePayments.test.ts, which does the same for hosted Checkout Sessions. */

const METADATA = {
  guest: JSON.stringify({
    salutation: 'Ms',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
  }),
  stay: JSON.stringify({
    destinationId: 'RsBU',
    hotelId: 'marina-bay',
    hotelName: 'Marina Bay Sands',
    roomTypes: ['deluxe-king'],
    startDate: '2026-08-01',
    endDate: '2026-08-04',
    adults: 2,
    children: 0,
  }),
};

const BASE_INPUT = {
  amount: 784.8,
  currency: 'SGD',
  guestEmail: 'jane@example.com',
  description: 'Marina Bay Sands · 3 nights · deluxe-king',
  metadata: METADATA,
};

/** Stripe receives form-encoded bodies; decode so assertions read naturally. */
const decodeForm = (body: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(body).entries());

describe('Stripe PaymentIntents (live SDK path via nock)', () => {
  useStripeNock();

  describe('createPaymentIntent', () => {
    it('sends the amount in minor units, never the major-unit figure', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_created' }));

      await withLiveStripe(() => createPaymentIntent(BASE_INPUT));

      // 784.80 SGD must arrive as 78480, not 784.8
      expect(received.amount).to.equal('78480');
      expect(received.currency).to.equal('sgd');
      expectAllMocksUsed();
    });

    it('does not scale a zero-decimal currency', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_jpy', currency: 'jpy', amount: 12000 }));

      await withLiveStripe(() =>
        createPaymentIntent({ ...BASE_INPUT, amount: 12000, currency: 'JPY' })
      );

      // 12000 JPY is 12000 minor units. Multiplying by 100 would charge 100x.
      expect(received.amount).to.equal('12000');
      expect(received.currency).to.equal('jpy');
    });

    /** Hardcoding `payment_method_types[0]=card` silently drops every wallet the dashboard has enabled, and the customer just sees fewer options with no error anywhere. */
    it('enables automatic payment methods on the wire', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_apm' }));

      await withLiveStripe(() => createPaymentIntent(BASE_INPUT));

      expect(received['automatic_payment_methods[enabled]']).to.equal('true');
      expect(received.payment_method_types).to.equal(undefined);
      expect(received['payment_method_types[0]']).to.equal(undefined);
    });

    /** Nothing is written before payment, so this metadata is the only record of what the customer asked for. */
    it('carries the guest and stay out in the intent metadata', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_meta' }));

      await withLiveStripe(() => createPaymentIntent(BASE_INPUT));

      expect(received['metadata[guest]']).to.equal(METADATA.guest);
      expect(received['metadata[stay]']).to.equal(METADATA.stay);
      expect(received.receipt_email).to.equal('jane@example.com');
      expect(received.description).to.equal('Marina Bay Sands · 3 nights · deluxe-king');
    });

    it('builds the amount from its own argument, with no way for a body to reach it', async () => {
      // The amount is assembled from server-side state. There is no path from a
      // request body to it, and this is where that stops being a claim about the
      // controller and becomes one about the wire.
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/payment_intents', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_onlyamount' }));

      await withLiveStripe(() => createPaymentIntent(BASE_INPUT));

      const amountKeys = Object.keys(received).filter((key) => key.includes('amount'));
      expect(amountKeys).to.deep.equal(['amount']);
    });

    it('returns the id and client secret Stripe issued, not ones we construct', async () => {
      nock(STRIPE_API)
        .post('/v1/payment_intents')
        .reply(
          200,
          retrievedPaymentIntent({ id: 'pi_live_1', clientSecret: 'pi_live_1_secret_xyz' })
        );

      const result = await withLiveStripe(() => createPaymentIntent(BASE_INPUT));

      expect(result.paymentIntentId).to.equal('pi_live_1');
      expect(result.clientSecret).to.equal('pi_live_1_secret_xyz');
    });

    /** Elements cannot mount without a client secret. */
    it('throws rather than handing the browser an intent it cannot confirm', async () => {
      nock(STRIPE_API)
        .post('/v1/payment_intents')
        .reply(200, retrievedPaymentIntent({ id: 'pi_nosecret', clientSecret: null }));

      let caught: Error | null = null;
      await withLiveStripe(async () => {
        try {
          await createPaymentIntent(BASE_INPUT);
        } catch (error) {
          caught = error as Error;
        }
      });

      expect(caught).to.be.instanceOf(Error);
      expect((caught as unknown as Error).message).to.contain('without a client secret');
    });

    it('withholds detail from a Stripe authentication failure', async () => {
      nock(STRIPE_API)
        .post('/v1/payment_intents')
        .reply(
          401,
          stripeError({
            type: 'authentication_error',
            message: 'No such key: sk_test_51H8xQ2****',
          })
        );

      const safe = await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await createPaymentIntent(BASE_INPUT);
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      // A misconfiguration must never render our key prefix into the payment page.
      expect(safe.message).to.not.contain('sk_test');
      expect(safe.correlationId).to.be.a('string');
    });

    it('surfaces a declined card as a safe message with no Stripe wording', async () => {
      nock(STRIPE_API)
        .post('/v1/payment_intents')
        .reply(
          402,
          stripeError({
            type: 'card_error',
            code: 'card_declined',
            declineCode: 'insufficient_funds',
            message: 'Your card has insufficient funds.',
          })
        );

      const safe = await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await createPaymentIntent(BASE_INPUT);
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      expect(safe.message).to.equal('Your card has insufficient funds.');
      expect(safe.correlationId).to.equal(undefined);
    });
  });

  describe('verifyPaymentIntent', () => {
    /** card_brand, card_last4, card_exp_month and card_exp_year are all NOT NULL, and the payment method is a separate object an unexpanded retrieve returns as a bare id string. */
    it('asks Stripe to expand the payment method, or the card columns arrive empty', async () => {
      let expandParam: string | null = null;

      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_expand')
        .query((query) => {
          expandParam = (query['expand[0]'] as string) ?? null;
          return true;
        })
        .reply(200, retrievedPaymentIntent({ id: 'pi_expand' }));

      await withLiveStripe(() => verifyPaymentIntent('pi_expand'));

      expect(expandParam).to.equal('payment_method');
    });

    it('reports a succeeded intent with everything the row needs', async () => {
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_paid')
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({ id: 'pi_paid', amount: 78480, metadata: METADATA })
        );

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_paid'));

      expect(result.paid).to.equal(true);
      expect(result.paymentIntentId).to.equal('pi_paid');
      expect(result.amountTotal).to.equal(78480);
      expect(result.currency).to.equal('sgd');
      expect(result.metadata).to.deep.equal(METADATA);
      expect(result.card).to.deep.equal({
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      });
    });

    it('reads the card brand, last four and expiry off the expanded payment method', async () => {
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_card')
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id: 'pi_card',
            paymentMethod: cardPaymentMethod({
              brand: 'mastercard',
              last4: '4444',
              expMonth: 7,
              expYear: 2029,
            }),
          })
        );

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_card'));

      expect(result.card).to.deep.equal({
        brand: 'mastercard',
        last4: '4444',
        expMonth: 7,
        expYear: 2029,
      });
    });

    it('reports no card at all rather than a half-built one', async () => {
      // A wallet or a bank transfer has no card, and an unexpanded response is a
      // bare id string. Both must read as null so the caller can substitute its
      // own placeholder rather than storing empty strings that look like a card.
      for (const paymentMethod of ['pm_test_bare', null]) {
        const id = paymentMethod === null ? 'pi_nopm' : 'pi_barepm';

        nock(STRIPE_API)
          .get(`/v1/payment_intents/${id}`)
          .query(true)
          .reply(200, retrievedPaymentIntent({ id, paymentMethod }));

        const result = await withLiveStripe(() => verifyPaymentIntent(id));

        expect(result.card, String(paymentMethod)).to.equal(null);
      }
    });

    it('prefers the amount actually received over the amount authorised', async () => {
      // A partially captured intent has already moved less money than it asked
      // for; recording the authorisation would fail the cross-check downstream
      // against a total nobody was charged.
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_partial')
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({ id: 'pi_partial', amount: 100000, amountReceived: 78480 })
        );

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_partial'));

      expect(result.amountTotal).to.equal(78480);
    });

    it('falls back to the authorised amount while amount_received is still zero', async () => {
      // Stripe reports amount_received: 0 until capture settles. `||` is what
      // makes that fall through to `amount`; `??` would record a charge of zero.
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_uncaptured')
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({ id: 'pi_uncaptured', amount: 78480, amountReceived: 0 })
        );

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_uncaptured'));

      expect(result.amountTotal).to.equal(78480);
    });

    it('falls back to the receipt email for payee_id on a guest payment', async () => {
      // payee_id is NOT NULL. No Customer is created for a guest, so `customer`
      // is null on every booking made without an account — the common case.
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_guest')
        .query(true)
        .reply(
          200,
          retrievedPaymentIntent({
            id: 'pi_guest',
            customer: null,
            receiptEmail: 'guest@example.com',
          })
        );

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_guest'));

      expect(result.payeeId).to.equal('guest@example.com');
    });

    it('prefers the Stripe Customer id when one exists, expanded or not', async () => {
      const cases: Array<{ id: string; customer: string | Record<string, unknown> }> = [
        { id: 'pi_cust_str', customer: 'cus_test_123' },
        { id: 'pi_cust_obj', customer: { id: 'cus_test_123', object: 'customer' } },
      ];

      for (const { id, customer } of cases) {
        nock(STRIPE_API)
          .get(`/v1/payment_intents/${id}`)
          .query(true)
          .reply(200, retrievedPaymentIntent({ id, customer }));

        const result = await withLiveStripe(() => verifyPaymentIntent(id));

        expect(result.payeeId, id).to.equal('cus_test_123');
      }
    });

    it('reports every status other than succeeded as unpaid', async () => {
      // `status` is the only thing that says the money moved. Treating
      // requires_action or processing as paid would book an unpaid stay.
      const statuses = [
        'requires_payment_method',
        'requires_confirmation',
        'requires_action',
        'processing',
        'canceled',
      ] as const;

      for (const status of statuses) {
        const id = `pi_status_${status}`;

        nock(STRIPE_API)
          .get(`/v1/payment_intents/${id}`)
          .query(true)
          .reply(200, retrievedPaymentIntent({ id, status }));

        const result = await withLiveStripe(() => verifyPaymentIntent(id));

        expect(result.paid, status).to.equal(false);
      }
    });

    it('returns empty metadata rather than undefined when Stripe sends none', async () => {
      // recordPaidBooking reads this without a guard; undefined would throw
      // inside the handler instead of producing its 422.
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_nometa')
        .query(true)
        .reply(200, retrievedPaymentIntent({ id: 'pi_nometa', metadata: null }));

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_nometa'));

      expect(result.metadata).to.deep.equal({});
    });

    /** A PaymentIntent has no client_reference_id — the field exists on Checkout Sessions only. */
    it('produces the same VerifiedPayment shape a session does', async () => {
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_shape')
        .query(true)
        .reply(200, retrievedPaymentIntent({ id: 'pi_shape' }));

      const result = await withLiveStripe(() => verifyPaymentIntent('pi_shape'));

      expect(Object.keys(result).sort()).to.deep.equal([
        'amountTotal',
        'card',
        'clientReferenceId',
        'currency',
        'metadata',
        'paid',
        'payeeId',
        'paymentIntentId',
        // Provenance of this payment, not the process mode. postConfirmBooking
        // keys the demo-card allowance off it, so both verify functions must
        // report it or that guard silently reads undefined.
        'simulated',
      ]);
      expect(result.clientReferenceId).to.equal(null);
    });

    it('rejects on an unknown intent rather than reporting it unpaid', async () => {
      nock(STRIPE_API)
        .get('/v1/payment_intents/pi_missing')
        .query(true)
        .reply(
          404,
          stripeError({
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: 'No such payment_intent: pi_missing',
          })
        );

      let rejected = false;
      await withLiveStripe(async () => {
        try {
          await verifyPaymentIntent('pi_missing');
        } catch {
          // A forged id must not read as "not paid" — that is a different fact,
          // and postConfirmBooking answers them differently.
          rejected = true;
        }
      });

      expect(rejected).to.equal(true);
    });
  });

  describe('the simulator still short-circuits', () => {
    it('makes no HTTP request at all when PAYMENTS_MODE=simulate', async () => {
      // No interceptor registered, and net connect is disabled: any attempt to
      // reach Stripe here would throw rather than silently pass.
      const result = await createPaymentIntent(BASE_INPUT);

      expect(result.paymentIntentId).to.match(/^sim_pi_/);
      expect(result.clientSecret).to.contain(result.paymentIntentId);
      expect(nock.pendingMocks()).to.have.length(0);
    });

    it('mints a distinct id per intent, so one attempt cannot resolve another', async () => {
      const first = await createPaymentIntent(BASE_INPUT);
      const second = await createPaymentIntent(BASE_INPUT);

      expect(first.paymentIntentId).to.not.equal(second.paymentIntentId);
    });

    /** The simulator holds what it was handed so verifyPaymentIntent can give it back. */
    it('hands the intent metadata back after the browser confirms', async () => {
      const intent = await createPaymentIntent(BASE_INPUT);

      const verified = await verifyPaymentIntent(intent.paymentIntentId);

      expect(verified.paid).to.equal(true);
      expect(verified.paymentIntentId).to.equal(intent.paymentIntentId);
      expect(verified.amountTotal).to.equal(78480);
      expect(verified.currency).to.equal('sgd');
      expect(verified.payeeId).to.equal('jane@example.com');
      expect(verified.metadata).to.deep.equal(METADATA);
      expect(verified.card).to.deep.equal({
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      });
    });

    it('reports an intent it never issued as unpaid, with nothing to book from', async () => {
      // A forged sim id reaches here. It must not resolve to somebody else's
      // booking details, and being unpaid is what stops it becoming a row.
      const verified = await verifyPaymentIntent(
        'sim_pi_00000000-0000-4000-8000-000000000000'
      );

      expect(verified.paid).to.equal(false);
      expect(verified.metadata).to.deep.equal({});
      expect(verified.amountTotal).to.equal(null);
      expect(verified.card).to.equal(null);
    });
  });
});
