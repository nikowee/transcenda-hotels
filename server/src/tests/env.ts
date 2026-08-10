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
 * Forced to '', not deleted: this file runs before dotenv.config(), and dotenv
 * refills deleted variables but never overrides existing ones. Assignment also
 * kills a shell-inherited key. A real key here would flip every suite that
 * observes the confirmation log line onto the socket-blocked network path.
 */
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';
