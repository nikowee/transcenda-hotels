import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import nock from 'nock';
import { app } from '../setup.ts';

const API_BASE = 'https://hotelapi.loyalty.dev';
const PRICES_PATH = '/api/hotels/prices';
const HOTELS_PATH = '/api/hotels';

// ── Mock Data ──

const mockPriceResponse = {
  hotels: [
    { id: 'hotel-1', price: 450, searchRank: 1 },
    { id: 'hotel-2', price: 120, searchRank: 2 },
    { id: 'hotel-3', price: 350, searchRank: 3 },
    { id: 'hotel-4', price: 80, searchRank: 4 },
    { id: 'hotel-5', price: 800, searchRank: 5 },
  ],
  completed: true,
};

const mockHotelDetails = [
  {
    id: 'hotel-1',
    name: 'Marina Bay Sands',
    rating: 5,
    address: '10 Bayfront Ave, Singapore',
    latitude: 1.2837,
    longitude: 103.8591,
    description: 'Iconic luxury hotel with infinity pool.',
    categories: { luxury: { name: 'Luxury' }, city: { name: 'City' } },
    amenities: { pool: true, spa: true },
    image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 2 },
  },
  {
    id: 'hotel-2',
    name: 'Hotel Boss',
    rating: 3,
    address: '500 Jalan Sultan, Singapore',
    latitude: 1.3057,
    longitude: 103.8619,
    description: 'Affordable stay in the city center.',
    categories: { budget: { name: 'Budget' } },
    amenities: { wifi: true },
    image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 0 },
  },
  {
    id: 'hotel-3',
    name: 'Shangri-La Singapore',
    rating: 5,
    address: '22 Orange Grove Rd, Singapore',
    latitude: 1.3125,
    longitude: 103.8319,
    description: 'Tropical luxury resort.',
    categories: { luxury: { name: 'Luxury' }, resort: { name: 'Resort' } },
    amenities: { pool: true, spa: true, gym: true },
    image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 3 },
  },
  {
    id: 'hotel-4',
    name: 'Hotel 81 Rochor',
    rating: 2,
    address: '12 Rochor Rd, Singapore',
    latitude: 1.3054,
    longitude: 103.8542,
    description: 'No-frills budget accommodation.',
    categories: { budget: { name: 'Budget' } },
    amenities: { wifi: true },
    image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 0 },
  },
  {
    id: 'hotel-5',
    name: 'Raffles Hotel Singapore',
    rating: 5,
    address: '1 Beach Rd, Singapore',
    latitude: 1.2931,
    longitude: 103.8544,
    description: 'Colonial-era luxury landmark.',
    categories: { luxury: { name: 'Luxury' }, heritage: { name: 'Heritage' } },
    amenities: { pool: true, spa: true, gym: true, restaurant: true, bar: true },
    image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 5 },
  },
];

// ── Setup / Teardown ──

beforeEach(() => {
  nock.cleanAll();
});

after(() => {
  nock.cleanAll();
});

// ── Tests ──

