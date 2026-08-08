import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import nock from 'nock';
import { app } from '../setup.ts';

// NOTE: assumes GET /api/hotels/:id in your route file calls fetchHotelById()
// from ascendaServices.ts. If your route path or response shape differs,
// adjust the mocked path / assertions below to match.

const API_BASE = 'https://hotelapi.loyalty.dev';
const HOTELS_PATH = '/api/hotels';

const mockHotelDetail = {
  id: 'hotel-1',
  name: 'Marina Bay Sands',
  rating: 5,
  address: '10 Bayfront Ave, Singapore',
  latitude: 1.2837,
  longitude: 103.8591,
  description: '<p>Iconic luxury hotel with infinity pool.</p>',
  categories: { luxury: { name: 'Luxury' }, city: { name: 'City' } },
  amenities: { pool: true, spa: true },
  image_details: { prefix: 'https://example.com/', suffix: '.jpg', count: 2 },
};

beforeEach(() => {
  nock.cleanAll();
});

after(() => {
  nock.cleanAll();
});

describe('Hotel Details API', () => {
  it('should return hotel details for a valid hotel id', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).reply(200, mockHotelDetail);

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('id', 'hotel-1');
    expect(response.body).to.have.property('name', 'Marina Bay Sands');
    expect(response.body).to.have.property('rating', 5);
    expect(response.body).to.have.property('latitude');
    expect(response.body).to.have.property('longitude');
  });

  it('should return an error status when the hotel id does not exist', async () => {
    // NOTE: getHotelById currently returns 502 for ANY upstream failure,
    // including a genuine 404 from Ascenda - it doesn't distinguish
    // "not found" from "upstream is down". This test documents the
    // current behavior. Consider having the controller check
    // err.response?.status and forward a real 404 when the upstream
    // itself returned one, so clients can tell the two cases apart.
    nock(API_BASE).get(`${HOTELS_PATH}/does-not-exist`).reply(404, { message: 'Not found' });

    const response = await request(app).get('/api/hotels/does-not-exist');

    expect(response.status).to.equal(502);
  });

  it('should return a 5xx (not crash) when the upstream Ascenda API is unreachable', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).replyWithError('network error');

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.status).to.be.at.least(500);
  });
});
