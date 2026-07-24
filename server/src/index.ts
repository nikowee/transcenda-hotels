import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import {searchDestinations} from './controllers/destinationController.js';
import {
  getCheckout,
  postGuestDetails,
  postPayment,
  postConfirmBooking,
  getBookingByReference,
} from './controllers/bookingController.js';
import { handleStripeWebhook } from './controllers/webhookController.js';
import { rateLimit } from './middleware/rateLimit.js';
import { supabaseAdmin } from './lib/supabaseClient.js';
import { isSupabaseConfigured } from './models/bookingModel.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy hop so req.ip is the real client behind a load balancer.
app.set('trust proxy', 1);

// Restrict to known origins; a bare cors() allows every site to call these APIs.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Vite serves the same app on localhost, 127.0.0.1, and the LAN address it
 * prints as "Network:" — and Docker adds more. Pinning the allowlist to a
 * single spelling silently breaks every other one: the browser drops the
 * response and the UI just looks empty. Outside production, accept any
 * loopback or private-range origin.
 */
const isLocalOrigin = (origin: string): boolean => {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
};

const isProduction = process.env.NODE_ENV === 'production';

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin and non-browser callers (curl, health checks) send no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && isLocalOrigin(origin)) return callback(null, true);

      // Omit the header rather than throwing. The browser still blocks the
      // response, but throwing here hits Express's default error handler and
      // turns every disallowed request into a 500 HTML page.
      return callback(null, false);
    },
  })
);

// Stripe signs the raw bytes, so this must be mounted before express.json().
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  handleStripeWebhook
);

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

app.get('/api/destinations/search', searchDestinations);

// UC4 — Book & Make Payment
// Payment and lookup are throttled: without a limit these are a card-testing
// and reference-enumeration surface.
const paymentLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const lookupLimiter = rateLimit({ windowMs: 60_000, max: 30 });

app.get('/api/bookings/checkout', getCheckout);
app.post('/api/bookings/guest-details', lookupLimiter, postGuestDetails);
app.post('/api/bookings/payment', paymentLimiter, postPayment);
app.post('/api/bookings/confirm', paymentLimiter, postConfirmBooking);
app.get('/api/bookings/:reference', lookupLimiter, getBookingByReference);

/**
 * Connectivity probe. Deliberately targets `bookings` — the table this service
 * actually reads and writes — rather than a table that merely happens to exist,
 * so a green result here means the booking flow will work.
 *
 * Selects only `id`, so a reachable table reports success without pulling guest
 * data into a debug response. A HEAD/count-only request would be tidier still,
 * but PostgREST returns no body for one — including on failure — so the error
 * message comes back empty and the probe cannot say what went wrong.
 */
app.get('/api/supabase-test', async (req, res) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({
      success: false,
      storage: 'memory',
      error:
        'Bookings are using the in-memory store, so Supabase is not in use. ' +
        'Clear BOOKINGS_STORAGE in .env to switch to the database.',
    });
    return;
  }

  const { error } = await supabaseAdmin.from('bookings').select('id').limit(1);

  if (error) {
    res.status(500).json({
      success: false,
      storage: 'supabase',
      // code/hint are what distinguish "table not created" (42P01) from a key
      // or RLS problem, which is the whole question this endpoint answers.
      error: error.message,
      code: error.code,
      hint: error.hint,
    });
    return;
  }

  res.json({ success: true, storage: 'supabase', table: 'bookings' });
});

export default app;

// Only listen when run directly, so importing this in tests does not bind a port.
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] === __filename;
if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`🚀 Transcenda Hotels Backend running natively on http://localhost:${PORT}`);

    // The in-memory store is per-process and cleared on restart. Under `tsx
    // watch` that means every file save silently discards live bookings, and
    // the confirmation page then reports a valid reference as "not found".
    // Too costly to leave implicit.
    if (isSupabaseConfigured()) {
      console.log('   bookings → Supabase');
    } else {
      console.warn(
        '\n⚠️  bookings → in-memory store (BOOKINGS_STORAGE=memory).\n' +
          '   Bookings do not survive a restart, and `npm run dev` restarts on every\n' +
          '   file save — a booking made before a save will 404 on the confirmation\n' +
          '   page. Clear BOOKINGS_STORAGE in .env to persist to Supabase.\n'
      );
    }
  });
}
