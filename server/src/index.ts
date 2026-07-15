import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import {searchDestinations} from './controllers/destinationController';

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Base Verification Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', project: 'Transcenda Hotels Gateway Operational' });
});

// Destination Search Endpoint
app.get('/api/destinations/search', searchDestinations);

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
