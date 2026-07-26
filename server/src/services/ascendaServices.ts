import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ── Generic polling utility ──

interface PollOptions {
    intervalMs?: number;
    maxAttempts?: number;
}

/**
 * Polls an API endpoint until `completed` is true or max attempts are reached.
 * The `fetcher` callback should return a response object containing a `completed` boolean.
 * Use this when you only need the final completed response (not accumulation across partial results).
 */
async function pollUntilComplete<T extends { completed: boolean }>(
    fetcher: () => Promise<T>,
    options?: PollOptions
): Promise<T> {
    const intervalMs = options?.intervalMs ?? 4000;
    const maxAttempts = options?.maxAttempts ?? 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await fetcher();
        if (response.completed) return response;
        if (attempt < maxAttempts) {
            await sleep(intervalMs);
        }
    }

    throw new Error('Polling timed out');
}

// ── Types ──

// Request structure for Ascendas /api/hotels/prices endpoint.
// Some fields are hardcoded according to the API specifications and are not included here.
interface SearchParams {
    destination_id: string;
    checkin: string;
    checkout: string;
    guests: string; // e.g., "2" or "2|2|2" for multiple rooms -> requires processing from no. of rooms and guests per room
    currency?: string;
    country_code?: string;
}

// Response structure for Ascendas /api/hotels/prices endpoint.
interface PriceResponse {
    hotels: PriceItem[];
    completed: boolean;
}

interface PriceItem {
    id: string;
    price: number;
    searchRank: number;
}

// Reponse structure for Ascendas /api/hotels/:id endpoint.
// Note: amenities and categories are typed as 'any' because the API returns
// them as objects (e.g. {"wifi":true,"pool":true}) rather than arrays.
// We transform them into arrays in the helper functions below.
export interface HotelDetails {
    id: string;
    name: string;
    rating: number;
    address: string;
    latitude: number;
    longitude: number;
    description: string;
    amenities: any;
    categories: any;
    image_details: {
        prefix: string;
        suffix: string;
        count: number;
    };
    trustyou?: {
        score: {
            overall: number;
        };
    };
    number_reviews?: number;
}

// Combined data structure for both the hotel and price endpoints.
export interface MergedHotel {
    id: string;
    name: string;
    price: number;
    searchRank: number;
    rating: number;
    address: string;
    latitude: number;
    longitude: number;
    description: string;
    amenities: string[];
    categories: string[];
    images: string[];
}

// Room-level types (used by fetchRoomPrices)
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

// ── Helpers ──

// Helper: Transform categories object to array of names
const transformCategories = (categories: any): string[] => {
    if (!categories) return [];
    if (Array.isArray(categories)) return categories;
    // If it's an object, extract the 'name' from each category
    return Object.values(categories)
        .filter((c: any): c is { name: string } => c && typeof c === 'object' && typeof c.name === 'string')
        .map((c: { name: string }) => c.name);
};

// Helper: Strip HTML tags from description
const cleanDescription = (description: string): string => {
    if (!description) return '';
    return description.replace(/<[^>]*>/g, '').trim();
};

// Helper function to simulate delay.
// E.g. sleep(2000) to sleep for 2 seconds.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to build the full image url for a singular hotel. 
const constructImageUrls = (imageDetails: HotelDetails['image_details']): string[] => {
    const { prefix, suffix, count } = imageDetails;
    const urls: string[] = [];
    for (let i = 1; i <= count; i++) {
        urls.push(`${prefix}${i}${suffix}`);
  }
  return urls;
};

// ── Public API functions ──

const BASE_URL = process.env.ASC_BASE_API_URL || 'https://hotelapi.loyalty.dev/api';

/**
 * Fetches room prices for a specific hotel, polling until the API returns completed.
 * Used by GET /api/hotels/:id/price
 */
export async function fetchRoomPrices(
    hotelId: string,
    params: {
        destination_id: string;
        checkin: string;
        checkout: string;
        guests: string;
        country_code?: string;
        currency?: string;
        lang?: string;
    }
): Promise<RoomPricesResponse> {
    return pollUntilComplete<RoomPricesResponse>(
        () =>
            axios
                .get<RoomPricesResponse>(`${BASE_URL}/hotels/${hotelId}/price`, {
                    params: {
                        destination_id: params.destination_id,
                        checkin: params.checkin,
                        checkout: params.checkout,
                        guests: params.guests,
                        lang: params.lang ?? 'en_US',
                        currency: params.currency ?? 'SGD',
                        country_code: params.country_code ?? 'SG',
                        partner_id: 1089,
                        landing_page: 'wl-acme-earn',
                        product_type: 'earn',
                    },
                })
                .then((r) => r.data),
        { intervalMs: 1500, maxAttempts: 15 }
    );
}

