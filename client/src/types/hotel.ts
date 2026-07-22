export interface HotelDetail {
    id: string;
    name: string;
    address: string;
    rating: number;
    description: string;
    latitude: number;
    longitude: number;
    amenities: Record<string, boolean>;
    amenities_ratings: Array<{ name: string; score: number }>;
    image_details: {
        prefix: string;
        suffix: string;
        count: number;
    };
}