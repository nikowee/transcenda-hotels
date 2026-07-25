import { type Request, type Response } from 'express';

const ROOM_PRICE_POLL_INTERVAL_MS = 1500;
const ROOM_PRICE_MAX_ATTEMPTS = 15;
const MAX_ATTEMPTS = 15; // ~22.5s worst case

import axios from 'axios';

const API_BASE_URL = process.env.HOTEL_ROOM_API_URL;

interface PricesResponse {
    completed: boolean;
    currency: string;
    hotels: unknown[];
}

export async function getHotelPrices(req: Request, res: Response) {
    const { destId } = req.params;
    const { checkin, checkout, guests } = req.query;

    if (!checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const response = await axios.get<PricesResponse>(API_BASE_URL!, {
                params: { destination_id: destId, checkin, checkout, guests },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        // Gave up after MAX_ATTEMPTS — return whatever we last got (likely empty)
        res.status(504).json({ error: 'Hotel search timed out. Please try again.' });
    } catch (err) {
        console.error('Hotel prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel prices' });
    }
}

export async function getHotelById(req: Request, res: Response) {
    const { id } = req.params;

    try {
        const response = await axios.get(`${API_BASE_URL}/${id}`);
        res.json(response.data);
    } catch (err) {
        console.error('Hotel detail API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel details' });
    }
}

// Polling mechanism for room prices and availability

export async function getRoomPrices(req: Request, res: Response) {
    const { id } = req.params; // hotel id
    const { destination_id, checkin, checkout, guests, country_code, currency, lang } = req.query;

    if (!destination_id || !checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'destination_id, checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= ROOM_PRICE_MAX_ATTEMPTS; attempt++) {
            const response = await axios.get(`https://hotelapi.loyalty.dev/api/hotels/${id}/price`, {
                params: {
                    destination_id,
                    checkin,
                    checkout,
                    guests,
                    lang: lang ?? 'en_US',
                    currency: currency ?? 'SGD',
                    country_code: country_code ?? 'SG',
                    partner_id: 1089,
                    landing_page: 'wl-acme-earn',
                    product_type: 'earn',
                },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < ROOM_PRICE_MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        res.status(504).json({ error: 'Room search timed out. Please try again.' });
    } catch (err) {
        console.error('Room prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch room prices' });
    }
}
import { searchHotels, type MergedHotel } from '../services/ascendaServices.ts';
import { redis, CACHE_TTL } from '../lib/redisClient.ts';

// Build a unique cache key according to the search parameters.
const buildCacheKey = (params: {
  destination_id: string;
  checkin: string;
  checkout: string;
  guests: string;
}): string => {
  return `search:${params.destination_id}:${params.checkin}:${params.checkout}:${params.guests}`;
};


export const getHotelSearchResults = async (req: Request, res: Response) => {
  try {
    // Extract query parameters from the URL
    // Example URL: /api/hotels/search?destination_id=RsBU&checkin=2026-10-01&checkout=2026-10-07&guests=2&rooms=1
    const { 
      destination_id, 
      checkin, 
      checkout, 
      guests,
      rooms,
      page = '1',            // Default to page 1
      pageSize = '20',       // Default to 20 results per page
      starRating,
      minGuestRating,
      minPrice,
      maxPrice,
      sortBy = 'searchRank_asc'
    } = req.query;

    // Validate required parameters
    // These are required by both our backend and Ascenda's API
    if (!destination_id || !checkin || !checkout || !guests || !rooms) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['destination_id', 'checkin', 'checkout', 'guests', 'rooms'],
        received: { destination_id, checkin, checkout, guests, rooms},
      });
    }


    // Format guests parameter for multiple rooms 
    // Ascenda API expects: "2" for 1 room with 2 guests
    // Or: "2|2|2" for 3 rooms with 2 guests each
    let guestsParam = guests as string;
    const roomsCount = parseInt(rooms as string, 10);
    
    // If multiple rooms, repeat the guests value for each room
    if (roomsCount > 1) {
        const guestsPerRoom = guestsParam;
        guestsParam = Array(roomsCount).fill(guestsPerRoom).join('|');
        console.log(`Multiple rooms: ${roomsCount} rooms with ${guestsPerRoom} guests each → "${guestsParam}"`);
    }

    // Build cache key
    const cacheKey = buildCacheKey({
      destination_id: destination_id as string,
      checkin: checkin as string,
      checkout: checkout as string,
      guests: guestsParam as string,
    });

    // Check Redis cache for the cache key
    console.log(`🔍 Checking cache for: ${cacheKey}`);
    const cachedData = await redis.get(cacheKey);

    let hotels: MergedHotel[];

    if (cachedData){
      // Cache hit
      console.log(`✅ Cache HIT for: ${cacheKey}`);
      hotels = JSON.parse(cachedData);
    } else {
      // Cache miss
      console.log(`❌ Cache MISS for: ${cacheKey}. Fetching from Ascenda...`);

      // Fetch from Ascenda API
      hotels = await searchHotels({
        destination_id: destination_id as string,
        checkin: checkin as string,
        checkout: checkout as string,
        guests: guestsParam,
       });
      console.log(`Received ${hotels.length} hotels from service`);

      // Cache in Redis with TTL
      console.log(`💾 Storing ${hotels.length} hotels in cache (TTL: ${CACHE_TTL}s)`);
      await redis.set(cacheKey, JSON.stringify(hotels), {
        expiration: {type: 'EX', value: CACHE_TTL}
      });
    };

    // Apply filters
    let filteredHotels = [...hotels];

    if (starRating) {
      const rating = parseInt(starRating as string, 10);
      filteredHotels = filteredHotels.filter(h => Math.round(h.rating) === rating);
    }

    if (minGuestRating) {
      const minRating = parseFloat(minGuestRating as string);
      filteredHotels = filteredHotels.filter(h => h.rating >= minRating);
    }

    if (minPrice) {
      const min = parseFloat(minPrice as string);
      filteredHotels = filteredHotels.filter(h => h.price >= min);
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice as string);
      filteredHotels = filteredHotels.filter(h => h.price <= max);
    }


    // Apply sort 
    switch (sortBy) {
      case 'price_asc':
        filteredHotels.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        filteredHotels.sort((a, b) => b.price - a.price);
        break;
      case 'rating_desc':
        filteredHotels.sort((a, b) => b.rating - a.rating);
        break;
      case 'searchRank_asc':
      default:
        filteredHotels.sort((a, b) => a.searchRank - b.searchRank);
        break;
    }
    

    // Paginate the results
    const pageNum = parseInt(page as string, 10);
    const sizeNum = parseInt(pageSize as string, 10);
    const startIndex = (pageNum - 1) * sizeNum;
    const endIndex = startIndex + sizeNum;
    const paginatedHotels = filteredHotels.slice(startIndex, endIndex);


    // Return response
    res.json({
        hotels: paginatedHotels,
        total: filteredHotels.length,
        page: pageNum,
        pageSize: sizeNum,
        totalPages: Math.ceil(filteredHotels.length / sizeNum)
  });

  } catch (error: any) {
    // Error handling
    console.error('❌ Hotel search error:', error.message);
    
    // Check if it's a known error type
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error('📡 Ascenda API error:', error.response.status, error.response.data);
      return res.status(error.response.status || 500).json({
        error: 'Ascenda API error',
        details: error.response.data || 'Unknown API error',
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error('📡 No response from Ascenda API');
      return res.status(504).json({
        error: 'Gateway Timeout',
        details: 'No response from Ascenda API. Please try again.',
      });
    } else {
      // Something else happened
      return res.status(500).json({
        error: 'Internal Server Error',
        details: error.message || 'An unexpected error occurred',
      });
    }
  }
};



