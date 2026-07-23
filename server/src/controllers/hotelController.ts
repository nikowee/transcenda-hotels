import { type Request, type Response } from 'express';

const ROOM_PRICE_POLL_INTERVAL_MS = 1500;
const ROOM_PRICE_MAX_ATTEMPTS = 15;
const MAX_ATTEMPTS = 15; // ~22.5s worst case

import axios from 'axios';

const API_BASE_URL = process.env.HOTEL_ROOM_API_URL;

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
            const response = await axios.get<PricesResponse>(API_BASE_URL!, {
                params: { destination_id: destId, checkin, checkout, guests },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        // Gave up after MAX_ATTEMPTS — return whatever we last got (likely empty)
        res.status(504).json({ error: 'Hotel search timed out. Please try again.' });
    } catch (err) {
        console.error('Hotel prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel prices' });
    }
}

export async function getHotelById(req: Request, res: Response) {
    const { id } = req.params;

    try {
        const response = await axios.get(`${API_BASE_URL}/${id}`);
        res.json(response.data);
    } catch (err) {
        console.error('Hotel detail API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel details' });
    }
}

// Polling mechanism for room prices and availability

export async function getRoomPrices(req: Request, res: Response) {
    const { id } = req.params; // hotel id
    const { destination_id, checkin, checkout, guests, country_code, currency, lang } = req.query;

    if (!destination_id || !checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'destination_id, checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= ROOM_PRICE_MAX_ATTEMPTS; attempt++) {
            const response = await axios.get(`https://hotelapi.loyalty.dev/api/hotels/${id}/price`, {
                params: {
                    destination_id,
                    checkin,
                    checkout,
                    guests,
                    lang: lang ?? 'en_US',
                    currency: currency ?? 'SGD',
                    country_code: country_code ?? 'SG',
                    partner_id: 1089,
                    landing_page: 'wl-acme-earn',
                    product_type: 'earn',
                },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < ROOM_PRICE_MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        res.status(504).json({ error: 'Room search timed out. Please try again.' });
    } catch (err) {
        console.error('Room prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch room prices' });
    }
}