import { type Request, type Response } from 'express';
import axios from 'axios';

const API_BASE_URL = process.env.HOTEL_ROOM_API_URL;

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