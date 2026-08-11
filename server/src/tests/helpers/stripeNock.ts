import { before, after, afterEach } from 'mocha';
import nock from 'nock';
import { allowLoopbackOnly } from '../globalSetup.js';

/** nock harness for the live Stripe path. */

export const STRIPE_API = 'https://api.stripe.com';

/** Suite-level interceptor lifecycle. */
export const useStripeNock = (): void => {
  before(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
    nock.enableNetConnect(allowLoopbackOnly);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    nock.cleanAll();
    // Restores the guarded state, never a fully open network — later suites
    // must stay offline too.
    nock.enableNetConnect(allowLoopbackOnly);
  });
};

/** Runs fn with the simulator switched off so the real Stripe client is used. */
export const withLiveStripe = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.PAYMENTS_MODE;
  delete process.env.PAYMENTS_MODE;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PAYMENTS_MODE;
    } else {
      process.env.PAYMENTS_MODE = previous;
    }
  }
};

/** Silences the correlation-id log while an expected failure is exercised, so a passing run stays readable. */
export const withSilencedErrorLog = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

/** Asserts every interceptor was consumed — catches a request never made. */
export const expectAllMocksUsed = (): void => {
  if (!nock.isDone()) {
    throw new Error(`Unused Stripe interceptors: ${nock.pendingMocks().join(', ')}`);
  }
};

// ── Fixtures ────────────────────────────────────────────────────────────────
// Trimmed to the fields the SDK and our code actually read. Field names and
// types mirror the Stripe API so a shape change surfaces here.

export interface SessionFixtureOptions {
  id?: string;
  /** Correlation handle for the attempt. Not a booking id — none exists yet. */
  clientReferenceId?: string | null;
  amountTotal?: number | null;
  currency?: string | null;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  /** A bare id string, an expanded object, or null. verifySession reads all three. */
  paymentIntent?: string | Record<string, unknown> | null;
  url?: string | null;
  /** The guest and stay ride here and nowhere else: nothing is written before payment, so a session with no metadata is a charge with no booking. */
  metadata?: Record<string, string>;
  customer?: string | null;
  /** Guest checkout leaves `customer` null and reports the payer here instead. */
  customerEmail?: string | null;
}

export const checkoutSession = (options: SessionFixtureOptions = {}) => ({
  id: options.id ?? 'cs_test_a1b2c3',
  object: 'checkout.session',
  client_reference_id:
    options.clientReferenceId === undefined ? 'ref_test_a1b2c3' : options.clientReferenceId,
  amount_total: options.amountTotal === undefined ? 78480 : options.amountTotal,
  currency: options.currency === undefined ? 'sgd' : options.currency,
  payment_status: options.paymentStatus ?? 'unpaid',
  payment_intent: options.paymentIntent === undefined ? null : options.paymentIntent,
  customer: options.customer === undefined ? null : options.customer,
  customer_details: {
    email: options.customerEmail === undefined ? 'jane@example.com' : options.customerEmail,
  },
  metadata: options.metadata ?? {},
  mode: 'payment',
  status: 'open',
  url: options.url === undefined ? 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3' : options.url,
  livemode: false,
});

/** An expanded payment_intent → payment_method → card, the two hops down where the NOT NULL card columns actually live. */
export const paymentIntentWithCard = (
  options: {
    id?: string;
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  } = {}
) => ({
  id: options.id ?? 'pi_test_abc',
  object: 'payment_intent',
  status: 'succeeded',
  payment_method: cardPaymentMethod({
    brand: options.brand,
    last4: options.last4,
    expMonth: options.expMonth,
    expYear: options.expYear,
  }),
});

/** The expanded payment_method a card charge carries. */
export const cardPaymentMethod = (
  options: {
    // Explicitly `| undefined` so callers can forward their own optional fields
    // straight through — exactOptionalPropertyTypes rejects that otherwise.
    id?: string | undefined;
    brand?: string | undefined;
    last4?: string | undefined;
    expMonth?: number | undefined;
    expYear?: number | undefined;
  } = {}
) => ({
  id: options.id ?? 'pm_test_card',
  object: 'payment_method',
  type: 'card',
  card: {
    brand: options.brand ?? 'visa',
    last4: options.last4 ?? '4242',
    exp_month: options.expMonth ?? 12,
    exp_year: options.expYear ?? 2030,
  },
});

export interface PaymentIntentFixtureOptions {
  id?: string;
  /** Only `succeeded` is money taken; verifyPaymentIntent reports the rest unpaid. */
  status?:
    | 'succeeded'
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'canceled';
  amount?: number;
  /** Zero until capture, which is why verifyPaymentIntent falls back to `amount`. */
  amountReceived?: number;
  currency?: string;
  clientSecret?: string | null;
  /** A bare id, an expanded object, or null. verifyPaymentIntent reads all three. */
  paymentMethod?: string | Record<string, unknown> | null;
  customer?: string | Record<string, unknown> | null;
  /** No Customer exists for a guest, so payee_id falls back to this. */
  receiptEmail?: string | null;
  metadata?: Record<string, string> | null;
}

/** A PaymentIntent as `paymentIntents.retrieve` returns it. */
export const retrievedPaymentIntent = (options: PaymentIntentFixtureOptions = {}) => {
  const id = options.id ?? 'pi_test_intent';
  const amount = options.amount ?? 78480;

  return {
    id,
    object: 'payment_intent',
    status: options.status ?? 'succeeded',
    amount,
    amount_received: options.amountReceived === undefined ? amount : options.amountReceived,
    currency: options.currency ?? 'sgd',
    client_secret:
      options.clientSecret === undefined ? `${id}_secret_test` : options.clientSecret,
    payment_method:
      options.paymentMethod === undefined ? cardPaymentMethod() : options.paymentMethod,
    customer: options.customer === undefined ? null : options.customer,
    receipt_email: options.receiptEmail === undefined ? 'jane@example.com' : options.receiptEmail,
    metadata: options.metadata === undefined ? {} : options.metadata,
    livemode: false,
  };
};

export interface RefundFixtureOptions {
  id?: string;
  amount?: number;
  currency?: string;
  status?: 'succeeded' | 'pending' | 'failed' | 'canceled';
  paymentIntentId?: string;
}

export const refund = (options: RefundFixtureOptions = {}) => ({
  id: options.id ?? 're_test_r1r2r3',
  object: 'refund',
  amount: options.amount ?? 78480,
  currency: options.currency ?? 'sgd',
  status: options.status ?? 'succeeded',
  payment_intent: options.paymentIntentId ?? 'pi_test_p1p2p3',
  reason: null,
  livemode: false,
});

/** Stripe's error envelope. `type` drives which SDK error class is constructed. */
export const stripeError = (params: {
  type: 'card_error' | 'invalid_request_error' | 'api_error' | 'authentication_error';
  code?: string;
  declineCode?: string;
  message: string;
}) => ({
  error: {
    type: params.type,
    message: params.message,
    ...(params.code ? { code: params.code } : {}),
    ...(params.declineCode ? { decline_code: params.declineCode } : {}),
  },
});
