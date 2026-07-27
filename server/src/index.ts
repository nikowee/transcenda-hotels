import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { searchDestinations } from './controllers/destinationController.js';
import {
  getHotelById,
  getRoomPrices,
  getHotelSearchResults,
} from './controllers/hotelController.js';
import {
  getCheckout,
  postGuestDetails,
  postPayment,
  postPaymentIntent,
  postConfirmBooking,
  getBookingById,
  getBookingsByUser,
} from './controllers/bookingController.js';
import { handleStripeWebhook } from './controllers/webhookController.js';
import { rateLimit } from './middleware/rateLimit.js';
import { resolveUser, requireUser } from './middleware/auth.js';
/**
 * Deliberately NOT a static import.
 *
 * ./lib/supabaseClient throws at module scope when SUPABASE_URL or
 * SUPABASE_SECRET_KEY is absent. bookingModel and middleware/auth both import
 * it lazily for exactly that reason — so the server can run on the in-memory
 * store with no database, which the startup banner below explicitly describes
 * as a supported mode. Importing it eagerly here defeated both of them: the
 * process aborted during module evaluation, before Express bound a port, so
 * the credential-free path never actually started. The test suite hid it by
 * assigning placeholder credentials in tests/env.ts.
 *
 * The two routes that need it are the only places that pay for it.
 */
const supabaseLib = () => import('./lib/supabaseClient.js');
import { isSupabaseConfigured } from './models/bookingModel.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * How many proxy hops to trust when resolving req.ip.
 *
 * Every rate limiter keys on req.ip, so this figure decides whether they
 * throttle a caller or the whole internet. Set it too low behind a CDN plus a
 * load balancer and req.ip resolves to the load balancer for every request, so
 * all customers share one bucket; set it too high and a caller can spoof
 * X-Forwarded-For to get a fresh bucket per request.
 *
 * Configurable because only the deployment knows the answer. Default 1.
 */
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set('trust proxy', Number.isFinite(trustedProxyHops) ? trustedProxyHops : 1);

/** Version-agnostic: a lookup id is not the place to enforce a UUID version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Restrict to known origins; a bare cors() allows every site to call these APIs.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Fail loudly on a production deployment that forgot CORS_ORIGINS.
 *
 * The default is the localhost value, and production has no local-origin
 * escape hatch, so an unset CORS_ORIGINS refuses every browser request from the
 * real frontend while /api/health and curl — neither of which sends an Origin
 * header — keep answering. The service looks healthy from the backend and the
 * UI renders as empty results with a generic "could not reach the service"
 * message. That is a very expensive thing to debug from the wrong end.
 *
 * A startup warning is the cheapest place to catch it. Not fatal: a deployment
 * that genuinely only serves same-origin or non-browser callers is legitimate.
 */
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
  console.warn(
    [
      '⚠️  CORS_ORIGINS is not set and NODE_ENV=production.',
      `   Only ${allowedOrigins.join(', ')} will be accepted, and the local-origin`,
      '   fallback is disabled in production — every browser request from the',
      '   deployed frontend will be blocked, while /api/health still answers.',
      '   Set CORS_ORIGINS to the frontend origin(s).',
    ].join('\n')
  );
}

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
app.get('/api/hotels/search', getHotelSearchResults);

// Hotel Details Endpoints
app.get('/api/hotels/:id/price', getRoomPrices);
app.get('/api/hotels/:id', getHotelById);

// UC4 — Book & Make Payment
// Payment and lookup are throttled: without a limit these are a card-testing
// and reference-enumeration surface.
const paymentLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const lookupLimiter = rateLimit({ windowMs: 60_000, max: 30 });

/**
 * Looser than the lookups because quoting is what a guest does while making up
 * their mind — changing dates, adding a room, going back a page — and a limit
 * tuned for enumeration would throttle ordinary browsing.
 *
 * It exists at all because a quote can now reach the supplier. What actually
 * bounds that is hotelRoomService's cache: only a stay this server has not
 * priced before costs an outbound call, so re-quoting the same stay is free and
 * this limit is what caps the rate of *distinct* ones.
 */
const quoteLimiter = rateLimit({ windowMs: 60_000, max: 60 });

