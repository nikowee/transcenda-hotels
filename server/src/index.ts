import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import {searchDestinations} from './controllers/destinationController';
import {
  getCheckout,
  postGuestDetails,
  postPayment,
  postConfirmBooking,
  getBookingByReference,
} from './controllers/bookingController.js';
import { supabaseAdmin } from './lib/supabaseClient';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Base Verification Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

// Destination Search Endpoint
app.get('/api/destinations/search', searchDestinations);

// UC4 — Book & Make Payment
app.get('/api/bookings/checkout', getCheckout);
app.post('/api/bookings/guest-details', postGuestDetails);
app.post('/api/bookings/payment', postPayment);
app.post('/api/bookings/confirm', postConfirmBooking);
app.get('/api/bookings/:reference', getBookingByReference);

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
