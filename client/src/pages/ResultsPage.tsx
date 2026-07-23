import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import axios from 'axios';
import HotelCard from '../components/hotels/HotelCard';
import Pagination from '../components/hotels/Pagination';

// Types
interface Hotel {
    id: string;
    name: string;
    price: number;
    searchRank: number;
    rating: number;
    categories: string[];
    address: string;
    latitude: number;
    longitude: number;
    description: string;
    amenities: string[];
    images: string[];
}

interface SearchResponse {
    hotels: Hotel[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export default function ResultsPage() {
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(10);

  // ── 2. Get URL params from Feature 1 ──
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const destinationId = searchParams.get('dest');
  const checkin = searchParams.get('in');
  const checkout = searchParams.get('out');
  const guests = searchParams.get('guests');
  const rooms = searchParams.get('rooms') || '1';

  // ── 3. Validate that we have required params ──
  useEffect(() => {
    if (!destinationId || !checkin || !checkout || !guests) {
      setError('Missing search parameters. Please go back and search again.');
      setLoading(false);
    }
  }, [destinationId, checkin, checkout, guests]);

  // ── 4. Fetch hotels when page or params change ──
  useEffect(() => {
    const fetchHotels = async () => {
      if (!destinationId || !checkin || !checkout || !guests) return;

      setLoading(true);
      setError(null);

      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        const response = await axios.get<SearchResponse>(`${API_URL}/api/hotels/search`, {
          params: {
            destination_id: destinationId,
            checkin,
            checkout,
            guests,
            rooms,
            page: currentPage,
            pageSize,
          },
        });

        setHotels(response.data.hotels);
        setTotal(response.data.total);
        setTotalPages(response.data.totalPages);
      } catch (err: any) {
        console.error('❌ Error fetching hotels:', err);
        setError(err.response?.data?.error || 'Failed to load hotels. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchHotels();
  }, [destinationId, checkin, checkout, guests, rooms, currentPage, pageSize]);

  // ── 5. Handle hotel selection (go to Feature 3) ──
  const handleSelectHotel = (hotelId: string) => {
    navigate(`/hotel/${hotelId}?in=${checkin}&out=${checkout}&guests=${guests}&rooms=${rooms}`);
  };

  // ── 6. Render states ──

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">😅</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Oops!</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Search summary skeleton */}
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6 animate-pulse">
            <div className="h-6 bg-slate-200 rounded w-1/3 mb-2" />
            <div className="h-4 bg-slate-200 rounded w-1/2" />
          </div>

          {/* Hotel cards skeleton */}
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
                <div className="flex gap-4">
                  <div className="w-48 h-32 bg-slate-200 rounded-lg" />
                  <div className="flex-1 space-y-3">
                    <div className="h-5 bg-slate-200 rounded w-1/3" />
                    <div className="h-4 bg-slate-200 rounded w-1/4" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                    <div className="h-8 bg-slate-200 rounded w-24 mt-2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── 7. Main render ──
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* ── Search Summary ── */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-slate-800">
            Hotels in {destinationId}
          </h1>
          <p className="text-slate-500">
            {total} hotels found · {guests} guest{parseInt(guests) > 1 ? 's' : ''} · {rooms} room{parseInt(rooms) > 1 ? 's' : ''}
          </p>
          <p className="text-sm text-slate-400">
            {checkin} → {checkout}
          </p>
        </div>

        {/* ── Hotel List ── */}
        {hotels.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="text-4xl mb-4">🏨</div>
            <h2 className="text-xl font-semibold text-slate-700">No hotels found</h2>
            <p className="text-slate-500">Try adjusting your search criteria</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {hotels.map((hotel) => (
                <HotelCard
                  key={hotel.id}
                  hotel={hotel}
                  onSelect={() => handleSelectHotel(hotel.id)}
                />
              ))}
            </div>

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="mt-6 flex justify-center">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}