export async function getHotelPrices(req: Request, res: Response) {
    const { destId } = req.params;
    const { checkin, checkout, guests } = req.query;

    if (!checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const response = await axios.get<PricesResponse>(API_BASE_URL!, {
                params: { destination_id: destId, checkin, checkout, guests },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        // Gave up after MAX_ATTEMPTS — return whatever we last got (likely empty)
        res.status(504).json({ error: 'Hotel search timed out. Please try again.' });
    } catch (err) {
        console.error('Hotel prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel prices' });
    }
}

export async function getHotelById(req: Request, res: Response) {
    const { id } = req.params;

    try {
        const response = await axios.get(`${API_BASE_URL}/${id}`);
        res.json(response.data);
    } catch (err) {
        console.error('Hotel detail API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel details' });
    }
}

// Polling mechanism for room prices and availability

export async function getRoomPrices(req: Request, res: Response) {
    const { id } = req.params; // hotel id
    const { destination_id, checkin, checkout, guests, country_code, currency, lang } = req.query;

    if (!destination_id || !checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'destination_id, checkin, checkout, and guests are required' });
    }

    try {
        for (let attempt = 1; attempt <= ROOM_PRICE_MAX_ATTEMPTS; attempt++) {
            const response = await axios.get(`https://hotelapi.loyalty.dev/api/hotels/${id}/price`, {
                params: {
                    destination_id,
                    checkin,
                    checkout,
                    guests,
                    lang: lang ?? 'en_US',
                    currency: currency ?? 'SGD',
                    country_code: country_code ?? 'SG',
                    partner_id: 1089,
                    landing_page: 'wl-acme-earn',
                    product_type: 'earn',
                },
            });

            if (response.data.completed) {
                return res.json(response.data);
            }

            if (attempt < ROOM_PRICE_MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, ROOM_PRICE_POLL_INTERVAL_MS));
            }
        }

        res.status(504).json({ error: 'Room search timed out. Please try again.' });
    } catch (err) {
        console.error('Room prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch room prices' });
    }
}