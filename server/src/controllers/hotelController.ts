import { type Request, type Response } from 'express';
import axios from 'axios';

const API_KEY = process.env.API_KEY!;

export async function getHotelsByDestination(req: Request, res: Response) {
    const { destId } = req.params;

    try {
        const response = await axios.get(`${API_KEY}hotels?destination_id=${destId}`, {
            params: { destination_id: destId },
            headers: { Authorization: `Bearer ${API_KEY}` },
        });
        res.json(response.data);
    } catch (err) {
        console.error('Hotels API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotels' });
    }
}