app.get('/api/bookings/checkout', quoteLimiter, getCheckout);

app.post('/api/bookings/guest-details', lookupLimiter, postGuestDetails);
/**
 * resolveUser, not requireUser: booking without an account is a supported flow,
 * so a request with no Authorization header is a guest checkout rather than an
 * error. What it does is make a *presented* token authoritative — the resulting
 * user_id comes from the verified subject and never from the request body.
 */
app.post('/api/bookings/payment', paymentLimiter, resolveUser, postPayment);
// Elements flow: returns a client secret instead of a redirect, so the card is
// entered on our own /payment page rather than on a Stripe-hosted one.
app.post('/api/bookings/payment-intent', paymentLimiter, resolveUser, postPaymentIntent);
/**
 * Its own limiter, not paymentLimiter.
 *
 * ConfirmationPage polls this up to MAX_POLLS times for a single booking while
 * a charge settles, so one customer legitimately spends several requests. At
 * the payment limiter's 10/min that left room for two guests a minute — and
 * fewer behind a NAT or a CGNAT address, where they share a bucket. A throttled
 * confirm is not a harmless retry either: the page treats 429 as neither paid
 * nor missing, burns its remaining attempts and shows an unreachable-service
 * error to someone whose card has already been charged.
 *
 * Raised rather than removed. The endpoint is still worth bounding — it takes a
 * payment identifier — but the bound has to clear the polling loop it was
 * throttling.
 */
const confirmLimiter = rateLimit({ windowMs: 60_000, max: 60 });

app.post('/api/bookings/confirm', confirmLimiter, postConfirmBooking);

// Literal segments before the wildcard. Registered the other way round,
// `/:id` matches "checkout" and "user" and routes them to the lookup handler —
// the same trap that makes /api/hotels/:id swallow /api/hotels/search.
// requireUser, not resolveUser: there is no anonymous reading of a booking
// history. getBookingsByUser then checks the verified subject against :userId.
app.get('/api/bookings/user/:userId', lookupLimiter, requireUser, getBookingsByUser);
app.get('/api/bookings/:id', lookupLimiter, getBookingById);

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

  const { supabaseAdmin } = await supabaseLib();
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

/**
 * Account deletion.
 *
 * This was unauthenticated: any caller who knew a UUID could permanently
 * delete that account, and the UUID is not a secret — it appears in the URL of
 * GET /api/bookings/user/:userId and in booking payloads. Deleting an auth user
 * cascades to their profile row, so this was the single most destructive
 * request the API accepted, from anyone.
 *
 * requireUser rejects an anonymous caller; the check below rejects a verified
 * one acting on somebody else's account. Both are needed — the token proves who
 * you are, not what you may delete. lookupLimiter caps the damage of a leaked
 * token being used to walk ids.
 */
app.delete('/api/users/:uid', lookupLimiter, requireUser, async (req, res) => {
  try {
    // Express 5 types a wildcard param as string | string[]; a repeated segment
    // would arrive as an array and must not be pattern-tested as one.
    const userId = typeof req.params.uid === 'string' ? req.params.uid : '';

    if (!userId || !UUID_PATTERN.test(userId)) {
      return res.status(400).json({ success: false, error: 'A valid user ID is required.' });
    }

    // 403 rather than 404: the caller is authenticated, just not entitled.
    if (req.auth?.userId !== userId) {
      return res.status(403).json({ success: false, error: 'You can only delete your own account.' });
    }

    const { deleteUser } = await supabaseLib();
    await deleteUser(userId);
    res.status(200).json({ success: true, message: 'User deleted successfully' });

  } catch (error: any) {
    /**
     * The message came straight from Supabase, which is how a caller learns
     * whether an id exists and what the admin API thinks of it. Log it, return
     * a correlation id.
     */
    const correlationId = `del_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    console.error(`[delete ${correlationId}] user deletion failed:`, error.message);
    res.status(500).json({ success: false, error: 'Could not delete that account.', correlationId });
  }
});

// Export for testing purposes
export default app;

// Only listen when run directly, so importing this in tests does not bind a port.
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] === __filename;
if (isDirectRun) {
  app.listen(Number(PORT), '0.0.0.0', () => {
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