import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import axios from 'axios';
import Navbar from '../components/Navbar';
import HotelCard from '../components/hotels/HotelCard';
import Pagination from '../components/hotels/Pagination';
import FilterPanel from '../components/hotels/FilterPanel';
import SortDropdown from '../components/hotels/SortDropdown';
import type { Hotel, SearchResponse, SearchFilters } from '../types';

export default function ResultsPage() {
    const [hotels, setHotels] = useState<Hotel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(10);

    // ── Filter & Sort State ──
    const [filters, setFilters] = useState<SearchFilters>({
        starRating: null,
        minGuestRating: null,
        minPrice: null,
        maxPrice: null,
    });
    const [sortBy, setSortBy] = useState('searchRank_asc');
    const [appliedFilters, setAppliedFilters] = useState<SearchFilters>({
        starRating: null,
        minGuestRating: null,
        minPrice: null,
        maxPrice: null,
    });

    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const destinationId = searchParams.get('dest') as string;
    const destinationName = searchParams.get('name') || destinationId;
    const checkin = searchParams.get('in');
    const checkout = searchParams.get('out');
    const guests = searchParams.get('guests') || '1';
    const rooms = searchParams.get('rooms') || '1';

    // ── Validate required params ──
    useEffect(() => {
        if (!destinationId || !checkin || !checkout || !guests) {
            setError('Missing search parameters. Please go back and search again.');
            setLoading(false);
        }
    }, [destinationId, checkin, checkout, guests]);

    // ── Fetch hotels ──
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
                        starRating: appliedFilters.starRating,
                        minGuestRating: appliedFilters.minGuestRating,
                        minPrice: appliedFilters.minPrice,
                        maxPrice: appliedFilters.maxPrice,
                        sortBy,
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
    }, [destinationId, checkin, checkout, guests, rooms, currentPage, pageSize, appliedFilters, sortBy]);

    // ── Filter handlers ──
    const handleApplyFilters = () => {
        setAppliedFilters(filters);
        setCurrentPage(1);
    };

    const handleClearFilters = () => {
        const emptyFilters: SearchFilters = {
            starRating: null,
            minGuestRating: null,
            minPrice: null,
            maxPrice: null,
        };
        setFilters(emptyFilters);
        setAppliedFilters(emptyFilters);
        setCurrentPage(1);
    };

    const handleSelectHotel = (hotelId: string) => {
        navigate(`/hotel/${hotelId}?dest=${destinationId}&name=${encodeURIComponent(destinationName)}&in=${checkin}&out=${checkout}&guests=${guests}&rooms=${rooms}`);
    };

    // ── Error state ──
    if (error) {
        return (
            <div className="min-h-screen bg-brand-surface flex items-center justify-center p-4">
                <Navbar showBackButton showSearchBar />
                <div className="bg-brand-surface-soft rounded-xl shadow-lg p-8 max-w-md w-full text-center mt-20">
                    <div className="text-4xl mb-4">😅</div>
                    <h2 className="text-xl font-semibold text-brand-text-primary mb-2">Oops!</h2>
                    <p className="text-brand-text-secondary mb-4">{error}</p>
                    <button
                        onClick={() => navigate('/')}
                        className="px-4 py-2 bg-brand-accent-dark text-white rounded-lg hover:bg-brand-accent transition"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    // ── Loading state ──
    if (loading) {
        return (
            <div className="min-h-screen bg-brand-surface">
                <Navbar showBackButton showSearchBar />
                <div className="px-6 lg:px-10 pt-28">
                    <div className="bg-brand-surface-soft rounded-xl p-6 mb-6 animate-pulse">
                        <div className="h-6 bg-brand-surface-muted rounded w-1/3 mb-2" />
                        <div className="h-4 bg-brand-surface-muted rounded w-1/2" />
                    </div>
                    <div className="space-y-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="bg-brand-surface-soft rounded-xl p-4 animate-pulse">
                                <div className="flex gap-4">
                                    <div className="w-48 h-32 bg-brand-surface-muted rounded-lg" />
                                    <div className="flex-1 space-y-3">
                                        <div className="h-5 bg-brand-surface-muted rounded w-1/3" />
                                        <div className="h-4 bg-brand-surface-muted rounded w-1/4" />
                                        <div className="h-4 bg-brand-surface-muted rounded w-1/2" />
                                        <div className="h-8 bg-brand-surface-muted rounded w-24 mt-2" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ── Main render ──
    return (
        <div className="min-h-screen bg-brand-surface">
            {/* Background gradient – matches landing page */}
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-brand-surface to-black pointer-events-none z-0" />

            <div className="relative z-10">
                {/* Shared Navbar with back button + search bar */}
                <Navbar showBackButton showSearchBar />

                {/* Page content – full width with generous side padding */}
                <div className="px-6 lg:px-10 pt-28 pb-16">
                    {/* ── Search Summary ── */}
                    <div className="bg-brand-surface-soft/80 backdrop-blur-sm rounded-xl border border-brand-glass-border p-6 mb-6">
                        <h1 className="text-2xl font-bold text-brand-text-primary">
                            Hotels in {destinationName}
                        </h1>
                        <p className="text-brand-text-secondary mt-1">
                            {total} hotels found · {guests} guest{parseInt(guests) > 1 ? 's' : ''} · {rooms} room{parseInt(rooms) > 1 ? 's' : ''}
                        </p>
                        <p className="text-sm text-brand-text-muted mt-0.5">
                            {checkin} → {checkout}
                        </p>
                    </div>

                    {/* ── Filter Panel + Results ── */}
                    <div className="flex flex-col lg:flex-row gap-8">
                        {/* ── Filter Panel ── */}
                        <div className="lg:w-80 flex-shrink-0">
                            <FilterPanel
                                filters={filters}
                                onFilterChange={setFilters}
                                onApply={handleApplyFilters}
                                onClear={handleClearFilters}
                            />
                        </div>

                        {/* ── Results ── */}
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
                                <p className="text-sm text-brand-text-muted">
                                    {hotels.length} hotels shown · {total} total
                                    {appliedFilters.starRating !== null && ` · ${appliedFilters.starRating}★`}
                                    {appliedFilters.minGuestRating !== null && ` · ${appliedFilters.minGuestRating}+ rating`}
                                </p>
                                <SortDropdown value={sortBy} onChange={setSortBy} />
                            </div>

                            {hotels.length === 0 ? (
                                <div className="bg-brand-surface-soft rounded-xl border border-brand-glass-border p-12 text-center">
                                    <div className="text-4xl mb-4">🔍</div>
                                    <h2 className="text-xl font-semibold text-brand-text-primary mb-1">No hotels match your filters</h2>
                                    <p className="text-brand-text-muted">Try adjusting your filter criteria</p>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-5">
                                        {hotels.map((hotel) => (
                                            <HotelCard
                                                key={hotel.id}
                                                hotel={hotel}
                                                onSelect={() => handleSelectHotel(hotel.id)}
                                            />
                                        ))}
                                    </div>

                                    {totalPages > 1 && (
                                        <div className="mt-8 flex justify-center">
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
                </div>
            </div>
        </div>
    );
}