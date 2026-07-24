export interface Hotel {
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

export interface SearchResponse {
    hotels: Hotel[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export interface SearchFilters {
    starRating: number | null;
    minGuestRating: number | null;
    minPrice: number | null;
    maxPrice: number | null;
}

export interface SortOption {
    label: string;
    value: 'price_asc' | 'price_desc' | 'rating_desc' | 'searchRank_asc';
}