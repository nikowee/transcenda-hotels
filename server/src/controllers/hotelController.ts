import { type Request, type Response } from 'express';
import { searchHotels, fetchRoomPrices, fetchHotelById, type MergedHotel, type RoomPricesResponse, type RoomPricesParams } from '../services/ascendaServices.ts';
import { withCache, CACHE_TTL } from '../lib/cache.ts';

// Build a unique cache key according to the search parameters.
const buildCacheKey = (params: {
  destination_id: string;
  checkin: string;
  checkout: string;
  guests: string;
}): string => {
  return `search:${params.destination_id}:${params.checkin}:${params.checkout}:${params.guests}`;
};

/**
 * Room-price key.
 *
 * The optional params are defaulted to the same values fetchRoomPrices applies,
 * so `?currency=SGD` and an absent currency — identical upstream requests —
 * resolve to one entry instead of two.
 */
const buildRoomPricesCacheKey = (
  hotelId: string,
  params: RoomPricesParams,
): string => {
  const parts = [
    hotelId,
    params.destination_id,
    params.checkin,
    params.checkout,
    params.guests,
    params.currency ?? 'SGD',
    params.country_code ?? 'SG',
    params.lang ?? 'en_US',
  ];
  return `rooms:${parts.join(':')}`;
};

export async function getHotelById(req: Request, res: Response) {
    const id = req.params.id as string;

    try {
        const hotel = await fetchHotelById(id);
        res.json(hotel);
    } catch (err) {
        console.error('Hotel detail API error:', err);
        res.status(502).json({ error: 'Failed to fetch hotel details' });
    }
}

export async function getRoomPrices(req: Request, res: Response) {
    const id = req.params.id as string;
    const { destination_id, checkin, checkout, guests, country_code, currency, lang } = req.query;

    if (!destination_id || !checkin || !checkout || !guests) {
        return res.status(400).json({ error: 'destination_id, checkin, checkout, and guests are required' });
    }

    const params: RoomPricesParams = {
        destination_id: destination_id as string,
        checkin: checkin as string,
        checkout: checkout as string,
        guests: guests as string,
        country_code: country_code as string | undefined,
        currency: currency as string | undefined,
        lang: lang as string | undefined,
    };

    try {
        // The slowest upstream call in the app: fetchRoomPrices polls Ascenda at
        // 1.5s intervals for up to 15 attempts before it settles. Only a
        // completed response reaches here — pollUntilComplete throws otherwise —
        // so a cached entry is never a partial result.
        const data = await withCache<RoomPricesResponse>(
            buildRoomPricesCacheKey(id, params),
            CACHE_TTL,
            () => fetchRoomPrices(id, params),
        );

        res.json(data);
    } catch (err) {
        console.error('Room prices API error:', err);
        res.status(502).json({ error: 'Failed to fetch room prices' });
    }
}

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

    // The unfiltered upstream result is what gets cached — filters and sort are
    // applied per request below, so changing a filter costs no Ascenda call.
    const hotels = await withCache<MergedHotel[]>(cacheKey, CACHE_TTL, async () => {
      const fetched = await searchHotels({
        destination_id: destination_id as string,
        checkin: checkin as string,
        checkout: checkout as string,
        guests: guestsParam,
      });
      console.log(`Received ${fetched.length} hotels from service`);
      return fetched;
    });

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