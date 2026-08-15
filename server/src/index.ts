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
// Safe at module scope: only our own supabaseClient throws without env vars.
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
/** Lazy import, deliberately: supabaseClient throws at module scope when the env vars are absent, and the server must still boot on the in-memory store with no database. */
const supabaseLib = () => import('./lib/supabaseClient.js');
import { isSupabaseConfigured, anonymiseBookingsForUser } from './models/bookingModel.js';
// Already loaded transitively via hotelController; imported here only so
// shutdown can release the connection after the HTTP listener drains.
import { redis } from './lib/redisClient.js';
import { emailConfigStatus, whenSendsSettled } from './services/emailService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/** One proxy hop is trusted when resolving req.ip. */
app.set('trust proxy', 1);

/** Version-agnostic: a lookup id is not the place to enforce a UUID version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Restrict to known origins; a bare cors() allows every site to call these APIs.
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Safety guardrail: exactly one email var set is always a misconfiguration, and production provisions the two through different channels. */
{
  const email = emailConfigStatus();
  if (email.missing) {
    console.warn(
      `⚠️  ${email.missing} is not set but its counterpart is. Confirmation emails ` +
        'need both RESEND_API_KEY and EMAIL_FROM; falling back to log-only delivery.'
    );
  }
}

/** Safety guardrail: warn loudly when production forgot CORS_ORIGINS. */
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

/** Accept any loopback or private-range origin outside production. */
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
// Only relax limits for Docker-based E2E runs, never for the Mocha
// suite (which runs this file directly and needs real limits to test
// against) and never in production.
const relaxRateLimits = process.env.RATE_LIMIT_RELAXED === 'true';
const rateLimitMultiplier = relaxRateLimits ? 20 : 1;
const paymentLimiter = rateLimit({ windowMs: 60_000, max: 10 * rateLimitMultiplier });
const lookupLimiter = rateLimit({ windowMs: 60_000, max: 30 * rateLimitMultiplier });

/** Looser than the lookup limits: quoting is what a guest does while making up their mind, and a limit tuned for enumeration would throttle ordinary browsing. */
const quoteLimiter = rateLimit({ windowMs: 60_000, max: 60 });

app.get('/api/bookings/checkout', quoteLimiter, getCheckout);

app.post('/api/bookings/guest-details', lookupLimiter, postGuestDetails);
/** resolveUser, not requireUser: guest checkout is a supported flow, so a request with no Authorization header proceeds. */
app.post('/api/bookings/payment', paymentLimiter, resolveUser, postPayment);
// Elements flow: returns a client secret instead of a redirect, so the card is
// entered on our own /payment page rather than on a Stripe-hosted one.
app.post('/api/bookings/payment-intent', paymentLimiter, resolveUser, postPaymentIntent);
/** Its own limiter, not paymentLimiter: ConfirmationPage legitimately polls several times per booking while a charge settles, and a throttled confirm shows an unreachable-service error to someone already charged. */
const confirmLimiter = rateLimit({ windowMs: 60_000, max: 60 });

app.post('/api/bookings/confirm', confirmLimiter, postConfirmBooking);

// Literal segments before the wildcard. Registered the other way round,
// `/:id` matches "checkout" and "user" and routes them to the lookup handler —
// the same trap that makes /api/hotels/:id swallow /api/hotels/search.
// requireUser, not resolveUser: there is no anonymous reading of a booking
// history. getBookingsByUser then checks the verified subject against :userId.
app.get('/api/bookings/user/:userId', lookupLimiter, requireUser, getBookingsByUser);
app.get('/api/bookings/:id', lookupLimiter, getBookingById);

/** Bounded: the admin API is one hop away, and a request already holding partial erasure must not hang. */
const DELETE_USER_ATTEMPTS = 3;
const DELETE_USER_RETRY_MS = 250;

/**
 * Account deletion — the most destructive request this API accepts. The
 * profiles row is deleted explicitly rather than trusted to an ON DELETE
 * CASCADE from auth.users: no migration on this branch defines it and it has
 * not been verified against the deployed database.
 */
app.delete('/api/users/:uid', lookupLimiter, requireUser, async (req, res) => {
  // Outside the try so the catch can report how far the erasure got.
  let anonymised = 0;
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

    // Personal data first, account second. A booking keeps the guest's name,
    // email and phone, so deleting only the auth user leaves all of it behind
    // — and if this order were reversed and the erasure then failed, the owner
    // could no longer authenticate to retry, stranding the data permanently.
    anonymised = await anonymiseBookingsForUser(userId);

    const { deleteUser, supabaseAdmin } = await supabaseLib();

    // Strictly after anonymisation: bookings.user_id cascades from profiles,
    // so deleting the row while bookings still pointed at it would take the
    // accounting records with it. The in-memory store has no database, hence
    // no profiles table to clear.
    if (isSupabaseConfigured()) {
      const { error } = await supabaseAdmin.from('profiles').delete().eq('id', userId);
      if (error) throw new Error(`Profile deletion failed: ${error.message}`);
    }

    // Retried because by now the erasure is committed and cannot be undone;
    // only outages and 5xx are retried, an admin-API rejection is not.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await deleteUser(userId);
        break;
      } catch (error) {
        if (attempt >= DELETE_USER_ATTEMPTS || !isAuthRetryableFetchError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, DELETE_USER_RETRY_MS));
      }
    }

    console.log(`Account ${userId} deleted; ${anonymised} booking(s) anonymised.`);
    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      bookingsAnonymised: anonymised,
    });

  } catch (error: any) {
    /** The message came straight from Supabase, which is how a caller learns whether an id exists and what the admin API thinks of it. */
    const correlationId = `del_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    // Status too: a Response body stringifies to "{}", which is all the message holds for a 5xx.
    console.error(
      `[delete ${correlationId}] user deletion failed (bookings anonymised: ${anonymised}, status: ${error?.status ?? 'n/a'}):`,
      error?.message ?? error
    );
    // A generic message would imply nothing changed. Once bookings are
    // anonymised the account is still live but its history is gone, and the
    // only way to a consistent state is to retry.
    res.status(500).json({
      success: false,
      error:
        anonymised > 0
          ? 'Your booking history was erased but the account could not be removed; please retry.'
          : 'Could not delete that account.',
      correlationId,
      bookingsAnonymised: anonymised,
    });
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

  /** Graceful shutdown, on the signal orchestrators actually send. */
  const shutdown = (signal: string) => {
    console.log(`${signal} received, draining connections…`);
    const force = setTimeout(() => {
      console.error('Drain timed out, exiting.');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async () => {
      // Emails are fired without awaiting the request; a deploy would otherwise eat them.
      await whenSendsSettled();
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