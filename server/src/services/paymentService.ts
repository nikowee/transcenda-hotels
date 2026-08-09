// Loads .env at import time. index.ts calls dotenv.config() in its own body,
// which ESM runs only after every import has already been evaluated — too late
// for the module-scope reads below.
import 'dotenv/config';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import type { CardDetails } from '../models/bookingTypes.js';

/**
 * What simulate mode reports for the NOT NULL card columns. Shared by both the
 * hosted-checkout and Elements paths so a demo booking looks the same however
 * it was made.
 */
const SIMULATED_CARD: CardDetails = {
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
};

/**
 * PaymentService — the «External API» box from the UC4 class diagram.
 *
 * Stripe Checkout Sessions: the customer pays on a Stripe-hosted page, so card
 * data never reaches this server or the client bundle — PCI SAQ A, not SAQ D.
 * The diagram's processPayment(amount, currency) is therefore split into
 * createCheckoutSession + verifySession; its signature required holding the PAN.
 *
 * verifySession is now the only place the booking's payment columns come from.
 * The table cannot hold an unpaid row, so nothing is written until this module
 * says the charge cleared.
 */

/** Pinned: the ^22 caret range would let the wire version drift on any lockfile refresh. */
const STRIPE_API_VERSION = '2026-06-24.dahlia';

const secretKey = process.env.STRIPE_SECRET_KEY;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Simulation is opt-in and never available in production. A missing key must
 * fail loudly — silently downgrading to "every card succeeds" is a payment
 * bypass, not a convenience.
 */
export const isSimulated = (): boolean =>
  !isProduction && process.env.PAYMENTS_MODE === 'simulate';

if (isProduction && !secretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is required when NODE_ENV=production. Refusing to start.'
  );
}

if (!secretKey && !isSimulated()) {
  console.warn(
    '\n⚠️  STRIPE_SECRET_KEY is not set and PAYMENTS_MODE is not "simulate".\n' +
      '   Payment endpoints will return 503 until one of those is configured.\n' +
      '   Set PAYMENTS_MODE=simulate in .env to exercise the flow locally.\n'
  );
}

if (isSimulated()) {
  console.warn(
    '\n⚠️  PAYMENTS_MODE=simulate — no real charges. Never set this in production.\n'
  );
}

/**
 * Stripe's default NodeHttpClient defers req.write() until the socket emits
 * `secureConnect`. nock's mocked socket never emits it, so an intercepted
 * request is written but never sent and the promise never settles — the test
 * hangs rather than failing. The fetch client has no such handshake and nock
 * intercepts it cleanly.
 *
 * STRIPE_HTTP_CLIENT is test plumbing, not configuration: tests/env.ts sets it
 * to 'fetch' so nock can intercept. Nothing else sets it, and production keeps
 * the default keep-alive agent.
 */
const httpClient =
  process.env.STRIPE_HTTP_CLIENT === 'fetch'
    ? // Bound per call, not captured once. FetchHttpClient defaults to
      // `fetchFn = globalThis.fetch` in its constructor, so a client built
      // before nock patches the global keeps the pristine fetch and reaches the
      // real Stripe API — tests then pass or fail against production instead of
      // the interceptor. Import order decides which, which is not a thing a test
      // suite should depend on.
      Stripe.createFetchHttpClient((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
    : undefined;

/** Constructed once. The previous per-request client discarded connection pooling. */
const stripe = secretKey
  ? new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 10_000,
      ...(httpClient ? { httpClient } : {}),
    })
  : null;

export const isConfigured = (): boolean => Boolean(stripe) || isSimulated();

/**
 * Stripe bills in a currency's smallest unit, and the exponent is not always 2.
 * Getting this wrong overcharges JPY/KRW by 100x.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export const toMinorUnits = (amount: number, currency: string): number => {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(amount);
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 1000);
  return Math.round(amount * 100);
};

/**
 * Stripe's own messages can carry configuration detail ("Invalid API Key
 * provided: sk_test_...") so nothing from the SDK is relayed verbatim. Card
 * errors map to this allowlist; everything else gets a correlation ID.
 */
