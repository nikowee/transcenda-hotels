interface Hotel {
    id: string;
    name: string;
    pricePerNight: number;
    rating: number;
    address: string;
}

interface HotelResultsListProps {
    hotels: Hotel[];
}

export default function HotelResultsList({ hotels }: HotelResultsListProps) {
    if (hotels.length === 0) {
        return (
            <div className="text-center py-12 text-slate-400">
                No hotels found for your search. Try different dates or destination.
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {hotels.map((hotel) => (
                <div key={hotel.id} className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <div className="p-4 space-y-1">
                        <h3 className="font-bold text-slate-700">{hotel.name}</h3>
                        <p className="text-sm text-slate-400">{hotel.address}</p>
                        <p className="text-blue-600 font-semibold">${hotel.pricePerNight} / night</p>
                    </div>
                </div>
            ))}
        </div>
    );
}