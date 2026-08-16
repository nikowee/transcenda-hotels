import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from '../setup.js';

// ────────────────────────────────────────────────────────────────────
// REAL-NETWORK EXPRESS INTEGRATION TESTS
//
//   Unlike `ascenda-api.test.ts` (raw axios smoke tests), these drive the
//   actual Express app through supertest — the exact route handlers, gateways
//   and middleware the browser uses — with *no nock interceptors*. The axios
//   client inside `ascendaServices.ts` really reaches the live Ascenda API.
//
//   This folder is excluded from `npm test` and runs on demand with
//   `npm run test:external` (or `test:all`): see the guard in globalSetup.ts,
//   which skips nock.disableNetConnect() for those lifecycle events.
//
//   Assertions are deliberately loose — mock data on the live API changes over
//   time — but strict about the *shape* the frontend depends on, which is
//   exactly the contract that nock-mocked tests cannot prove.
// ────────────────────────────────────────────────────────────────────

const DESTINATION_ID = 'RsBU'; // Singapore, per the case study's own sample URLs
const HOTEL_ID = 'QDaO';       // used in the spec's /api/hotels/:id example

// checkin must be >= 3 days from today per the spec; using dates well in the
// future keeps this suite valid without recomputing "today".
const CHECKIN = '2026-12-01';
const CHECKOUT = '2026-12-07';

describe('Ascenda API - Express integration tests (real network)', function () {
  // The prices endpoint polls with a 4s interval; give the whole call room.
  this.timeout(120000);

  it('GET /api/hotels/search answers with a valid merged-hotel shape', async () => {
    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: DESTINATION_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guests: '2',
        rooms: '1',
        page: '1',
        pageSize: '10',
        sortBy: 'searchRank_asc',
      });

    expect(response.status).to.equal(200);

    // The frontend's SearchResponse contract:
    expect(response.body).to.have.property('hotels').that.is.an('array');
    expect(response.body).to.have.property('total').that.is.a('number');
    expect(response.body).to.have.property('page', 1);
    expect(response.body).to.have.property('pageSize', 10);
    expect(response.body).to.have.property('totalPages').that.is.a('number');

    // Every merged hotel must carry the fields ResultsPage/HotelCard render.
    for (const hotel of response.body.hotels) {
      expect(hotel).to.have.property('id').that.is.a('string');
      expect(hotel).to.have.property('name').that.is.a('string');
      expect(hotel).to.have.property('price').that.is.a('number');
      expect(hotel).to.have.property('searchRank').that.is.a('number');
      expect(hotel).to.have.property('rating').that.is.a('number');
      expect(hotel).to.have.property('address').that.is.a('string');
      expect(hotel).to.have.property('description').that.is.a('string');
      expect(hotel).to.have.property('categories').that.is.an('array');
      expect(hotel).to.have.property('amenities').that.is.an('array');
      expect(hotel).to.have.property('images').that.is.an('array');
      expect(hotel).to.have.property('latitude').that.is.a('number');
      expect(hotel).to.have.property('longitude').that.is.a('number');
    }
  });

  it('GET /api/hotels/search honours filters and sorting against live data', async () => {
    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: DESTINATION_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guests: '2',
        rooms: '1',
        pageSize: '50',
        sortBy: 'price_asc',
      });

    expect(response.status).to.equal(200);

    const prices = response.body.hotels.map((h: any) => h.price);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).to.be.at.least(prices[i - 1]);
    }
  });

  it('GET /api/hotels/:id returns hotel details for a known hotel', async () => {
    const response = await request(app).get(`/api/hotels/${HOTEL_ID}`);

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('id', HOTEL_ID);
    expect(response.body).to.have.property('name').that.is.a('string');
    expect(response.body).to.have.property('rating').that.is.a('number');
    expect(response.body).to.have.property('description').that.is.a('string');
  });

  it('GET /api/hotels/:id/price returns room options for a known hotel', async function () {
    // Room pricing also polls; allow extra time.
    this.timeout(120000);

    const response = await request(app)
      .get(`/api/hotels/${HOTEL_ID}/price`)
      .query({
        destination_id: DESTINATION_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guests: '2',
      });

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('rooms').that.is.an('array');
    expect(response.body).to.have.property('completed', true);

    if (response.body.rooms.length > 0) {
      const room = response.body.rooms[0];
      expect(room).to.have.property('key').that.is.a('string');
      expect(room).to.have.property('roomDescription').that.is.a('string');
      expect(room).to.have.property('price').that.is.a('number');
      expect(room).to.have.property('converted_price').that.is.a('number');
      expect(room).to.have.property('free_cancellation').that.is.a('boolean');
    }
  });

  it('GET /api/hotels/search handles a bad destination id gracefully', async () => {
    const response = await request(app)
      .get('/api/hotels/search')
      .query({
        destination_id: 'does-not-exist',
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guests: '2',
        rooms: '1',
      });

    // The upstream legitimately rejects an unknown destination id with a 4xx
    // (422 in practice) and our gateway forwards upstream status codes, so a
    // 400/422 is the *graceful* path here — not a defect. What must never
    // happen is our own process crashing or a 500 from our code.
    expect([200, 400, 422, 502, 504]).to.include(response.status);
    if (response.status === 200) {
      expect(response.body).to.have.property('hotels').that.is.an('array');
    }
  });
});