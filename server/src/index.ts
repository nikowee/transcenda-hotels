// JUST A RANDOM PLACERHOLDER FOR NOW FOR TESTING. SHUUSH!
import express from 'express';
import cors from 'cors';
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

app.listen(PORT, () => {
  console.log(`🚀 Transcenda Hotels Backend running natively on http://localhost:${PORT}`);
});