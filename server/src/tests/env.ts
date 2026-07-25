/**
 * Test environment defaults.
 *
 * Imported for its side effects before ../index, because paymentService and
 * bookingModel read process.env at module scope and ESM evaluates imports in
 * declaration order. Assignments in setup.ts itself would run too late — every
 * import is hoisted above them.
 *
 * Uses ??= so a real .env still wins locally.
 */
process.env.PAYMENTS_MODE ??= 'simulate';
process.env.BOOKINGS_STORAGE ??= 'memory';
process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'placeholder-secret-key';
process.env.APP_URL ??= 'http://localhost:3000';

/**
 * Fake credentials, never sent anywhere: nock intercepts every Stripe request
 * and globalSetup.ts blocks outbound sockets outright.
 *
 * They exist so paymentService constructs a real Stripe client at module scope.
 * Without a key the client is null and the live branch is unreachable, which is
 * how `confirm: false` and the silent-simulator payment bypass both shipped —
 * the code path had never been executed by anything.
 *
 * PAYMENTS_MODE=simulate above still routes the default path to the simulator;
 * isSimulated() is read per call, so withLiveStripe() can opt a single test into
 * the real client.
 */
process.env.STRIPE_SECRET_KEY ??= 'sk_test_00000000000000000000000000';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_testtesttesttesttesttesttest00';

/** Stripe's default NodeHttpClient deadlocks under nock — see paymentService. */
process.env.STRIPE_HTTP_CLIENT ??= 'fetch';
