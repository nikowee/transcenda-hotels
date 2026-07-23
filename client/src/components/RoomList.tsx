import type { RoomOption } from '../types/room';

export default function RoomList({ rooms }: { rooms: RoomOption[] }) {
    if (rooms.length === 0) {
        return <p className="text-slate-400 text-center py-8">No rooms available for these dates.</p>;
    }

    return (
        <div className="space-y-4">
            {rooms.map((room) => {
                const heroImage = room.images.find((img) => img.hero_image) ?? room.images[0];

                return (
                    <div key={room.key} className="flex gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                        {heroImage && (
                            <img
                                src={heroImage.url}
                                alt={room.roomDescription}
                                className="h-28 w-40 object-cover rounded-lg flex-shrink-0"
                            />
                        )}
                        <div className="flex-1">
                            <h3 className="font-bold text-slate-700">{room.roomDescription}</h3>
                            <p className="text-xs text-slate-400">{room.rooms_available} rooms left</p>
                            {room.free_cancellation && (
                                <span className="text-xs text-green-600 font-medium">Free cancellation</span>
                            )}
                        </div>
                        <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-blue-600">
                                {room.converted_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                            <button className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">
                                Select
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}