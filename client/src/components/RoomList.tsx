import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Users, ShieldCheck, Award } from 'lucide-react';
import type { RoomOption } from '../types/room';

export default function RoomList({ rooms, hotelName }: { rooms: RoomOption[]; hotelName?: string }) {
    const navigate = useNavigate();
    const { id } = useParams();
    const [searchParams] = useSearchParams();

    if (rooms.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center">
                <p className="text-slate-500">
                    No rooms available for this hotel on your selected dates.
                </p>
                <button
                    onClick={() => navigate(-1)}
                    className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                    Back to results
                </button>
            </div>
        );
    }

    const handleSelect = (room: RoomOption) => {
        const params = new URLSearchParams({
            hotel: id ?? '',
            dest: searchParams.get('dest') ?? '',
            in: searchParams.get('in') ?? '',
            out: searchParams.get('out') ?? '',
            guests: searchParams.get('guests') ?? '',
            key: room.key,
        });
        if (hotelName) params.set('name', hotelName);
        navigate(`/booking?${params.toString()}`);
    };

    return (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
            {rooms.map((room) => {
                const heroImage = room.images.find((img) => img.hero_image) ?? room.images[0];

                return (
                    <div key={room.key} className="flex flex-col gap-5 py-6 sm:flex-row">
                        {heroImage && (
                            <img
                                src={heroImage.url}
                                alt={room.roomDescription}
                                loading="lazy"
                                className="h-40 w-full flex-shrink-0 rounded-xl object-cover sm:h-32 sm:w-48"
                            />
                        )}

                        <div className="flex-1">
                            <h3 className="font-bold text-slate-800">{room.roomDescription}</h3>

                            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                                <Users className="h-3.5 w-3.5" />
                                {room.rooms_available} room{room.rooms_available === 1 ? '' : 's'} left
                            </p>

                            {room.free_cancellation && (
                                <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-green-600">
                                    <ShieldCheck className="h-4 w-4" />
                                    Free cancellation
                                </p>
                            )}

                            {room.amenities?.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {room.amenities.slice(0, 4).map((a) => (
                                        <span
                                            key={a}
                                            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500"
                                        >
                                            {a}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-shrink-0 flex-row items-end justify-between sm:flex-col sm:items-end sm:justify-start">
                            <div className="text-right">
                                <p className="text-2xl font-extrabold text-blue-600">
                                    S${room.converted_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </p>
                                <p className="text-xs text-slate-400">total for your stay</p>
                                {room.points > 0 && (
                                    <p className="mt-1 flex items-center justify-end gap-1 text-xs font-medium text-amber-600">
                                        <Award className="h-3.5 w-3.5" />
                                        Earn {room.points.toLocaleString()} pts
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => handleSelect(room)}
                                className="mt-0 rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700 sm:mt-3"
                            >
                                Select
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
