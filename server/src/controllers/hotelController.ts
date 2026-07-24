import { type Request, type Response } from 'express';
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
    
    // Paginate the results
    const pageNum = parseInt(page as string, 10);
    const sizeNum = parseInt(pageSize as string, 10);
    const startIndex = (pageNum - 1) * sizeNum;
    const endIndex = startIndex + sizeNum;
    const paginatedHotels = hotels.slice(startIndex, endIndex);


    // Return response
    res.json({
        hotels: paginatedHotels,
        total: hotels.length,
        page: pageNum,
        pageSize: sizeNum,
        totalPages: Math.ceil(hotels.length / sizeNum)
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