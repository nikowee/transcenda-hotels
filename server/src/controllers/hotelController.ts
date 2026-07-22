import { type Request, type Response } from 'express';
import axios from 'axios';

const API_URL = process.env.PRICES_API_URL!;
const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 15; // ~22.5s worst case

interface PricesResponse {
    completed: boolean;
    currency: string;
    hotels: unknown[];
}

export async function getHotelPrices(req: Request, res: Response) {
    const { destId } = req.params;
    const { checkin, checkout, guests } = req.query;

    if (!checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const response = await axios.get<PricesResponse>(API_URL, {
                params: { destination_id: destId, checkin, checkout, guests },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            }
        }

        // Gave up after MAX_ATTEMPTS — return whatever we last got (likely empty)
        res.status(504).json({ error: 'Hotel search timed out. Please try again.' });
    } catch (err) {
        console.error('Hotel prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel prices' });
    }
}