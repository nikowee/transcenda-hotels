import { http, HttpResponse } from 'msw';

// Mock destination data
const destinations = [
  { uid: 'dest-1', term: 'Singapore, Singapore' },
  { uid: 'dest-2', term: 'Singapore, Malaysia' },
  { uid: 'dest-3', term: 'Tokyo, Japan' },
  { uid: 'dest-4', term: 'London, UK' },
  { uid: 'dest-5', term: 'Paris, France' },
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

  // You can add more handlers for other endpoints here
  // http.post('http://localhost:5000/api/bookings', () => { ... }),
];