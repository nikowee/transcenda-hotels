import { http, HttpResponse } from 'msw';

// Mock destination data
const destinations = [
  { uid: 'dest-1', term: 'Singapore, Singapore' },
  { uid: 'dest-2', term: 'Singapore, Malaysia' },
  { uid: 'dest-3', term: 'Tokyo, Japan' },
  { uid: 'dest-4', term: 'London, UK' },
  { uid: 'dest-5', term: 'Paris, France' },
];

// Mock hotel data matching the Hotel type
const mockHotels = [
  {
    id: 'hotel-1',
    name: 'Marina Bay Sands',
    price: 450,
    searchRank: 1,
    rating: 5,
    categories: ['Luxury', 'City'],
    address: '10 Bayfront Ave, Singapore',
    latitude: 1.2837,
    longitude: 103.8591,
    description: 'Iconic luxury hotel with infinity pool.',
    amenities: ['Pool', 'Spa', 'Gym', 'Restaurant'],
    images: ['https://example.com/mbs.jpg'],
  },
  {
    id: 'hotel-2',
    name: 'Hotel Boss',
    price: 120,
    searchRank: 2,
    rating: 3,
    categories: ['Budget', 'City'],
    address: '500 Jalan Sultan, Singapore',
    latitude: 1.3057,
    longitude: 103.8619,
    description: 'Affordable stay in the city center.',
    amenities: ['WiFi', 'Restaurant'],
    images: [],
  },
  {
    id: 'hotel-3',
    name: 'Shangri-La Singapore',
    price: 350,
    searchRank: 3,
    rating: 5,
    categories: ['Luxury', 'Resort'],
    address: '22 Orange Grove Rd, Singapore',
    latitude: 1.3125,
    longitude: 103.8319,
    description: 'Tropical luxury resort in the heart of the city.',
    amenities: ['Pool', 'Spa', 'Gym', 'Tennis Court'],
    images: ['https://example.com/shangri-la.jpg'],
  },
  {
    id: 'hotel-4',
    name: 'Hotel 81 Rochor',
    price: 80,
    searchRank: 4,
    rating: 2,
    categories: ['Budget'],
    address: '12 Rochor Rd, Singapore',
    latitude: 1.3054,
    longitude: 103.8542,
    description: 'No-frills budget accommodation.',
    amenities: ['WiFi'],
    images: [],
  },
  {
    id: 'hotel-5',
    name: 'Raffles Hotel Singapore',
    price: 800,
    searchRank: 5,
    rating: 5,
    categories: ['Luxury', 'Heritage'],
    address: '1 Beach Rd, Singapore',
    latitude: 1.2931,
    longitude: 103.8544,
    description: 'Colonial-era luxury landmark.',
    amenities: ['Pool', 'Spa', 'Gym', 'Restaurant', 'Bar'],
    images: ['https://example.com/raffles.jpg'],
  },
];

export const handlers = [
  // Intercept GET requests to the destination search endpoint
  http.get('http://localhost:5000/api/destinations/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.toLowerCase() || '';

    // Simulate API behavior: filter destinations based on query
    const results = destinations.filter((dest) =>
      dest.term.toLowerCase().includes(query)
    );

    // Return first 5 results (matching backend behavior)
    return HttpResponse.json(results.slice(0, 5));
  }),

  // Intercept GET requests to the hotel search endpoint
  http.get('http://localhost:5000/api/hotels/search', ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10');
    const starRating = url.searchParams.get('starRating');
    const minGuestRating = url.searchParams.get('minGuestRating');
    const minPrice = url.searchParams.get('minPrice');
    const maxPrice = url.searchParams.get('maxPrice');
    const sortBy = url.searchParams.get('sortBy') || 'searchRank_asc';

    // Apply filters
    let filtered = [...mockHotels];

    if (starRating) {
      filtered = filtered.filter((h) => h.rating >= parseInt(starRating));
    }
    if (minGuestRating) {
      filtered = filtered.filter((h) => h.rating >= parseFloat(minGuestRating));
    }
    if (minPrice) {
      filtered = filtered.filter((h) => h.price >= parseInt(minPrice));
    }
    if (maxPrice) {
      filtered = filtered.filter((h) => h.price <= parseInt(maxPrice));
    }

    // Apply sorting
    if (sortBy === 'price_asc') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price_desc') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'rating_desc') {
      filtered.sort((a, b) => b.rating - a.rating);
    } else {
      // searchRank_asc (default)
      filtered.sort((a, b) => a.searchRank - b.searchRank);
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const paginatedHotels = filtered.slice(start, start + pageSize);

    return HttpResponse.json({
      hotels: paginatedHotels,
      total,
      page,
      pageSize,
      totalPages,
    });
  }),
];
