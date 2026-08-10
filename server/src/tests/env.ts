/** Test environment defaults. */
process.env.PAYMENTS_MODE ??= 'simulate';
process.env.BOOKINGS_STORAGE ??= 'memory';
process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'placeholder-secret-key';
process.env.APP_URL ??= 'http://localhost:3000';

/** Fake credentials, never sent anywhere: nock intercepts every Stripe request and globalSetup.ts blocks outbound sockets outright. */
process.env.STRIPE_SECRET_KEY ??= 'sk_test_00000000000000000000000000';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_testtesttesttesttesttesttest00';

/** Stripe's default NodeHttpClient deadlocks under nock — see paymentService. */
process.env.STRIPE_HTTP_CLIENT ??= 'fetch';

/** The real price search takes several seconds to settle, and the defaults are tuned for that. */
process.env.HOTEL_API_POLL_MS ??= '1';
process.env.HOTEL_API_MAX_POLLS ??= '3';

/**
 * Forced to '' — not deleted, not ??= — because both other sources must lose:
 * a real Resend key in the developer's server/.env would flip every suite
 * that observes the confirmation log line onto the socket-blocked network
 * path. This file runs before index.ts calls dotenv.config(), and dotenv
 * never overrides an existing variable — so an existing '' blocks the .env
 * value, where a deleted variable would just be refilled. Assignment (vs ??=)
 * also kills a key inherited from the shell. The transport tests set real
 * values per-test and clean up after themselves.
 */
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';
