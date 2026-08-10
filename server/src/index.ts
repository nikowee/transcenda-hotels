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
 * Lazy import, deliberately: supabaseClient throws at module scope when the
 * env vars are absent, and the server must still boot on the in-memory store
 * with no database — a supported mode.  Only the two routes that need the
 * client pay for it.
 */
const supabaseLib = () => import('./lib/supabaseClient.js');
import { isSupabaseConfigured } from './models/bookingModel.js';
// Already loaded transitively via hotelController; imported here only so
// shutdown can release the connection after the HTTP listener drains.
import { redis } from './lib/redisClient.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * One proxy hop is trusted when resolving req.ip.  Every rate limiter keys on
 * req.ip, so this figure decides whether they throttle a caller or the whole
 * internet.
 */
app.set('trust proxy', 1);

/** Version-agnostic: a lookup id is not the place to enforce a UUID version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Restrict to known origins; a bare cors() allows every site to call these APIs.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Safety guardrail: warn loudly when production forgot CORS_ORIGINS — an unset
 * value refuses every browser request from the real frontend while /api/health
 * keeps answering (no Origin header), leaving a service that looks healthy
 * from the backend and empty from the UI.  A warning, not fatal: a deployment
 * serving only non-browser callers is legitimate.
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
 * Accept any loopback or private-range origin outside production — Vite serves
 * the same app on localhost, 127.0.0.1 and the LAN address, Docker adds more,
 * and pinning one spelling silently breaks the rest (the browser drops the
 * response and the UI just looks empty).
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
 * Looser than the lookup limits: quoting is what a guest does while making up
 * their mind, and a limit tuned for enumeration would throttle ordinary
 * browsing.  hotelRoomService's cache makes re-quoting the same stay free —
 * this caps the rate of distinct ones, which are what reach the supplier.
 */
const quoteLimiter = rateLimit({ windowMs: 60_000, max: 60 });

app.get('/api/bookings/checkout', quoteLimiter, getCheckout);

app.post('/api/bookings/guest-details', lookupLimiter, postGuestDetails);
/**
 * resolveUser, not requireUser: guest checkout is a supported flow, so a
 * request with no Authorization header proceeds — but a presented token
 * becomes authoritative, and user_id comes from the verified subject, never
 * the request body.
 */
app.post('/api/bookings/payment', paymentLimiter, resolveUser, postPayment);
// Elements flow: returns a client secret instead of a redirect, so the card is
// entered on our own /payment page rather than on a Stripe-hosted one.
app.post('/api/bookings/payment-intent', paymentLimiter, resolveUser, postPaymentIntent);
/**
 * Its own limiter, not paymentLimiter: ConfirmationPage legitimately polls
 * several times per booking while a charge settles, and a throttled confirm
 * shows an unreachable-service error to someone already charged.  Still
 * bounded — the endpoint takes a payment identifier — but the bound clears the
 * polling loop.
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
 * Account deletion — the most destructive request this API accepts, since
 * deleting an auth user cascades to their profile row.  Two checks, both
 * needed: requireUser rejects an anonymous caller, and the ownership check
 * below rejects a verified one acting on somebody else's account — the token
 * proves who you are, not what you may delete.
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
  const server = app.listen(Number(PORT), '0.0.0.0', () => {
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

  /**
   * Graceful shutdown, on the signal orchestrators actually send.  ECS,
   * Kubernetes and `docker stop` all deliver SIGTERM and wait; unhandled, Node
   * dies mid-request — including a confirm that has captured money but not yet
   * written the booking row, which is the one request this server must never
   * drop.
   */
  const shutdown = (signal: string) => {
    console.log(`${signal} received, draining connections…`);
    const force = setTimeout(() => {
      console.error('Drain timed out, exiting.');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async () => {
      try {
        await redis.destroy();
        console.log('🔌 Redis disconnected');
      } catch {
        // Already down — nothing left to release.
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}