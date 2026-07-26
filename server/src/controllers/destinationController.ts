import {type Request, type Response } from 'express';
import Fuse from 'fuse.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname is not defined in ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read once at boot rather than per request — the file is 8 MB.
const dataPath = path.resolve(__dirname, '../data/destinations.json');
const rawData = fs.readFileSync(dataPath, 'utf-8');
const destinations = JSON.parse(rawData);

const fuse = new Fuse(destinations, {
  keys: ['term'],
  threshold: 0.3,
});

export const searchDestinations = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;

    // Below 2 characters the fuzzy match returns most of the 74k dataset.
    if (!query || query.trim().length < 2) {
      res.json([]);
      return;
    }

    const fuseResults = fuse.search(query);
    const optimizedResults = fuseResults.map(result => result.item).slice(0, 5);

    res.json(optimizedResults);
  } catch (error) {
    console.error("Backend destination routing exception:", error);
    res.status(500).json({ error: "Internal server data compilation error" });
  }
};