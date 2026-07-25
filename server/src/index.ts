import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { searchDestinations } from './controllers/destinationController.ts';
import { getHotelById, getHotelPrices, getRoomPrices, getHotelSearchResults } from './controllers/hotelController.ts';
import { supabaseAdmin, deleteUser } from './lib/supabaseClient.ts';

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
app.get('/api/hotels/search', getHotelSearchResults);

// Hotel Details Endpoints
app.get('/api/hotels/:destId/prices', getHotelPrices);
app.get('/api/hotels/:id/price', getRoomPrices);
app.get('/api/hotels/:id', getHotelById);

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

// Supabase delete endpoint
app.delete('/api/users/:uid', async (req, res) => {
  try {
    const userId = req.params.uid; 
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is missing.' });
    }

    await deleteUser(userId);    
    res.status(200).json({ success: true, message: 'User deleted successfully' });
    
  } catch (error: any) {
    console.error('Delete error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export for testing purposes
export default app;

// Only start server if this file is run directly (not imported in tests)
const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] === __filename;
if (isDirectRun) {
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Transcenda Hotels Backend running natively on http://localhost:${PORT}`);
  });
}