const SAFE_DECLINE_MESSAGES: Record<string, string> = {
  card_declined: 'Your card was declined. Please try a different payment method.',
  expired_card: 'That card has expired. Please use a different card.',
  incorrect_cvc: 'The security code was incorrect. Please check and try again.',
  incorrect_number: 'That card number is not valid. Please check and try again.',
  insufficient_funds: 'Your card has insufficient funds.',
  processing_error: 'We could not process that card. Please try again in a moment.',
};

export interface SafeError {
  message: string;
  correlationId?: string;
}

export const toSafeError = (error: unknown): SafeError => {
  if (error instanceof Stripe.errors.StripeCardError) {
    // `||`, not `??`: the SDK sets decline_code to '' rather than undefined when
    // the raw payload omits it, so nullish-coalescing never reaches `code` and
    // every expired card reads back as a generic decline.
    const code = error.decline_code || error.code || '';
    const message = SAFE_DECLINE_MESSAGES[code];
    if (message) return { message };
    return { message: SAFE_DECLINE_MESSAGES.card_declined as string };
  }

  const correlationId = `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  console.error(`[payment ${correlationId}]`, error);
  return {
    message: 'Payment could not be processed. Please try again or contact support.',
    correlationId,
  };
};

export interface CheckoutSessionInput {
  /**
   * Correlation handle for this payment attempt. It is deliberately not a
   * booking id: no row exists yet, and none will until the charge clears.
   */
  clientReferenceId: string;
  /** Major units. Always server-derived — never accepted from a request body. */
  amount: number;
  currency: string;
  guestEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * The only channel that survives the trip out to the hosted page and back.
   * Everything needed to write the booking rides here, because the booking
   * itself cannot be persisted before payment. Stripe caps this at 50 keys and
   * 500 characters per value; callers are responsible for staying under both.
   */
  metadata: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  /** Where to send the browser. Stripe-hosted, or our own confirmation page when simulating. */
  redirectUrl: string;
}

const SIM_SESSION_PREFIX = 'sim_sess_';

/**
 * Simulate mode has no Stripe to read a session back from, so what was handed
 * to createCheckoutSession is held here for verifySession to return. Without it
 * the metadata carrying the guest and stay would evaporate at the redirect and
 * the simulated flow could never reach an insert.
 */
const simulatedSessions = new Map<string, CheckoutSessionInput>();

/**
 * Sequence step 5. Creates the hosted payment page; no card data passes through
 * this process at any point.
 */
export const createCheckoutSession = async (
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> => {
  if (isSimulated()) {
    // Stripe substitutes {CHECKOUT_SESSION_ID} in the real success_url, so the
    // simulator has to do the same or the return trip carries a literal token.
    const sessionId = `${SIM_SESSION_PREFIX}${input.clientReferenceId}`;
    simulatedSessions.set(sessionId, input);
    return {
      sessionId,
      redirectUrl: input.successUrl.replace('{CHECKOUT_SESSION_ID}', sessionId),
    };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // Prefilling the email rather than creating a Customer keeps this a
    // guest checkout, which is why session.customer comes back null and
    // verifySession has to fall back to customer_details.email for payee_id.
    customer_email: input.guestEmail,
    client_reference_id: input.clientReferenceId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Amount is built here from server-side state, so the browser cannot influence it.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: toMinorUnits(input.amount, input.currency),
          product_data: { name: input.description },
        },
      },
    ],
    metadata: input.metadata,
  });

  if (!session.url) {
    throw new Error('Stripe returned a session without a redirect URL');
  }

  return { sessionId: session.id, redirectUrl: session.url };
};

export interface VerifiedPayment {
  paid: boolean;
  paymentIntentId: string | null;
  /** Minor units, as Stripe charged it. */
  amountTotal: number | null;
  currency: string | null;
  /** Stripe Customer id, or the session's email when the checkout was a guest one. */
  payeeId: string | null;
  card: CardDetails | null;
  clientReferenceId: string | null;
  /** What createCheckoutSession sent out, handed back after the redirect. */
  metadata: Record<string, string>;
  /**
   * True only when the simulator produced this, never merely because the process
   * is in simulate mode.
   *
   * The two are not the same, and conflating them was a real bug: a genuine
   * `pi_…` posted to a box running PAYMENTS_MODE=simulate *with* real
   * credentials falls through to the live Stripe client and verifies for real,
   * yet `isSimulated()` still reads true. Callers that relax a rule for demo
   * payments — postConfirmBooking accepting a client-supplied card — must key
   * off provenance, which is this field, not off the mode.
   */
  simulated: boolean;
}

/**
 * Authoritative check against Stripe. Callers must never infer payment state
 * from anything the browser sent them.
 *
 * Returns everything the bookings table needs, because the row is assembled
 * from this and nothing else: the charge, the payer, the card columns, and the
 * metadata that carried the guest and stay across the redirect.
 */
export const verifySession = async (sessionId: string): Promise<VerifiedPayment> => {
  if (isSimulated() && sessionId.startsWith(SIM_SESSION_PREFIX)) {
    const input = simulatedSessions.get(sessionId);
    const reference = sessionId.slice(SIM_SESSION_PREFIX.length);

    return {
      paid: true,
      paymentIntentId: `sim_pi_${reference}`,
      amountTotal: input ? toMinorUnits(input.amount, input.currency) : null,
      currency: input ? input.currency.toLowerCase() : null,
      payeeId: input?.guestEmail ?? null,
      // The card columns are NOT NULL, so the simulator has to supply something
      // shaped like a real answer or the flow stops one step short of the insert.
      card: SIMULATED_CARD,
      clientReferenceId: input?.clientReferenceId ?? reference,
      metadata: input?.metadata ?? {},
      simulated: true,
    };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  /**
   * The card columns live two hops down (session → payment_intent →
   * payment_method) and are absent from an unexpanded retrieve. Expanding is
   * PCI-safe: brand, last four and expiry are the only card fields permitted in
   * storage, and Stripe never returns the PAN or CVC to an API key at all — so
   * nothing that would put this application in scope for SAQ D ever arrives.
   */
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent.payment_method'],
  });

  const intent =
    typeof session.payment_intent === 'string' ? null : session.payment_intent;
  const paymentMethod =
    intent && typeof intent.payment_method !== 'string' ? intent.payment_method : null;
  const cardFields = paymentMethod?.card ?? null;

  return {
    paid: session.payment_status === 'paid',
    paymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (intent?.id ?? null),
    amountTotal: session.amount_total,
    currency: session.currency,
    payeeId:
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? session.customer_details?.email ?? null),
    card: cardFields
      ? {
          brand: cardFields.brand,
          last4: cardFields.last4,
          expMonth: cardFields.exp_month,
          expYear: cardFields.exp_year,
        }
      : null,
    clientReferenceId: session.client_reference_id,
    metadata: session.metadata ?? {},
    simulated: false,
  };
};

export interface PaymentIntentInput {
  /** Major units. Always server-derived — never accepted from a request body. */
  amount: number;
  currency: string;
  guestEmail: string;
  description: string;
  /**
   * Makes a repeated create return the intent it already made, instead of a new
   * one.
   *
   * /payment mints an intent on mount, and a refresh or a second trip through
   * checkout is a fresh mount — so without this, one booking attempt leaves a
   * trail of abandoned intents at requires_payment_method. Observed: three
   * intents for a single ibis Styles stay, two of them orphans.
   *
   * Stripe holds a key for 24 hours and replays the original response for it.
   * The caller is responsible for varying the key when the amount does; see
   * bookingController, which folds the priced total into it. A key that ignored
   * the amount would trade duplicate intents for a stale one, which is far
   * worse — the guest would be charged a price we no longer quote.
   */
  idempotencyKey?: string;
  /**
   * Attached to the intent as `shipping`, which is not the same thing as an AVS
   * check and this comment used to claim it was.
   *
   * AVS runs against payment_method.billing_details, and in the Elements flow
   * the payment method is created in the browser at confirm time — there is no
   * server-side field on a PaymentIntent that sets it. Reaching a real AVS check
   * means having the page pass billing details to confirmPayment, which is a
   * change to PaymentPage, not to this call.
   *
   * `shipping` is still worth sending: it puts the address on the Stripe object
   * where Radar can score it and support can read it — and since our own table
   * stores no address, it is the only copy that exists anywhere.
   */
  billing?: {
    name: string;
    line1: string;
    line2?: string | null;
    city: string;
    state?: string | null;
    postalCode: string;
    country: string;
  } | null;
  /** Rides on the intent, exactly as it rides on a Checkout Session. */
  metadata: Record<string, string>;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  /**
   * Handed to Stripe.js in the browser to mount Elements and confirm the
   * charge. It authorises exactly one payment and nothing else — it is not a
   * secret key, and it is safe to send to the client. That is the whole point:
   * the card is confirmed browser→Stripe, so the PAN never reaches us.
   */
  clientSecret: string;
}

/** Simulate mode has no Stripe to hold state for us, so it holds its own. */
const simulatedIntents = new Map<string, PaymentIntentInput>();

/**
 * Creates a PaymentIntent for the embedded Elements flow.
 *
 * The alternative, createCheckoutSession, redirects the customer to a
 * Stripe-hosted page. This one keeps them on ours: Stripe.js mounts the card
 * fields as cross-origin iframes, so the page is ours while the inputs are
 * Stripe's. Both keep the platform at PCI SAQ A; only this one puts a payment
 * page in our own application, which is what the UC4 diagrams draw.
 */
export const createPaymentIntent = async (
  input: PaymentIntentInput
): Promise<PaymentIntentResult> => {
  if (isSimulated()) {
    const paymentIntentId = `sim_pi_${randomUUID()}`;
    simulatedIntents.set(paymentIntentId, input);
    // Shaped like a real client secret so the client can branch on the same
    // field rather than knowing which mode the server is in.
    return { paymentIntentId, clientSecret: `${paymentIntentId}_secret_simulated` };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const intent = await stripe.paymentIntents.create({
    amount: toMinorUnits(input.amount, input.currency),
    currency: input.currency.toLowerCase(),
    receipt_email: input.guestEmail,
    description: input.description,
    metadata: input.metadata,
    ...(input.billing
      ? {
          shipping: {
            name: input.billing.name,
            address: {
              line1: input.billing.line1,
              ...(input.billing.line2 ? { line2: input.billing.line2 } : {}),
              city: input.billing.city,
              ...(input.billing.state ? { state: input.billing.state } : {}),
              postal_code: input.billing.postalCode,
              country: input.billing.country,
            },
          },
        }
      : {}),
    // Lets Stripe decide which methods to offer from the dashboard config,
    // rather than hardcoding 'card' and silently excluding wallets.
    automatic_payment_methods: { enabled: true },
  },
  // Second argument, not a body parameter — Stripe reads it off the
  // Idempotency-Key header. Passing it inside the params object silently does
  // nothing, which is the easy way to write this and believe it works.
  input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined);

  if (!intent.client_secret) {
    throw new Error('Stripe returned a payment intent without a client secret');
  }

  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
};

/**
 * Reads a PaymentIntent back after the browser confirmed it.
 *
 * Returns the same VerifiedPayment shape as verifySession on purpose:
 * recordPaidBooking consumes either without caring which flow produced it, so
 * the two payment paths cannot drift in how a booking gets written.
 */
export const verifyPaymentIntent = async (
  paymentIntentId: string
): Promise<VerifiedPayment> => {
  if (isSimulated() && paymentIntentId.startsWith('sim_pi_')) {
    const input = simulatedIntents.get(paymentIntentId);
    return {
      paid: Boolean(input),
      paymentIntentId,
      amountTotal: input ? toMinorUnits(input.amount, input.currency) : null,
      currency: input ? input.currency.toLowerCase() : null,
      payeeId: input?.guestEmail ?? null,
      card: input ? SIMULATED_CARD : null,
      clientReferenceId: null,
      metadata: input?.metadata ?? {},
      simulated: true,
    };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    // The card columns are NOT NULL and live two hops down; an unexpanded
    // retrieve carries none of them.
    expand: ['payment_method'],
  });

  const method = typeof intent.payment_method === 'string' ? null : intent.payment_method;
  const cardFields = method?.card ?? null;

  return {
    paid: intent.status === 'succeeded',
    paymentIntentId: intent.id,
    amountTotal: intent.amount_received || intent.amount,
    currency: intent.currency,
    payeeId:
      (typeof intent.customer === 'string' ? intent.customer : (intent.customer?.id ?? null)) ??
      intent.receipt_email,
    card: cardFields
      ? {
          brand: cardFields.brand,
          last4: cardFields.last4,
          expMonth: cardFields.exp_month,
          expYear: cardFields.exp_year,
        }
      : null,
    clientReferenceId: null,
    metadata: intent.metadata ?? {},
    simulated: false,
  };
};

export interface RefundInput {
  paymentIntentId: string;
  /** Major units. Omit for a full refund — never compute a "full" amount by hand. */
  amount?: number;
  currency?: string;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export interface RefundResult {
  refundId: string;
  /** succeeded | pending | failed | canceled. Only `succeeded` is money returned. */
  status: string;
  /** Minor units, as Stripe reports it — not echoed from the request. */
  amountRefunded: number;
  currency: string;
}

/**
 * Refunds a captured payment.
 *
 * Amount is optional on purpose: omitting it tells Stripe to refund the full
 * captured total, which is always correct. Passing a locally computed "full"
 * amount can drift from what was actually captured and leave a few cents
 * unrefunded.
 *
 * Idempotency is Stripe-side via the key derived from the intent, so a retried
 * call returns the original refund rather than issuing a second one.
 *
 * The returned refundId has nowhere to go: the bookings table has no refund
 * column and no status, so a refunded stay still reads as paid in our database
 * and Stripe remains the only record that the money went back. Callers should
 * log the id. See the charge.refunded branch in webhookController.
 */
export const refundPayment = async (input: RefundInput): Promise<RefundResult> => {
  if (isSimulated()) {
    return {
      refundId: `sim_re_${input.paymentIntentId}`,
      status: 'succeeded',
      amountRefunded: input.amount
        ? toMinorUnits(input.amount, input.currency ?? 'SGD')
        : 0,
      currency: (input.currency ?? 'SGD').toLowerCase(),
    };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const refund = await stripe.refunds.create(
    {
      payment_intent: input.paymentIntentId,
      ...(input.amount !== undefined
        ? { amount: toMinorUnits(input.amount, input.currency ?? 'SGD') }
        : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    { idempotencyKey: `refund_${input.paymentIntentId}` }
  );

  return {
    refundId: refund.id,
    status: refund.status ?? 'unknown',
    amountRefunded: refund.amount,
    currency: refund.currency,
  };
};

/** Verifies the Stripe-Signature header. Requires the raw, unparsed request body. */
export const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string
): Stripe.Event => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error('WEBHOOK_NOT_CONFIGURED');
  }

  /**
   * The static, not the instance. Verification is an HMAC over bytes we already
   * hold — no API key is involved and nothing leaves the process — so requiring
   * a configured Stripe client to do it was an accident of where the method
   * hangs, and it made the whole webhook path unreachable in simulate mode: no
   * STRIPE_SECRET_KEY meant no client, which meant every delivery answered 503.
   * That is the one path a demo most needs to exercise, because it is the only
   * thing that turns a charge the customer walked away from into a booking.
   */
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
};