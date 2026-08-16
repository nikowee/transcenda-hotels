import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import nock from 'nock';
import { app } from '../setup.ts';

const API_BASE = 'https://hotelapi.loyalty.dev';
const PRICE_PATH = '/api/hotels/hotel-1/price';

const mockRoomPricesComplete = {
  completed: true,
  currency: 'SGD',
  rooms: [
    {
      key: 'room-key-1',
      roomDescription: 'Deluxe Room',
      long_description: 'A spacious deluxe room with city views.',
      free_cancellation: true,
      rooms_available: 3,
      images: [
        { url: 'https://example.com/1.jpg', high_resolution_url: 'https://example.com/1_hd.jpg', hero_image: true },
      ],
      amenities: ['wifi', 'minibar'],
      price: 300,
      converted_price: 300,
      points: 1500,
    },
  ],
};

const baseQuery = {
  destination_id: 'RsBU',
  checkin: '2026-08-15',
  checkout: '2026-08-20',
  guests: '2',
};

beforeEach(() => {
  nock.cleanAll();
});

afterEach(() => {
  nock.cleanAll();
});

describe('Hotel Room Price API', () => {
  it('should return 400 when required query params are missing', async () => {
    const response = await request(app).get('/api/hotels/hotel-1/price').query({});
    expect(response.status).to.equal(400);
  });

  it('should return room prices once the upstream poll completes on the first attempt', async () => {
    nock(API_BASE).get(PRICE_PATH).query(true).reply(200, mockRoomPricesComplete);

    const response = await request(app).get('/api/hotels/hotel-1/price').query(baseQuery);

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('rooms');
    expect(response.body.rooms).to.be.an('array').with.lengthOf(1);
    expect(response.body.rooms[0]).to.have.property('price', 300);
  });

  it('should keep polling until completed=true, then return rooms', async function () {
    // Real timers, real 1500ms wait - faking timers here stalls the
    // actual local HTTP request/response cycle (Node's http internals
    // use setTimeout too), not just the intended poll delay. Simpler
    // and more reliable to just wait for real, with a generous timeout.
    this.timeout(8000);

    nock(API_BASE).get(PRICE_PATH).query(true).reply(200, { completed: false, currency: null, rooms: [] });
    nock(API_BASE).get(PRICE_PATH).query(true).reply(200, mockRoomPricesComplete);

    const response = await request(app).get('/api/hotels/hotel-1/price').query(baseQuery);

    expect(response.status).to.equal(200);
    expect(response.body.rooms).to.have.lengthOf(1);
  });

  it('should return an error response if the upstream API never completes (polling exhausted)', async function () {
    // 15 attempts, 14 real 1500ms waits between them (~21s) - give this
    // plenty of headroom rather than fighting fake timers.
    this.timeout(30000);

    nock(API_BASE).get(PRICE_PATH).query(true).times(15).reply(200, { completed: false, currency: null, rooms: [] });

    const response = await request(app).get('/api/hotels/hotel-1/price').query(baseQuery);

    expect(response.status).to.be.at.least(500);
  });
});