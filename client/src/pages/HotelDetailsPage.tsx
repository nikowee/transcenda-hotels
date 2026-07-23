import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import axios from 'axios';
import LoadingPage from './LoadingPage';
import type { HotelDetail } from '../types/hotel';

const API_URL = import.meta.env.VITE_API_URL;

export default function HotelDetailPage() {
    const { id } = useParams();
    const [hotel, setHotel] = useState<HotelDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;

        axios.get(`${API_URL}/api/hotels/${id}`)
            .then((res) => setHotel(res.data))
            .catch(() => setError('Failed to load hotel details.'));
    }, [id]);

    if (error) return <p className="text-center text-red-500 mt-12">{error}</p>;
    if (!hotel) return <LoadingPage/>;

    const heroImage = `${hotel.image_details.prefix}0${hotel.image_details.suffix}`;
    const amenitiesList = Object.entries(hotel.amenities)
        .filter(([, present]) => present)
        .map(([key]) => key);

    return (
        <div className="min-h-screen bg-slate-50 p-6 max-w-4xl mx-auto space-y-4">
            <img src={heroImage} alt={hotel.name} className="w-full h-64 object-cover rounded-xl" />
            <h1 className="text-3xl font-bold text-slate-700">{hotel.name}</h1>
            <p className="text-slate-400">{hotel.address}</p>
            <p className="text-blue-600 font-semibold">⭐ {hotel.rating}</p>
            <p className="text-slate-600 whitespace-pre-line">{hotel.description}</p>

            <div className="flex flex-wrap gap-2">
                {amenitiesList.map((a) => (
                    <span key={a} className="text-xs bg-slate-100 rounded-full px-3 py-1 text-slate-600">
                        {a}
                    </span>
                ))}
            </div>
        </div>
    );
}