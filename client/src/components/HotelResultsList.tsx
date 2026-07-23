import { useNavigate } from 'react-router';

interface Hotel {
    id: string;
    name: string;
    imageUrl: string;
    pricePerNight: number;
    rating: number;
    address: string;
}

interface HotelResultsListProps {
    hotels: Hotel[];
    destId: string;
    checkIn: string;
    checkOut: string;
    guests: string;
}

export default function HotelResultsList({ hotels, destId, checkIn, checkOut, guests }: HotelResultsListProps) {
    const navigate = useNavigate();

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
                <div
                    key={hotel.id}
                    onClick={() => navigate(`/hotel/${hotel.id}?dest=${destId}&in=${checkIn}&out=${checkOut}&guests=${guests}`)}
                    className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                >
                    <img src={hotel.imageUrl} alt={hotel.name} className="h-40 w-full object-cover" />
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