import axios from 'axios';

// For the following interfaces, refer to the Ascendas API documentation for details on the request and response structures.
// The fields that we will not require are omitted for brevity.

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
interface HotelDetails {
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

// ── Helper: Transform categories object to array of names ──
const transformCategories = (categories: any): string[] => {
    if (!categories) return [];
    if (Array.isArray(categories)) return categories;
    // If it's an object, extract the 'name' from each category
    return Object.values(categories)
        .filter((c: any): c is { name: string } => c && typeof c === 'object' && typeof c.name === 'string')
        .map((c: { name: string }) => c.name);
};

// ── Helper: Strip HTML tags from description ──
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

// Calls the Ascendas API (hotels and prices) to search for hotels based off the provided search parameters,
// and returns a list of hotels in the MergedHotel format, sorted by searchRank.
export const searchHotels = async (params: SearchParams): Promise<MergedHotel[]> => {
    const BASE_URL = 'https://hotelapi.loyalty.dev/api/';

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
    const MAX_POLLS = 15;
    const POLL_INTERVAL = 3000; // 3 seconds
    let attempts = 0;
    let allHotels: PriceItem[] = priceResponse.data.hotels || [];

    while (!priceResponse.data.completed && attempts < MAX_POLLS) {
        console.log(`Polling... (${attempts + 1}/${MAX_POLLS}) - Found ${allHotels.length} hotels so far`);
        
        await sleep(POLL_INTERVAL);
        priceResponse = await axios.get<PriceResponse>(
            `${BASE_URL}/hotels/prices`,
            { params: requestParams }
        );
        
        // Update hotels array and avoid duplicates using set
        const newHotels = priceResponse.data.hotels || [];
        const existingIds = new Set(allHotels.map(h => h.id));
        for (const hotel of newHotels) {
            if (!existingIds.has(hotel.id)) {
                allHotels.push(hotel);
                existingIds.add(hotel.id);
            }
        }
    
        attempts++;
    }
    console.log(`Polling complete. Found ${allHotels.length} hotels.`);

    // Fetch hotel details for each hotel
    console.log('Fetching hotel details...');

    const hotelDetailsPromises = allHotels.map(async (priceItem) => {
    try {
        const detailResponse = await axios.get<HotelDetails>(`${BASE_URL}/hotels/${priceItem.id}`);
      
        const details = detailResponse.data;

        // Skip entries where the API returned incomplete data
        if (!details.id) {
            console.warn(`Hotel ${priceItem.id} returned no id from details API, skipping`);
            return null;
        }
      
        return {
            id: details.id,
            name: details.name,
            price: priceItem.price,
            searchRank: priceItem.searchRank,
            rating: details.rating || 0,
            categories: transformCategories(details.categories),
            address: details.address,
            latitude: details.latitude,
            longitude: details.longitude,
            description: cleanDescription(details.description || ''),
            images: details.image_details? constructImageUrls(details.image_details) : [],
      };
    } catch (error) {
        if (error instanceof Error) {
            console.warn(`Failed to fetch details for hotel ${priceItem.id} with error: ${error.message}`);
        }
       
        return null;
    }
  });

  const mergedHotels = (await Promise.all(hotelDetailsPromises)).filter(
    (h): h is MergedHotel => h !== null
  );
  
  // Sort by searchRank in ascending order (lower rank means higher priority I think)
  mergedHotels.sort((a, b) => a.searchRank - b.searchRank);

  console.log(`Merged ${mergedHotels.length} hotels with details.`);
  
  return mergedHotels;
}