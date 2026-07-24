import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router';
import axios from 'axios';
import { Star, MapPin, ChevronLeft, ChevronRight, ArrowLeft, ExternalLink } from 'lucide-react';
import LoadingPage from './LoadingPage';
import RoomList from '../components/RoomList';
import { amenityLabels } from '../lib/amenityLabels';
import { amenityIcons, fallbackAmenityIcon } from '../lib/amenityIcons';
import type { HotelDetail } from '../types/hotel';
import type { RoomOption } from '../types/room';

const API_URL = import.meta.env.VITE_API_URL;

export default function HotelDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
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
    const hasImages = galleryImages.length > 0;
    const visibleImages = galleryImages.slice(0, visibleCount);

    const amenityEntries = Object.entries(hotel.amenities).filter(([, present]) => present);

    // Guest rating (TrustYou overall is a 0-100 score -> show on a /10 scale)
    const overallScore = hotel.trustyou?.score?.overall;
    const guestRating = overallScore != null ? overallScore / 10 : null;

    const goToImage = (dir: number) =>
        setActiveImageIndex((i) => (i + dir + galleryImages.length) % galleryImages.length);

    return (
        <div className="min-h-screen w-full bg-white">
            {/* ===== HERO (dark, landing-page language) ===== */}
            <section className="relative h-[60vh] min-h-[420px] w-full overflow-hidden bg-slate-900">
                {hasImages && (
                    <img
                        src={galleryImages[activeImageIndex]}
                        alt={hotel.name}
                        className="absolute inset-0 h-full w-full object-cover"
                    />
                )}
                {/* Dark gradient for legible white text — echoes the landing hero */}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-slate-900/70" />

                {/* Nav — same brand mark as the landing page */}
                <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-6">
                    <Link to="/" className="text-2xl font-extrabold tracking-tight text-white">
                        Transcenda<span className="text-blue-500">.</span>
                    </Link>
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to results
                    </button>
                </nav>

                {/* Gallery arrows */}
                {hasImages && galleryImages.length > 1 && (
                    <>
                        <button
                            onClick={() => goToImage(-1)}
                            className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                            aria-label="Previous photo"
                        >
                            <ChevronLeft className="h-6 w-6" />
                        </button>
                        <button
                            onClick={() => goToImage(1)}
                            className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                            aria-label="Next photo"
                        >
                            <ChevronRight className="h-6 w-6" />
                        </button>
                    </>
                )}

                {/* Title block */}
                <div className="absolute bottom-0 left-0 right-0 z-10 mx-auto max-w-5xl px-6 pb-8">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }, (_, i) => (
                                <Star
                                    key={i}
                                    className={`h-5 w-5 ${
                                        i < Math.round(hotel.rating)
                                            ? 'fill-yellow-400 text-yellow-400'
                                            : 'text-white/30'
                                    }`}
                                />
                            ))}
                            <span className="ml-2 text-sm font-medium text-white/80">
                                {hotel.rating}-star hotel
                            </span>
                        </div>

                        {/* Guest rating badge */}
                        {guestRating != null && (
                            <div className="flex items-center gap-2 rounded-full bg-blue-600/90 px-3 py-1 backdrop-blur-sm">
                                <span className="text-sm font-bold text-white">
                                    {guestRating.toFixed(1)}
                                </span>
                                <span className="text-xs text-blue-100">
                                    Guest rating
                                    {hotel.number_reviews ? ` · ${hotel.number_reviews.toLocaleString()} reviews` : ''}
                                </span>
                            </div>
                        )}
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight text-white drop-shadow-sm md:text-5xl">
                        {hotel.name}
                    </h1>
                    <p className="mt-2 flex items-center gap-2 text-slate-200">
                        <MapPin className="h-4 w-4 text-blue-400" />
                        {hotel.address}
                    </p>
                </div>
            </section>

            {/* ===== Thumbnail strip ===== */}
            {hasImages && (
                <div className="mx-auto max-w-5xl px-6 pt-6">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {visibleImages.map((url, index) => (
                            <img
                                key={url}
                                src={url}
                                loading="lazy"
                                alt={`${hotel.name} photo ${index + 1}`}
                                onClick={() => setActiveImageIndex(index)}
                                className={`h-16 w-24 flex-shrink-0 cursor-pointer rounded-lg border-2 object-cover transition-colors ${
                                    index === activeImageIndex ? 'border-blue-600' : 'border-transparent'
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
                </div>
            )}

            {/* ===== Content ===== */}
            <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
                {/* Description */}
                <section>
                    <h2 className="mb-3 text-xl font-bold text-slate-800">About this hotel</h2>
                    <p className="whitespace-pre-line leading-relaxed text-slate-600">
                        {hotel.description}
                    </p>
                </section>

                {/* Amenities — icon + label, no card boxes */}
                {amenityEntries.length > 0 && (
                    <section>
                        <h2 className="mb-4 text-xl font-bold text-slate-800">Amenities</h2>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
                            {amenityEntries.map(([key]) => {
                                const Icon = amenityIcons[key] ?? fallbackAmenityIcon;
                                return (
                                    <div key={key} className="flex items-center gap-3 text-slate-700">
                                        <Icon className="h-5 w-5 flex-shrink-0 text-blue-600" />
                                        <span className="text-sm">{amenityLabels[key] ?? key}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Location map */}
                <section>
                    <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-slate-800">
                        <MapPin className="h-5 w-5 text-blue-600" />
                        Location
                    </h2>
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <iframe
                            title="Hotel location"
                            className="h-72 w-full"
                            loading="lazy"
                            src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                                hotel.longitude - 0.008
                            }%2C${hotel.latitude - 0.008}%2C${hotel.longitude + 0.008}%2C${
                                hotel.latitude + 0.008
                            }&layer=mapnik&marker=${hotel.latitude}%2C${hotel.longitude}`}
                        />
                    </div>
                    <a
                        href={`https://www.google.com/maps/search/?api=1&query=${hotel.latitude},${hotel.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
                    >
                        Open in Google Maps
                        <ExternalLink className="h-4 w-4" />
                    </a>
                </section>

                {/* Rooms (UC3b) */}
                <section>
                    <h2 className="mb-4 text-xl font-bold text-slate-800">Available rooms</h2>
                    {rooms === null ? (
                        <div className="flex items-center gap-3 py-8 text-slate-400">
                            <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-blue-600" />
                            Checking live room rates…
                        </div>
                    ) : (
                        <RoomList rooms={rooms} />
                    )}
                </section>
            </div>
        </div>
    );
}
