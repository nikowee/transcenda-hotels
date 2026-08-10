// Must precede the paymentService import: it reads STRIPE_SECRET_KEY at module
// scope, and ESM evaluates imports in declaration order.
import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import { randomUUID } from 'crypto';
import {
  createCheckoutSession,
  verifySession,
  toSafeError,
} from '../services/paymentService.js';
import {
  STRIPE_API,
  useStripeNock,
  withLiveStripe,
  expectAllMocksUsed,
  withSilencedErrorLog,
  checkoutSession,
  paymentIntentWithCard,
  stripeError,
} from './helpers/stripeNock.js';

/** Stripe payments over the live SDK path, with nock standing in for the API. */

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
  clientReferenceId: 'ref_test_a1b2c3',
  amount: 784.8,
  currency: 'SGD',
  guestEmail: 'jane@example.com',
  description: 'Marina Bay Sands · 3 nights · deluxe-king',
  successUrl: 'http://localhost:3000/confirmation?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'http://localhost:3000/checkout?cancelled=1',
  metadata: METADATA,
};

/** Stripe receives form-encoded bodies; decode so assertions read naturally. */
const decodeForm = (body: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(body).entries());

describe('Stripe payments (live SDK path via nock)', () => {
  useStripeNock();

  describe('createCheckoutSession', () => {
    it('sends the amount in minor units, never the major-unit figure', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/checkout/sessions', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, checkoutSession());

      await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      // 784.80 SGD must arrive as 78480, not 784.8
      expect(received['line_items[0][price_data][unit_amount]']).to.equal('78480');
      expect(received['line_items[0][price_data][currency]']).to.equal('sgd');
      expect(received['line_items[0][quantity]']).to.equal('1');
      expectAllMocksUsed();
    });

    it('does not scale a zero-decimal currency', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/checkout/sessions', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, checkoutSession({ currency: 'jpy', amountTotal: 12000 }));

      await withLiveStripe(() =>
        createCheckoutSession({ ...BASE_INPUT, amount: 12000, currency: 'JPY' })
      );

      // 12000 JPY is 12000 minor units. Multiplying by 100 would charge 100x.
      expect(received['line_items[0][price_data][unit_amount]']).to.equal('12000');
      expect(received['line_items[0][price_data][currency]']).to.equal('jpy');
    });

    it('builds the amount from its own argument, with no way for a body to reach it', async () => {
      // The line item is assembled here from server-side state. There is no
      // path from a request body to unit_amount, and this is where that stops
      // being a claim about the controller and becomes one about the wire.
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/checkout/sessions', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, checkoutSession());

      await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      const amountKeys = Object.keys(received).filter((key) => key.includes('amount'));
      expect(amountKeys).to.deep.equal(['line_items[0][price_data][unit_amount]']);
    });

    /** Nothing is written before payment, so this metadata is the only record of what the customer asked for. */
    it('carries the guest and stay out in the session metadata', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/checkout/sessions', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, checkoutSession());

      await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      expect(received['metadata[guest]']).to.equal(METADATA.guest);
      expect(received['metadata[stay]']).to.equal(METADATA.stay);
      expect(received.client_reference_id).to.equal('ref_test_a1b2c3');
      expect(received.customer_email).to.equal('jane@example.com');
      expect(received.mode).to.equal('payment');
    });

    it('passes the success URL with the session-id placeholder intact', async () => {
      let received: Record<string, string> = {};

      nock(STRIPE_API)
        .post('/v1/checkout/sessions', (body) => {
          received = decodeForm(body as unknown as string);
          return true;
        })
        .reply(200, checkoutSession());

      await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      // Stripe substitutes this server-side; pre-expanding it breaks the return
      // trip, and the return trip is what writes the booking.
      expect(received.success_url).to.contain('{CHECKOUT_SESSION_ID}');
      expect(received.cancel_url).to.contain('cancelled=1');
    });

    it('returns the hosted URL Stripe issued, not one we construct', async () => {
      nock(STRIPE_API)
        .post('/v1/checkout/sessions')
        .reply(
          200,
          checkoutSession({ id: 'cs_test_live1', url: 'https://checkout.stripe.com/c/pay/live1' })
        );

      const result = await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      expect(result.sessionId).to.equal('cs_test_live1');
      expect(result.redirectUrl).to.equal('https://checkout.stripe.com/c/pay/live1');
    });

    it('throws rather than redirecting nowhere when Stripe omits the URL', async () => {
      nock(STRIPE_API).post('/v1/checkout/sessions').reply(200, checkoutSession({ url: null }));

      let caught: Error | null = null;
      await withLiveStripe(async () => {
        try {
          await createCheckoutSession(BASE_INPUT);
        } catch (error) {
          caught = error as Error;
        }
      });

      expect(caught).to.be.instanceOf(Error);
      expect((caught as unknown as Error).message).to.contain('without a redirect URL');
    });

    it('surfaces a declined card as a safe message with no Stripe wording', async () => {
      nock(STRIPE_API)
        .post('/v1/checkout/sessions')
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
            await createCheckoutSession(BASE_INPUT);
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      expect(safe.message).to.equal('Your card has insufficient funds.');
      expect(safe.correlationId).to.equal(undefined);
    });

    it('withholds detail from a Stripe authentication failure', async () => {
      nock(STRIPE_API)
        .post('/v1/checkout/sessions')
        .reply(
          401,
          stripeError({
            type: 'authentication_error',
            message: 'Invalid API Key provided: sk_test_51H8xQ2****',
          })
        );

      const safe = await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await createCheckoutSession(BASE_INPUT);
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      // A misconfiguration must never render our key prefix into the payment form.
      expect(safe.message).to.not.contain('API Key');
      expect(safe.message).to.not.contain('sk_test');
      expect(safe.correlationId).to.be.a('string');
    });
  });

  describe('verifySession', () => {
    it('reports a paid session with everything the row needs', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_paid')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_paid',
            paymentStatus: 'paid',
            paymentIntent: 'pi_test_abc',
            clientReferenceId: 'ref_test_paid',
            amountTotal: 78480,
            metadata: METADATA,
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_paid'));

      expect(result.paid).to.equal(true);
      expect(result.paymentIntentId).to.equal('pi_test_abc');
      expect(result.amountTotal).to.equal(78480);
      expect(result.currency).to.equal('sgd');
      expect(result.clientReferenceId).to.equal('ref_test_paid');
      expect(result.metadata).to.deep.equal(METADATA);
    });

    /** The card columns are NOT NULL and live two hops down the object graph, so an unexpanded retrieve produces a payment that can never be inserted. */
    it('asks Stripe to expand the payment method, or the card columns arrive empty', async () => {
      let expandParam: string | null = null;

      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_expand')
        .query((query) => {
          expandParam = (query['expand[0]'] as string) ?? null;
          return true;
        })
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_expand',
            paymentStatus: 'paid',
            paymentIntent: paymentIntentWithCard(),
          })
        );

      await withLiveStripe(() => verifySession('cs_test_expand'));

      expect(expandParam).to.equal('payment_intent.payment_method');
    });

    it('reads the card brand, last four and expiry off the expanded payment method', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_card')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_card',
            paymentStatus: 'paid',
            paymentIntent: paymentIntentWithCard({
              id: 'pi_test_card',
              brand: 'mastercard',
              last4: '4444',
              expMonth: 7,
              expYear: 2029,
            }),
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_card'));

      expect(result.paymentIntentId).to.equal('pi_test_card');
      expect(result.card).to.deep.equal({
        brand: 'mastercard',
        last4: '4444',
        expMonth: 7,
        expYear: 2029,
      });
    });

    it('reports no card at all rather than a half-built one', async () => {
      // A wallet or bank transfer has no card. Reporting null lets the caller
      // decide; inventing empty strings would write nonsense into NOT NULL
      // columns and read back as a real card.
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_nocard')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_nocard',
            paymentStatus: 'paid',
            paymentIntent: 'pi_test_nocard',
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_nocard'));

      expect(result.card).to.equal(null);
    });

    it('reads the intent id whether Stripe sends a string or an expanded object', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_exp')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_exp',
            paymentStatus: 'paid',
            paymentIntent: paymentIntentWithCard({ id: 'pi_test_expanded' }),
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_exp'));

      expect(result.paymentIntentId).to.equal('pi_test_expanded');
    });

    it('falls back to the payer email for payee_id on a guest checkout', async () => {
      // payee_id is NOT NULL. Prefilling customer_email rather than creating a
      // Customer is what keeps this a guest checkout, so `customer` comes back
      // null on every booking made without an account — the common case.
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_guest')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_guest',
            paymentStatus: 'paid',
            paymentIntent: 'pi_test_guest',
            customer: null,
            customerEmail: 'guest@example.com',
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_guest'));

      expect(result.payeeId).to.equal('guest@example.com');
    });

    it('prefers the Stripe Customer id when one exists', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_cust')
        .query(true)
        .reply(
          200,
          checkoutSession({
            id: 'cs_test_cust',
            paymentStatus: 'paid',
            paymentIntent: 'pi_test_cust',
            customer: 'cus_test_123',
          })
        );

      const result = await withLiveStripe(() => verifySession('cs_test_cust'));

      expect(result.payeeId).to.equal('cus_test_123');
    });

    it('reports an unpaid session as unpaid', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_unpaid')
        .query(true)
        .reply(200, checkoutSession({ id: 'cs_test_unpaid', paymentStatus: 'unpaid' }));

      const result = await withLiveStripe(() => verifySession('cs_test_unpaid'));

      expect(result.paid).to.equal(false);
    });

    it('returns empty metadata rather than undefined when Stripe sends none', async () => {
      // recordPaidBooking reads this without a guard; undefined would throw
      // inside the handler instead of producing its 422.
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_nometa')
        .query(true)
        .reply(200, { ...checkoutSession({ id: 'cs_test_nometa' }), metadata: null });

      const result = await withLiveStripe(() => verifySession('cs_test_nometa'));

      expect(result.metadata).to.deep.equal({});
    });

    it('rejects on an unknown session rather than reporting it unpaid', async () => {
      nock(STRIPE_API)
        .get('/v1/checkout/sessions/cs_test_missing')
        .query(true)
        .reply(
          404,
          stripeError({
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: 'No such checkout.session: cs_test_missing',
          })
        );

      let rejected = false;
      await withLiveStripe(async () => {
        try {
          await verifySession('cs_test_missing');
        } catch {
          // A missing session must not read as "not paid" — that is a different
          // fact, and postConfirmBooking distinguishes them.
          rejected = true;
        }
      });

      expect(rejected).to.equal(true);
    });
  });

  describe('resilience', () => {
    it('retries a transient 500 and succeeds on the retry', async () => {
      nock(STRIPE_API)
        .post('/v1/checkout/sessions')
        .reply(500, stripeError({ type: 'api_error', message: 'Internal server error' }));
      nock(STRIPE_API)
        .post('/v1/checkout/sessions')
        .reply(200, checkoutSession({ id: 'cs_after_retry' }));

      const result = await withLiveStripe(() => createCheckoutSession(BASE_INPUT));

      // maxNetworkRetries: 2 in paymentService — a single blip must not cost a booking.
      expect(result.sessionId).to.equal('cs_after_retry');
      expectAllMocksUsed();
    });

    it('gives up once retries are exhausted', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        nock(STRIPE_API)
          .post('/v1/checkout/sessions')
          .reply(500, stripeError({ type: 'api_error', message: 'Internal server error' }));
      }

      const safe = await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await createCheckoutSession(BASE_INPUT);
            throw new Error('expected the call to reject');
          } catch (error) {
            return toSafeError(error);
          }
        })
      );

      expect(safe.message).to.contain('could not be processed');
      expect(safe.correlationId).to.be.a('string');
    });
  });

  /** Regression guard. */
  describe('interception is actually in force', () => {
    it('blocks a Stripe request that has no interceptor', async function () {
      // The SDK retries a refused connection twice before giving up, which is
      // longer than the default timeout allows for.
      this.timeout(15_000);

      let message = '';

      await withSilencedErrorLog(() =>
        withLiveStripe(async () => {
          try {
            await createCheckoutSession(BASE_INPUT);
          } catch (error) {
            message = (error as Error).message;
          }
        })
      );

      // The SDK reports nock's refusal as a connection failure. What matters is
      // that the socket never opened: any message mentioning a key or an
      // authentication failure would mean the request reached Stripe.
      expect(message).to.match(/connection/i);
      expect(message).to.not.contain('API Key');
      expect(message).to.not.contain('sk_test');
    });
  });

  describe('the simulator still short-circuits', () => {
    it('makes no HTTP request at all when PAYMENTS_MODE=simulate', async () => {
      // No interceptor registered, and net connect is disabled: any attempt to
      // reach Stripe here would throw rather than silently pass.
      const clientReferenceId = randomUUID();

      const result = await createCheckoutSession({ ...BASE_INPUT, clientReferenceId });

      expect(result.sessionId).to.equal(`sim_sess_${clientReferenceId}`);
      expect(result.redirectUrl).to.contain(`session_id=sim_sess_${clientReferenceId}`);
      expect(nock.pendingMocks()).to.have.length(0);
    });

    /** The simulator holds what it was handed so verifySession can give it back. */
    it('hands the session metadata back after the redirect', async () => {
      const clientReferenceId = randomUUID();

      const session = await createCheckoutSession({ ...BASE_INPUT, clientReferenceId });
      const verified = await verifySession(session.sessionId);

      expect(verified.paid).to.equal(true);
      expect(verified.paymentIntentId).to.equal(`sim_pi_${clientReferenceId}`);
      expect(verified.amountTotal).to.equal(78480);
      expect(verified.currency).to.equal('sgd');
      expect(verified.clientReferenceId).to.equal(clientReferenceId);
      expect(verified.metadata).to.deep.equal(METADATA);
      expect(verified.card).to.not.equal(null);
    });

    it('reports a session it never issued with no metadata to book from', async () => {
      // A forged session id reaches here. It must not resolve to somebody
      // else's booking details, and an empty metadata bag is what stops
      // recordPaidBooking turning it into a row.
      const verified = await verifySession(`sim_sess_${randomUUID()}`);

      expect(verified.metadata).to.deep.equal({});
      expect(verified.amountTotal).to.equal(null);
    });
  });
});
