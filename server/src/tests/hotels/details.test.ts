import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import nock from 'nock';
import { app } from '../setup.ts';

const API_BASE = 'https://hotelapi.loyalty.dev';
const HOTELS_PATH = '/api/hotels';

const mockHotelDetail = {
  id: 'hotel-1',
  name: 'Marina Bay Sands',
  rating: 5,
  address: '10 Bayfront Ave, Singapore',
  latitude: 1.2837,
  longitude: 103.8591,
  description: '<p>Iconic luxury hotel with infinity pool.</p><p>Rooms &amp; suites overlook the bay.</p>',
  categories: { luxury: { name: 'Luxury' } },
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

  it('should strip HTML tags from the description', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).reply(200, mockHotelDetail);

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.status).to.equal(200);
    expect(response.body.description).to.not.match(/<[^>]+>/);
    expect(response.body.description).to.contain('Iconic luxury hotel with infinity pool.');
  });

  it('should decode HTML entities in the description', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).reply(200, mockHotelDetail);

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.body.description).to.contain('Rooms & suites');
    expect(response.body.description).to.not.contain('&amp;');
  });

  it('should keep paragraph breaks as newlines', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).reply(200, mockHotelDetail);

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.body.description).to.contain('\n');
  });

  it('should convert line break tags into newlines', async () => {
    nock(API_BASE)
      .get(`${HOTELS_PATH}/hotel-2`)
      .reply(200, { ...mockHotelDetail, id: 'hotel-2', description: 'Line one<br />Line two' });

    const response = await request(app).get('/api/hotels/hotel-2');

    expect(response.body.description).to.equal('Line one\nLine two');
  });

  it('should return an empty description when the upstream omits it', async () => {
    nock(API_BASE)
      .get(`${HOTELS_PATH}/hotel-3`)
      .reply(200, { ...mockHotelDetail, id: 'hotel-3', description: undefined });

    const response = await request(app).get('/api/hotels/hotel-3');

    expect(response.status).to.equal(200);
    expect(response.body.description).to.equal('');
  });

  it('should return an error status when the hotel id does not exist', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/does-not-exist`).reply(404, { message: 'Not found' });

    const response = await request(app).get('/api/hotels/does-not-exist');

    expect(response.status).to.equal(502);
  });

  it('should return a 5xx (not crash) when the upstream Ascenda API is unreachable', async () => {
    nock(API_BASE).get(`${HOTELS_PATH}/hotel-1`).replyWithError('connection refused');

    const response = await request(app).get('/api/hotels/hotel-1');

    expect(response.status).to.be.at.least(500);
  });
});
