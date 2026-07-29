export interface RoomOption {
    key: string;
    roomDescription: string;
    long_description: string;
    free_cancellation: boolean;
    rooms_available: number;
    images: Array<{ url: string; high_resolution_url: string; hero_image: boolean }>;
    amenities: string[];
    price: number;
    converted_price: number;
    points: number;
}

export interface RoomPricesResponse {
    completed: boolean;
    currency: string | null;
    rooms: RoomOption[];
}