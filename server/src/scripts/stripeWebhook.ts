#!/usr/bin/env tsx
/**
 * Local Stripe webhook tooling — a stand-in for `stripe listen` / `stripe
 * trigger` when the Stripe CLI is not installed.
 *
 * A webhook signature is an HMAC-SHA256 over `<timestamp>.<raw body>` keyed on
 * the endpoint's signing secret — entirely local arithmetic. Generate a
 * secret, tell the server about it, and sign your own deliveries with the same
 * key: the server's verification code cannot tell the difference, so what gets
 * tested is the real handler, not a bypass.
 *
 *   npm run stripe:secret              print a signing secret
 *   npm run stripe:secret -- --write   ...and write it into server/.env
 *
 *   npm run stripe:send                book, then deliver the completion event
 *   npm run stripe:send -- --session <sim_sess_…|cs_…>   replay a known session
 *   npm run stripe:send -- --event checkout.session.expired
 *   npm run stripe:send -- --event charge.refunded --payment-intent <pi_…>
 *   npm run stripe:send -- --event payment_intent.succeeded --payment-intent pi_…
 *   npm run stripe:send -- --tamper    flip a byte after signing; expect a 400
 *
 * Works against the simulator and against real Stripe test keys. Under real
 * keys a session id is a `cs_…` the script resolves through the API for its
 * payment intent, and the handler still asks Stripe whether the session was
 * actually paid — so recovery can only be exercised for a payment that really
 * completed. The E2E suite produces those: take the `pi_…` from a run and
 * deliver `payment_intent.succeeded` for it.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../services/paymentService.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(HERE, '../../.env');

const API = `http://localhost:${process.env.PORT ?? 5000}`;
const WEBHOOK_PATH = '/api/webhooks/stripe';

// ── Secret generation ───────────────────────────────────────────────────────

/** Stripe's own secrets are `whsec_` followed by 32 random bytes in base64. */
const generateSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

/** Rewrites STRIPE_WEBHOOK_SECRET in place, preserving the rest of the file. */
const writeSecretToEnv = (secret: string): void => {
  if (!existsSync(ENV_PATH)) {
    throw new Error(`No .env at ${ENV_PATH}. Copy .env.example to .env first.`);
  }

  const original = readFileSync(ENV_PATH, 'utf-8');
  const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
  const pattern = /^STRIPE_WEBHOOK_SECRET=.*$/m;

  const updated = pattern.test(original)
    ? original.replace(pattern, line)
    : `${original.replace(/\n*$/, '\n')}${line}\n`;

  writeFileSync(ENV_PATH, updated, 'utf-8');
};

// ── Real-mode session resolution ────────────────────────────────────────────

/** Only constructed when a real id needs resolving; simulate mode never calls this. */
const stripeClient = (): Stripe => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'A real Stripe id was given but STRIPE_SECRET_KEY is not set, so the session\n' +
        'cannot be resolved. Set the key, or use a sim_sess_/sim_pi_ id.'
    );
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
};

const isRealSession = (id: string): boolean => id.startsWith('cs_');

/** The demo three-night deluxe-king total in minor units — matches the booking fixtures. */
const DEFAULT_AMOUNT = 78480;

/**
 * Turns a real `cs_…` into the payment intent the handler will verify, and
 * says so plainly when the session was never paid — the handler refuses those,
 * which is correct and otherwise reads as a mysterious 4xx.
 */
const resolveRealSession = async (sessionId: string): Promise<string> => {
  const session = await stripeClient().checkout.sessions.retrieve(sessionId);
  const intent = session.payment_intent;
  const paymentIntentId = typeof intent === 'string' ? intent : (intent?.id ?? '');

  if (!paymentIntentId) {
    throw new Error(
      `Session ${sessionId} has no payment intent yet (status: ${session.payment_status}).\n` +
        'Complete the payment in a browser first, or pass an already-paid session.'
    );
  }

  if (session.payment_status !== 'paid') {
    console.warn(
      `⚠️  Session ${sessionId} is ${session.payment_status}, not paid.\n` +
        '   The handler verifies with Stripe and will refuse to write a booking.\n'
    );
  }

  return paymentIntentId;
};

