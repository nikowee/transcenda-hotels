import type { SearchFilters } from '../../types';

interface FilterPanelProps {
    filters: SearchFilters;
    onFilterChange: (filters: SearchFilters) => void;
    onApply: () => void;
    onClear: () => void;
}

export default function FilterPanel({
    filters,
    onFilterChange,
    onApply,
    onClear,
}: FilterPanelProps) {
    const handleStarChange = (rating: number | null) => {
        onFilterChange({ ...filters, starRating: rating });
    };

    const handleGuestRatingChange = (rating: number | null) => {
        onFilterChange({ ...filters, minGuestRating: rating });
    };

    const handlePriceChange = (field: 'minPrice' | 'maxPrice', value: string) => {
        const numValue = value ? Number(value) : null;
        onFilterChange({ ...filters, [field]: numValue });
    };

    return (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            {/* ── Title ── */}
            <h2 className="text-lg font-semibold text-slate-800">Filters</h2>

            {/* ── Star Rating ── */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Star Rating
                </label>
                <div className="flex flex-wrap gap-2">
                    {[5, 4, 3, 2, 1].map((rating) => (
                        <button
                            key={rating}
                            onClick={() => handleStarChange(filters.starRating === rating ? null : rating)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                                filters.starRating === rating
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                            {'★'.repeat(rating)}
                            {rating > 1 ? '+' : ''}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Guest Rating ── */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Guest Rating
                </label>
                <div className="flex flex-wrap gap-2">
                    {[4.5, 4, 3, null].map((rating) => (
                        <button
                            key={rating ?? 'all'}
                            onClick={() => handleGuestRatingChange(rating)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                                filters.minGuestRating === rating
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                        >
                            {rating ? `${rating}+` : 'All'}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Price Range ── */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Price Range (SGD)
                </label>
                <div className="flex items-center gap-3">
                    <input
                        type="number"
                        placeholder="Min"
                        value={filters.minPrice ?? ''}
                        onChange={(e) => handlePriceChange('minPrice', e.target.value)}
                        className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                        min={0}
                    />
                    <span className="text-slate-400">to</span>
                    <input
                        type="number"
                        placeholder="Max"
                        value={filters.maxPrice ?? ''}
                        onChange={(e) => handlePriceChange('maxPrice', e.target.value)}
                        className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                        min={0}
                    />
                </div>
            </div>

            {/* ── Action Buttons ── */}
            <div className="flex gap-3 pt-2">
                <button
                    onClick={onApply}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
                >
                    Apply Filters
                </button>
                <button
                    onClick={onClear}
                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition text-sm font-medium"
                >
                    Clear
                </button>
            </div>
        </div>
    );
}