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

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin and non-browser callers (curl, health checks) send no Origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by CORS'));
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

// Base Verification Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

// Destination Search Endpoint
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

// Supabase test endpoint (for debugging)
app.get('/api/supabase-test', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .limit(1);
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export for testing purposes
export default app;

// Only start server if this file is run directly (not imported in tests)
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] === __filename;
if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`🚀 Transcenda Hotels Backend running natively on http://localhost:${PORT}`);
  });
}