describe('Hotel Search API', () => {

  // Test 1: Missing required params returns 400
  it('should return 400 when required parameters are missing', async () => {
    const response = await request(app)
      .get('/api/hotels/search')
      .query({ destination_id: 'RsBU' }); // missing checkin, checkout, guests, rooms

    expect(response.status).to.equal(400);
    expect(response.body).to.have.property('error', 'Missing required parameters');
    expect(response.body).to.have.property('required');
    expect(response.body.required).to.include.members(['destination_id', 'checkin', 'checkout', 'guests', 'rooms']);
  });

  // Test 2: Valid params returns hotels
  it('should return hotels for a valid search', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
      });

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('hotels');
    expect(response.body).to.have.property('total');
    expect(response.body).to.have.property('page', 1);
    expect(response.body).to.have.property('pageSize', 20);
    expect(response.body).to.have.property('totalPages');
    expect(response.body.hotels).to.be.an('array').with.lengthOf(5);
    expect(response.body.hotels[0]).to.have.property('name', 'Marina Bay Sands');
    expect(response.body.hotels[0]).to.have.property('price', 450);
    expect(response.body.hotels[0]).to.have.property('rating', 5);
  });

  // Test 3: Star rating filter
  it('should filter by star rating', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        starRating: '5',
      });

    expect(response.status).to.equal(200);
    expect(response.body.hotels).to.be.an('array');
    response.body.hotels.forEach((hotel: any) => {
      expect(Math.round(hotel.rating)).to.equal(5);
    });
  });

  // Test 4: Min price filter
  it('should filter by minimum price', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        minPrice: '300',
      });

    expect(response.status).to.equal(200);
    response.body.hotels.forEach((hotel: any) => {
      expect(hotel.price).to.be.at.least(300);
    });
  });

  // Test 5: Max price filter
  it('should filter by maximum price', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        maxPrice: '100',
      });

    expect(response.status).to.equal(200);
    response.body.hotels.forEach((hotel: any) => {
      expect(hotel.price).to.be.at.most(100);
    });
  });

  // Test 6: Price sorting (ascending)
  it('should sort by price ascending', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        sortBy: 'price_asc',
      });

    expect(response.status).to.equal(200);
    const prices = response.body.hotels.map((h: any) => h.price);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).to.be.at.least(prices[i - 1]);
    }
  });

  // Test 7: Price sorting (descending)
  it('should sort by price descending', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        sortBy: 'price_desc',
      });

    expect(response.status).to.equal(200);
    const prices = response.body.hotels.map((h: any) => h.price);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).to.be.at.most(prices[i - 1]);
    }
  });

  // Test 8: Pagination
  it('should paginate results correctly', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        page: '1',
        pageSize: '2',
      });

    expect(response.status).to.equal(200);
    expect(response.body.hotels).to.have.lengthOf(2);
    expect(response.body.page).to.equal(1);
    expect(response.body.pageSize).to.equal(2);
    expect(response.body.total).to.equal(5);
    expect(response.body.totalPages).to.equal(3);
  });

  // Test 9: Guest rating filter
  it('should filter by minimum guest rating', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        minGuestRating: '4',
      });

    expect(response.status).to.equal(200);
    response.body.hotels.forEach((hotel: any) => {
      expect(hotel.rating).to.be.at.least(4);
    });
  });

  // ── Robustness / boundary cases ──

  it('should return an empty hotels array for a page beyond the last page', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        page: '999',
        pageSize: '10',
      });

    expect(response.status).to.equal(200);
    expect(response.body.hotels).to.be.an('array').that.is.empty;
    expect(response.body.page).to.equal(999);
  });

  it('should return 200 (not 500) for page=0 and pageSize=0', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        page: '0',
        pageSize: '0',
      });

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('hotels').that.is.an('array');
  });

  it('should return 400 when rooms is missing entirely', async () => {
    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        // rooms deliberately omitted
      });

    expect(response.status).to.equal(400);
    expect(response.body).to.have.property('required');
    expect(response.body.required).to.include('rooms');
  });

  it('should not crash for rooms=0 or rooms=-1', async () => {
    for (const rooms of ['0', '-1']) {
      nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
      nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

      const response = await request(app)
        .get('/api/hotels/search')
        .query({
          destination_id: 'RsBU',
          checkin: '2026-08-15',
          checkout: '2026-08-20',
          guests: '2',
          rooms,
        });

      // Either a 400 (validation), a 200 (tolerant handling), or a mapped
      // gateway 5xx when the upstream rejects the odd param — never a 500.
      expect([200, 400, 502, 504]).to.include(response.status);
    }
  });

  it('should gracefully handle non-numeric guests', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: 'abc',
        rooms: '1',
      });

    expect([200, 400]).to.include(response.status);
    if (response.status === 200) {
      expect(response.body).to.have.property('hotels').that.is.an('array');
    }
  });

  it('should gracefully handle invalid date strings', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: 'not-a-date',
        checkout: '2026-99-99',
        guests: '2',
        rooms: '1',
      });

    // The gateway may forward to Ascenda (which can 200 or 5xx); what must
    // never happen is a 500 from our own code with no gateway mapping.
    expect([200, 400, 502, 504]).to.include(response.status);
  });

  it('should fall back to default sort for an unknown sortBy value', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'RsBU',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
        sortBy: 'garbage_sort',
      });

    expect(response.status).to.equal(200);
    // Default is searchRank_asc: first hotel has the lowest searchRank (1).
    expect(response.body.hotels[0].searchRank).to.equal(1);
  });

  it('should handle starRating out of range gracefully', async () => {
    for (const starRating of ['6', '0']) {
      nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
      nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

      const response = await request(app)
        .get('/api/hotels/search')
        .query({
          destination_id: 'RsBU',
          checkin: '2026-08-15',
          checkout: '2026-08-20',
          guests: '2',
          rooms: '1',
          starRating,
        });

      expect(response.status).to.equal(200);
      expect(response.body.hotels).to.be.an('array');
    }
  });

  it('should handle whitespace and encoded destination ids without crashing', async () => {
    nock(API_BASE).get(PRICES_PATH).query(true).reply(200, mockPriceResponse);
    nock(API_BASE).get(HOTELS_PATH).query(true).reply(200, mockHotelDetails);

    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: ' ',
        checkin: '2026-08-15',
        checkout: '2026-08-20',
        guests: '2',
        rooms: '1',
      });

    // Whitespace destination id should not crash; a 200 (empty) or gateway 5xx
    // are both acceptable, but never a 500 from our own code.
    expect([200, 400, 502, 504]).to.include(response.status);
  });
});
