import type { SortOption } from '../../types';

interface SortDropdownProps {
    value: string;
    onChange: (value: string) => void;
}

const sortOptions: SortOption[] = [
    { label: 'Price: Low to High', value: 'price_asc' },
    { label: 'Price: High to Low', value: 'price_desc' },
    { label: 'Rating: High to Low', value: 'rating_desc' },
    { label: 'Best Value (Search Rank)', value: 'searchRank_asc' },
];

export default function SortDropdown({ value, onChange }: SortDropdownProps) {
    return (
        <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Sort by:</label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            >
                {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}