// ── Event fixtures ──────────────────────────────────────────────────────────

const envelope = (type: string, object: Record<string, unknown>) => ({
  id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
  object: 'event',
  api_version: '2026-06-24.dahlia',
  created: Math.floor(Date.now() / 1000),
  type,
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  data: { object },
});

/** The handler re-reads the session from the payment service rather than trusting this payload, so only `id` and `payment_status` have to be right. */
const sessionCompleted = (sessionId: string, paymentIntentId: string) =>
  envelope('checkout.session.completed', {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    payment_intent: paymentIntentId,
    status: 'complete',
    mode: 'payment',
  });

const sessionExpired = (sessionId: string) =>
  envelope('checkout.session.expired', {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'unpaid',
    payment_intent: null,
    status: 'expired',
    mode: 'payment',
  });

const chargeRefunded = (paymentIntentId: string, amount: number) =>
  envelope('charge.refunded', {
    id: `ch_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'charge',
    payment_intent: paymentIntentId,
    amount,
    amount_refunded: amount,
    currency: 'sgd',
    refunded: true,
  });

/** The Elements flow's own completion event — what a real card confirmation emits. */
const paymentIntentSucceeded = (paymentIntentId: string, amount: number) =>
  envelope('payment_intent.succeeded', {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount,
    amount_received: amount,
    currency: 'sgd',
  });

// ── Delivery ────────────────────────────────────────────────────────────────

const deliver = async (event: unknown, secret: string, tamper: boolean): Promise<number> => {
  const payload = JSON.stringify(event);

  // Signed before tampering, so a tampered run sends a signature that was valid
  // for different bytes — the exact forgery the check exists to catch, rather
  // than a header that is merely malformed.
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const body = tamper ? payload.replace(/"livemode":false/, '"livemode":true') : payload;

  const response = await fetch(`${API}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });

  const text = await response.text();
  console.log(`→ POST ${WEBHOOK_PATH}  ${tamper ? '(tampered body) ' : ''}`);
  console.log(`← ${response.status} ${text}`);

  if (tamper && response.status !== 400) {
    console.error('\n❌ A tampered body was not rejected. Signature verification is not working.');
    process.exitCode = 1;
  }

  if (!tamper && response.status === 400) {
    console.error(
      '\nRejected as unsigned. The server is running with a different\n' +
        'STRIPE_WEBHOOK_SECRET than this script — restart it after writing one.'
    );
    process.exitCode = 1;
  }

  return response.status;
};

