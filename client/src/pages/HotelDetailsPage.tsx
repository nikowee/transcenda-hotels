import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import axios from 'axios';
import LoadingPage from './LoadingPage';
import type { HotelDetail } from '../types/hotel';
import { amenityLabels } from '../lib/amenityLabels';
import RoomList from '../components/RoomList';
import type { RoomOption } from '../types/room';

const API_URL = import.meta.env.VITE_API_URL;





export default function HotelDetailPage() {
    const { id } = useParams();
    const [hotel, setHotel] = useState<HotelDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [visibleCount, setVisibleCount] = useState(12);

    const [searchParams] = useSearchParams();
    const destId = searchParams.get('dest');
    const checkIn = searchParams.get('in');
    const checkOut = searchParams.get('out');
    const guests = searchParams.get('guests');

    const [rooms, setRooms] = useState<RoomOption[] | null>(null);

    useEffect(() => {
        if (!id || !destId || !checkIn || !checkOut || !guests) return;

        axios.get(`${API_URL}/api/hotels/${id}/price`, {
            params: { destination_id: destId, checkin: checkIn, checkout: checkOut, guests },
        })
            .then((res) => setRooms(res.data.rooms))
            .catch(() => setRooms([]));
    }, [id, destId, checkIn, checkOut, guests]);

    useEffect(() => {
        if (!id) return;

        axios.get(`${API_URL}/api/hotels/${id}`)
            .then((res) => setHotel(res.data))
            .catch(() => setError('Failed to load hotel details.'));
    }, [id]);

    if (!hotel) return <LoadingPage error={error} />;

    const galleryImages = Array.from(
        { length: hotel.image_details.count },
        (_, i) => `${hotel.image_details.prefix}${i}${hotel.image_details.suffix}`
    );
    const amenitiesList = Object.entries(hotel.amenities)
        .filter(([, present]) => present)
        .map(([key]) => amenityLabels[key] ?? key);
    // fallback to raw key if not in map
    // update the map in lib/amenityLabels.ts if you want to add more human-readable labels
    const visibleImages = galleryImages.slice(0, visibleCount);




    return (
        <div className="min-h-screen bg-slate-50 p-6 max-w-4xl mx-auto space-y-4">
            {/* Main Image and Gallery */}
            {/* Worth noting: there is no caching of images handled by the CDN */}
            {/* If image loading becomes slow, may consider Proxy + cache the images via server routing */}
            <img src={galleryImages[activeImageIndex]} alt={hotel.name} className="w-full h-64 object-cover rounded-xl" />
            <div className="flex gap-2 overflow-x-auto pb-2">
                {visibleImages.map((url, index) => (
                    <img
                        key={url}
                        src={url}
                        loading="lazy"
                        alt={`${hotel.name} photo ${index + 1}`}
                        onClick={() => setActiveImageIndex(index)}
                        className={`h-16 w-24 object-cover rounded-lg cursor-pointer flex-shrink-0 border-2 transition-colors ${index === activeImageIndex ? 'border-blue-600' : 'border-transparent'
                            }`}
                    />
                ))}

                {visibleCount < galleryImages.length && (
                    <button
                        onClick={() => setVisibleCount((c) => c + 12)}
                        className="h-16 w-24 flex-shrink-0 rounded-lg bg-slate-100 text-xs text-slate-500 hover:bg-slate-200"
                    >
                        +{galleryImages.length - visibleCount} more
                    </button>
                )}
            </div>
            <h1 className="text-3xl font-bold text-slate-700">{hotel.name}</h1>
            <p className="text-slate-400">{hotel.address}</p>
            <p className="text-blue-600 font-semibold">⭐ {hotel.rating}</p>
            {/* Clean up of the text can be done using html-to-text https://www.npmjs.com/package/html-to-text */}
            <p className="text-slate-600 whitespace-pre-line">{hotel.description}</p>

            {/* Adding icons can be done using lucid react https://lucide.dev/guide/react/getting-started */}
            <div className="flex flex-wrap gap-2">
                {amenitiesList.map((label) => (
                    <span key={label} className="text-xs bg-slate-100 rounded-full px-3 py-1 text-slate-600">
                        {label}
                    </span>
                ))}
            </div>

            <h2 className="text-xl font-bold text-slate-700 mt-6">Available Rooms</h2>
            {rooms === null ? (
                <p className="text-slate-400">Loading rooms...</p>
            ) : (
                <RoomList rooms={rooms} />
            )}
        </div>

    );
}