/**
 * Fetches details for a single hotel by its ID.
 * Used by GET /api/hotels/:id
 */
export async function fetchHotelById(id: string): Promise<HotelDetails> {
    try {
        const response = await axios.get<HotelDetails>(`${BASE_URL}/hotels/${id}`);
        return response.data;
    } catch (err) {
        console.error('Hotel detail API error:', err);
        throw new Error('Failed to fetch hotel details');
    }
}

/**
 * Calls the Ascendas API (hotels and prices) to search for hotels based off the provided search parameters,
 * and returns a list of hotels in the MergedHotel format, sorted by searchRank.
 * Used by GET /api/hotels/search
 */
export const searchHotels = async (params: SearchParams): Promise<MergedHotel[]> => {
    // Request params for Ascendas /api/hotels/prices endpoint.
    const requestParams = {
        destination_id: params.destination_id,
        checkin: params.checkin,
        checkout: params.checkout,
        lang: 'en_US',
        currency: params.currency || 'SGD',
        country_code: params.country_code || 'SG',
        guests: params.guests,
        partner_id: '1089',
        landing_page: 'wl-acme-earn',
        product_type: 'earn',
    };

    // Call Ascendas /api/hotels/prices endpoint.
    console.log('Searching hotels for destination:', params.destination_id);

    let priceResponse = await axios.get<PriceResponse>(
            `${BASE_URL}/hotels/prices`,
            { params: requestParams }
        );

    // Poll until completed is true or until max attempts have reached.
    // This can be a while loop since it only returns anything at all when completed=true
    // but I'm keeping this in case the API is fixed to return partial results in the future as per the docs.
    const MAX_POLLS = 10;
    const POLL_INTERVAL = 4000; // 4 seconds
    let attempts = 0;
    let allHotelPrices: PriceItem[] = priceResponse.data.hotels || [];

    while (!priceResponse.data.completed && attempts < MAX_POLLS) {
        console.log(`Polling... (${attempts + 1}/${MAX_POLLS}) - Found ${allHotelPrices.length} hotels so far`);
        
        await sleep(POLL_INTERVAL);
        priceResponse = await axios.get<PriceResponse>(
            `${BASE_URL}/hotels/prices`,
            { params: requestParams }
        );
        
        // Update hotels array and avoid duplicates using set
        const newHotels = priceResponse.data.hotels || [];
        const existingIds = new Set(allHotelPrices.map(h => h.id));
        for (const hotel of newHotels) {
            if (!existingIds.has(hotel.id)) {
                allHotelPrices.push(hotel);
                existingIds.add(hotel.id);
            }
        }
    
        attempts++;
    }
    console.log(`Polling complete. Found ${allHotelPrices.length} hotels.`);

    // Fetch hotel details for each hotel
    console.log('Fetching hotel details...');

    const hotelDetailsResponse = await axios.get<HotelDetails[]>(`${BASE_URL}/hotels`,
        { params: {destination_id: params.destination_id} }
    );

    // Create a map of the hotel data for quick lookup by hotel ID
    const hotelDetailsMap = new Map<string, HotelDetails>();
    for (const hotelDetail of hotelDetailsResponse.data){
        // Only map hotels if their destination IDs exist
        if (hotelDetail.id){
            hotelDetailsMap.set(hotelDetail.id, hotelDetail);
        }
    }

    // Merging Logic
    const mergedHotels: MergedHotel[] = [];

    for (const hotelPrice of allHotelPrices){
        const hotelDetail = hotelDetailsMap.get(hotelPrice.id);
        if (!hotelDetail) {
            console.debug(`⚠️ Skipping hotel ${hotelPrice.id} (no details found)`);
            continue;
        }

        mergedHotels.push({
            id: hotelDetail.id,
            name: hotelDetail.name || `Hotel ${hotelDetail.id}`,
            price: hotelPrice.price,
            searchRank: hotelPrice.searchRank,
            rating: hotelDetail.rating || 0,
            categories: transformCategories(hotelDetail.categories),
            address: hotelDetail.address || '',
            latitude: hotelDetail.latitude || 0,
            longitude: hotelDetail.longitude || 0,
            description: cleanDescription(hotelDetail.description || ''),
            amenities: [],
            images: hotelDetail.image_details ? constructImageUrls(hotelDetail.image_details) : [],
        });
    }
  
    // Sort by searchRank in ascending order (lower rank means higher priority I think)
    mergedHotels.sort((a, b) => a.searchRank - b.searchRank);

    console.log(`✅ Merged ${mergedHotels.length} valid hotels out of ${allHotelPrices.length} price entries`);

    return mergedHotels;
};