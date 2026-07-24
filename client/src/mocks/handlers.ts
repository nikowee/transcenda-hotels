import { http, HttpResponse } from 'msw';

const destinations = [
  { uid: 'dest-1', term: 'Singapore, Singapore' },
  { uid: 'dest-2', term: 'Singapore, Malaysia' },
  { uid: 'dest-3', term: 'Tokyo, Japan' },
  { uid: 'dest-4', term: 'London, UK' },
  { uid: 'dest-5', term: 'Paris, France' },
];

export const handlers = [
  // Substring match rather than Fuse: enough to drive the UI, and the real
  // fuzzy behaviour is covered against the live index in the server suite.
  http.get('http://localhost:5000/api/destinations/search', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.toLowerCase() || '';

    const results = destinations.filter((dest) =>
      dest.term.toLowerCase().includes(query)
    );

    return HttpResponse.json(results.slice(0, 5));
  }),
];