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
