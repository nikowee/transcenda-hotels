// Loads .env at import time. index.ts calls dotenv.config() in its own body,
// which ESM runs only after every import has already been evaluated — too late
// for the module-scope reads below.
import 'dotenv/config';
import Stripe from 'stripe';

/**
 * PaymentService — the «External API» box from the UC4 class diagram.
 *
 * Stripe Checkout Sessions: the customer pays on a Stripe-hosted page, so card
 * data never reaches this server or the client bundle — PCI SAQ A, not SAQ D.
 * The diagram's processPayment(amount, currency) is therefore split into
 * createCheckoutSession + verifySession; its signature required holding the PAN.
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

/** Constructed once. The previous per-request client discarded connection pooling. */
const stripe = secretKey
  ? new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 2,
      timeout: 10_000,
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
  bookingReference: string;
  /** Major units. Always server-derived — never accepted from a request body. */
  amount: number;
  currency: string;
  guestEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  /** Where to send the browser. Stripe-hosted, or our own confirmation page when simulating. */
  redirectUrl: string;
}

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
    const sessionId = `sim_sess_${input.bookingReference}`;
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
    customer_email: input.guestEmail,
    client_reference_id: input.bookingReference,
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
    metadata: { bookingReference: input.bookingReference },
  });

  if (!session.url) {
    throw new Error('Stripe returned a session without a redirect URL');
  }

  return { sessionId: session.id, redirectUrl: session.url };
};

export interface VerifiedPayment {
  paid: boolean;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  bookingReference: string | null;
}

/**
 * Authoritative check against Stripe. Callers must never infer payment state
 * from anything the browser sent them.
 */
export const verifySession = async (sessionId: string): Promise<VerifiedPayment> => {
  if (isSimulated() && sessionId.startsWith('sim_sess_')) {
    return {
      paid: true,
      paymentIntentId: `sim_pi_${sessionId.slice(9)}`,
      amountTotal: null,
      currency: null,
      bookingReference: sessionId.slice(9),
    };
  }

  if (!stripe) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  return {
    paid: session.payment_status === 'paid',
    paymentIntentId:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
    amountTotal: session.amount_total,
    currency: session.currency,
    bookingReference: session.client_reference_id,
  };
};

/** Verifies the Stripe-Signature header. Requires the raw, unparsed request body. */
export const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string
): Stripe.Event => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    throw new Error('WEBHOOK_NOT_CONFIGURED');
  }

  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
};
