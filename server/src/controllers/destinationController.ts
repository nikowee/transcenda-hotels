import {type Request, type Response } from 'express';
import Fuse from 'fuse.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirnname (Not included in ES Modules by default)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the destination.json file once upon initial server boot
const dataPath = path.resolve(__dirname, '../data/destinations.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const destinations = JSON.parse(rawData);

// Fuzzy seaching using Fuse
const fuse = new Fuse(destinations, {
  keys: ['term'],
  threshold: 0.3,
});

/** Safety guardrail: fuse.search is synchronous and scales with the pattern, so an uncapped 5,000-character query blocked the event loop for 65s. The longest real term is 115 characters. */
const MAX_QUERY_LENGTH = 128;

export const searchDestinations = async (req: Request, res: Response): Promise<void> => {
  try {
    // Repeated ?q= gives an array, whose .trim() is not a function.
    const query = typeof req.query.q === 'string' ? req.query.q : '';

    // Safety guardrail: Return empty if they haven't typed enough keys
    if (!query || query.trim().length < 2) {
      res.json([]);
      return;
    }

    const fuseResults = fuse.search(query.slice(0, MAX_QUERY_LENGTH));
    
    // 4. Transform payload to return only top 5 matching items, keeping network payload small
    const optimizedResults = fuseResults.map(result => result.item).slice(0, 5);
    
    res.json(optimizedResults);
  } catch (error) {
    console.error("Backend destination routing exception:", error);
    res.status(500).json({ error: "Internal server data compilation error" });
  }
};