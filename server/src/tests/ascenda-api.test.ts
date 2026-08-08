import { describe, it } from 'mocha';
import { expect } from 'chai';
import axios from 'axios';

// ────────────────────────────────────────────────────────────────────
// INTEGRATION TESTS:
//
//   - Run them with their own script (see note at bottom of this file),
//     NOT as part of default `npm test`, so a flaky/offline
//     external service doesn't fail regular CI run.
//   - They assert loosely (status + presence of expected fields), not
//     exact values, since the mock data can change over time.
// ────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://hotelapi.loyalty.dev/api';

// Known-good values taken from the case study document's own examples.
const DESTINATION_ID = 'RsBU'; // Singapore, per the spec's sample URLs
const HOTEL_ID = 'QDaO';       // used in the spec's /api/hotels/:id example

// checkin must be >= 3 days from today per the spec; using dates well in
// the future keeps this test valid without needing to recompute "today".
const CHECKIN = '2026-12-01';
const CHECKOUT = '2026-12-07';

describe('Ascenda API - integration smoke tests (real network)', function () {
  // Real HTTP calls + the prices endpoint's own polling can be slow.
  this.timeout(20000);

  it('GET /hotels/prices should respond with the expected shape', async () => {
    const response = await axios.get(`${BASE_URL}/hotels/prices`, {
      params: {
        destination_id: DESTINATION_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        lang: 'en_US',
        currency: 'SGD',
        country_code: 'SG',
        guests: '2',
        partner_id: '1089',
        landing_page: 'wl-acme-earn',
        product_type: 'earn',
      },
    });

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('hotels');
    expect(response.data).to.have.property('completed');
    expect(response.data.hotels).to.be.an('array');

    if (response.data.hotels.length > 0) {
      const hotel = response.data.hotels[0];
      expect(hotel).to.have.property('id');
      expect(hotel).to.have.property('price');
      expect(hotel).to.have.property('searchRank');
    }
  });

  it('GET /hotels should respond with static hotel details for a destination', async () => {
    const response = await axios.get(`${BASE_URL}/hotels`, {
      params: { destination_id: DESTINATION_ID },
    });

    expect(response.status).to.equal(200);
    expect(response.data).to.be.an('array');

    if (response.data.length > 0) {
      const hotel = response.data[0];
      expect(hotel).to.have.property('id');
      expect(hotel).to.have.property('name');
      expect(hotel).to.have.property('latitude');
      expect(hotel).to.have.property('longitude');
      expect(hotel).to.have.property('image_details');
    }
  });

  it('GET /hotels/:id should respond with details for a single hotel', async () => {
    const response = await axios.get(`${BASE_URL}/hotels/${HOTEL_ID}`);

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('id');
    expect(response.data).to.have.property('name');
    expect(response.data).to.have.property('rating');
  });

  it('GET /hotels/:id/price should respond with the expected room-price shape', async () => {
    const response = await axios.get(`${BASE_URL}/hotels/${HOTEL_ID}/price`, {
      params: {
        destination_id: DESTINATION_ID,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        lang: 'en_US',
        currency: 'SGD',
        country_code: 'SG',
        guests: '2',
        partner_id: '1089',
        landing_page: 'wl-acme-earn',
        product_type: 'earn',
      },
    });

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('rooms');
    expect(response.data).to.have.property('completed');
    expect(response.data.rooms).to.be.an('array');

    if (response.data.rooms.length > 0) {
      const room = response.data.rooms[0];
      expect(room).to.have.property('key');
      expect(room).to.have.property('price');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Suggested package.json scripts:
//
//   "test":             "mocha --require ts-node/register 'tests/**/*.test.ts' --exclude 'tests/integration/**'",
//   "test:integration":  "mocha --require ts-node/register 'tests/integration/**/*.test.ts'",
//   "test:all":          "mocha --require ts-node/register 'tests/**/*.test.ts'"
//
// Run `npm test` normally / in CI, and `npm run test:integration`
// occasionally (or in a separate CI job) to catch upstream API drift.
// ────────────────────────────────────────────────────────────────────