/** Mints a real checkout session through the API so the event refers to one the server actually knows about. */
const createSession = async (): Promise<{ sessionId: string; paymentIntentId: string }> => {
  const today = new Date();
  const start = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 33 * 86_400_000).toISOString().slice(0, 10);

  const response = await fetch(`${API}/api/bookings/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guestDetails: {
        salutation: 'Ms',
        firstName: 'Webhook',
        lastName: 'Recovery',
        email: 'webhook.recovery@example.com',
        phone: '+65 9123 4567',
      },
      billingAddress: {
        line1: '10 Bayfront Avenue',
        city: 'Singapore',
        postalCode: '018956',
        country: 'SG',
      },
      stay: {
        destinationId: 'RsBU',
        hotelId: 'marina-bay',
        hotelName: 'Marina Bay Sands',
        roomTypes: ['deluxe-king'],
        startDate: start,
        endDate: end,
        adults: 2,
        children: 0,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const hint = body.includes('not available')
      ? '\nThe stay books the demo room deluxe-king, which NODE_ENV=production removes —\nrun against a non-production server, or pass --session with a real cs_… id.'
      : '';
    throw new Error(`Could not create a checkout session: ${response.status} ${body}${hint}`);
  }

  const { redirectUrl } = (await response.json()) as { redirectUrl: string };

  /**
   * Two redirect shapes, because the two modes redirect to different places.
   * The simulator returns our own confirmation URL carrying ?session_id=; real
   * Stripe returns its hosted page, where the cs_… is a path segment.
   */
  const url = new URL(redirectUrl, API);
  const sessionId =
    url.searchParams.get('session_id') ??
    url.pathname.split('/').find((segment) => segment.startsWith('cs_'));

  if (!sessionId) {
    throw new Error(`No session id in the redirect URL: ${redirectUrl}`);
  }

  const paymentIntentId = isRealSession(sessionId)
    ? await resolveRealSession(sessionId)
    : // How the simulator derives it — see verifySession in paymentService.
      `sim_pi_${sessionId.replace(/^sim_sess_/, '')}`;

  console.log(`Created session ${sessionId}`);
  if (isRealSession(sessionId)) {
    console.log(
      'Real Stripe session: nobody has paid it, so the handler will refuse to\n' +
        'write a booking. To exercise recovery, complete a payment (the E2E suite\n' +
        'does) and deliver payment_intent.succeeded for its pi_… instead.\n'
    );
  } else {
    console.log('The customer has paid and has not returned. Delivering the webhook...\n');
  }

  return { sessionId, paymentIntentId };
};

// ── CLI ─────────────────────────────────────────────────────────────────────

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const has = (name: string): boolean => process.argv.includes(`--${name}`);

const main = async (): Promise<void> => {
  const command = process.argv[2];

  if (command === 'secret') {
    const secret = generateSecret();

    if (has('write')) {
      writeSecretToEnv(secret);
      console.log(`Wrote STRIPE_WEBHOOK_SECRET to ${ENV_PATH}`);
      console.log('Restart the server to pick it up.\n');
    }

    console.log(secret);
    return;
  }

  if (command !== 'send') {
    console.error('Usage: stripeWebhook.ts <secret|send> [options]  — see the header comment.');
    process.exitCode = 1;
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      'STRIPE_WEBHOOK_SECRET is not set. Run `npm run stripe:secret -- --write` first,\n' +
        'then restart the server so it loads the same value.'
    );
    process.exitCode = 1;
    return;
  }

  const type = flag('event') ?? 'checkout.session.completed';
  const tamper = has('tamper');

  if (type === 'checkout.session.expired') {
    await deliver(sessionExpired(flag('session') ?? `sim_sess_${randomUUID()}`), secret, tamper);
    return;
  }

  if (type === 'payment_intent.succeeded') {
    const paymentIntentId = flag('payment-intent');
    if (!paymentIntentId) {
      console.error(
        'payment_intent.succeeded needs --payment-intent <pi_…>. Take one from an\n' +
          'E2E run or the Stripe dashboard; it must be a payment that really settled.'
      );
      process.exitCode = 1;
      return;
    }
    await deliver(
      paymentIntentSucceeded(paymentIntentId, Number(flag('amount') ?? DEFAULT_AMOUNT)),
      secret,
      tamper
    );
    return;
  }

  if (type === 'charge.refunded') {
    const paymentIntentId = flag('payment-intent') ?? `sim_pi_${randomUUID()}`;
    await deliver(chargeRefunded(paymentIntentId, Number(flag('amount') ?? DEFAULT_AMOUNT)), secret, tamper);
    return;
  }

  if (type !== 'checkout.session.completed') {
    console.error(`Unsupported event type: ${type}`);
    process.exitCode = 1;
    return;
  }

  const given = flag('session');
  const { sessionId, paymentIntentId } = given
    ? {
        sessionId: given,
        paymentIntentId: isRealSession(given)
          ? await resolveRealSession(given)
          : `sim_pi_${given.replace(/^sim_sess_/, '')}`,
      }
    : await createSession();

  const status = await deliver(sessionCompleted(sessionId, paymentIntentId), secret, tamper);

  if (!tamper && status === 200) {
    // There is no lookup-by-payment-id route — payment ids are Stripe's, not
    // guest-facing references — so the server log is where the recovered
    // booking id appears.
    console.log('\nThe server log should now carry: "Webhook recovered booking <id> for session".');
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
