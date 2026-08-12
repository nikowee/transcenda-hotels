import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import fc from 'fast-check';
import { searchHotels } from '../../services/ascendaServices.js';

/**
 * Property-based / fuzz testing for `searchHotels` — the gateway to the live
 * Ascenda API. Example-based tests in hotels/search.test.ts check specific
 * known cases; this file checks invariants that must hold across the entire
 * input space, including shapes no one wrote by hand (wrong types, garbage
 * strings, absurd lengths).
 *
 * The Ascenda HTTP layer is nock-mocked with a settled `completed: true`
 * response so no real polling or network occurs; the guard in globalSetup.ts
 * blocks outbound sockets for the regular run.
 *
 * Run standalone: npm run test:fuzz
 */

const HOTEL_API = 'https://hotelapi.loyalty.dev';

/** Any value a query string could hand us, valid or not. */
const anyParamArb = fc.oneof(
  fc.string(),
  fc.string({ maxLength: 10_000 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(''),
  fc.constant(' '),
  fc.constant('null'),
  fc.constant('undefined'),
  fc.constant('NaN'),
  fc.constant('0'),
  fc.constant('-1'),
  fc.constant('999999999999999999999'),
);

/** A search-params object shaped correctly but with arbitrary — often invalid — values. */
const garbageSearchParamsArb = fc.record({
  destination_id: anyParamArb,
  checkin: anyParamArb,
  checkout: anyParamArb,
  guests: anyParamArb,
});

/** Realistic params that still pass through merging without crashing. */
const validSearchParamsArb = fc.record({
  destination_id: fc.string({ minLength: 1, maxLength: 20 }),
  checkin: fc.constant('2026-12-01'),
  checkout: fc.constant('2026-12-07'),
  guests: fc.constantFrom('1', '2', '3', '4', '2|2', '2|2|2'),
});

describe('searchHotels — fuzz / property tests', function () {
  this.timeout(60_000);

  // The network guard in globalSetup.ts already blocks outbound sockets for
  // every run that is not test:external / test:all. Each iteration also gets a
  // clean nock slate so no interceptor leaks between tests — and crucially we
  // never call nock.enableNetConnect() in this file, which would restore full
  // network access for every later suite in a combined run.
  beforeEach(() => {
    // A suite running earlier may have called nock.restore(); re-activating
    // here matches the pattern in helpers/hotelNock.ts and helpers/authNock.ts,
    // otherwise requests fall through and surface as "Nock: No match".
    if (!nock.isActive()) nock.activate();
    nock.cleanAll();
  });

  afterEach(() => {
    if (!nock.isActive()) nock.activate();
    nock.cleanAll();
  });

  /** Settled responses: one prices payload + one hotel-details payload. */
  const mockSettledAscenda = () => {
    nock(HOTEL_API)
      .get('/api/hotels/prices')
      .query(true)
      .reply(200, {
        hotels: [
          { id: 'hotel-1', price: 450, searchRank: 1 },
          { id: 'hotel-2', price: 120, searchRank: 2 },
        ],
        completed: true,
      });

    nock(HOTEL_API)
      .get('/api/hotels')
      .query(true)
      .reply(200, [
        {
          id: 'hotel-1',
          name: 'Marina Bay Sands',
          rating: 5,
          address: '10 Bayfront Ave, Singapore',
          latitude: 1.2837,
          longitude: 103.8591,
          description: '<p>Iconic luxury hotel.</p>',
          categories: { luxury: { name: 'Luxury' } },
          amenities: { pool: true },
          image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 2 },
        },
        {
          id: 'hotel-2',
          name: 'Hotel Boss',
          rating: 3,
          address: '500 Jalan Sultan, Singapore',
          latitude: 1.3057,
          longitude: 103.8619,
          description: 'Affordable stay.',
          categories: { budget: { name: 'Budget' } },
          amenities: { wifi: true },
          image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 0 },
        },
      ]);
  };

  it('never throws, for any parameter shape including wrong types', async () => {
    await fc.assert(
      fc.asyncProperty(garbageSearchParamsArb, async (input) => {
        mockSettledAscenda();
        const result = await searchHotels(input as never);
        expect(result).to.be.an('array');
      }),
      { numRuns: 50 }
    );
  });

  it('valid params always produce merged hotels with the full shape', async () => {
    await fc.assert(
      fc.asyncProperty(validSearchParamsArb, async (input) => {
        mockSettledAscenda();
        const hotels = await searchHotels(input);
        for (const hotel of hotels) {
          expect(hotel).to.have.property('id').that.is.a('string');
          expect(hotel).to.have.property('name').that.is.a('string');
          expect(hotel).to.have.property('price').that.is.a('number');
          expect(hotel).to.have.property('searchRank').that.is.a('number');
          expect(hotel).to.have.property('rating').that.is.a('number');
          expect(hotel).to.have.property('categories').that.is.an('array');
          expect(hotel).to.have.property('images').that.is.an('array');
        }
      }),
      { numRuns: 25 }
    );
  });

  it('results are always sorted by searchRank ascending', async () => {
    await fc.assert(
      fc.asyncProperty(validSearchParamsArb, async (input) => {
        mockSettledAscenda();
        const hotels = await searchHotels(input);
        const ranks = hotels.map((h) => h.searchRank);
        for (let i = 1; i < ranks.length; i++) {
          const curr = ranks[i] as number;
          const prev = ranks[i - 1] as number;
          expect(curr).to.be.at.least(prev);
        }
      }),
      { numRuns: 25 }
    );
  });

  it('may leave out hotels with no matching details, but never crashes', () => {
    // Price entry that has no matching entry in /api/hotels — the merging loop
    // must skip it rather than throwing on a missing map lookup.
    nock(HOTEL_API)
      .get('/api/hotels/prices')
      .query(true)
      .reply(200, {
        hotels: [{ id: 'ghost-hotel', price: 999, searchRank: 5 }],
        completed: true,
      });

    nock(HOTEL_API)
      .get('/api/hotels')
      .query(true)
      .reply(200, [
        {
          id: 'hotel-1',
          name: 'Marina Bay Sands',
          rating: 5,
          address: 'x',
          latitude: 0,
          longitude: 0,
          description: 'x',
          categories: {},
          amenities: {},
          image_details: { prefix: '', suffix: '', count: 0 },
        },
      ]);

    return searchHotels({
      destination_id: 'RsBU',
      checkin: '2026-12-01',
      checkout: '2026-12-07',
      guests: '2',
    }).then((hotels) => {
      const ids = hotels.map((h) => h.id);
      expect(ids).to.not.include('ghost-hotel');
      expect(hotels).to.be.an('array');
    });
  });
});