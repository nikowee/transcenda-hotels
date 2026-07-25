import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import request from 'supertest';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { DEMO_HOTELS, pickDemoStay } from '../services/demoStayService.js';
import { HOTEL_API, useHotelNock, ascendaRoom } from './helpers/hotelNock.js';

/**
 * The "surprise me" stay picker.
 *
 * Every hotel in the shortlist is a plausible target, so these intercept by
 * pattern rather than by id — pinning to one hotel would make the suite fail
 * roughly nine times in ten for no reason, and pinning the randomness away would
 * stop testing the thing that makes this a demo picker at all.
 */

const anyHotelPrice = (rooms = [ascendaRoom()], times = 1) =>
  nock(HOTEL_API)
    .get(/^\/api\/hotels\/[^/]+\/price$/)
    .query(true)
    .times(times)
    .reply(200, { completed: true, currency: null, rooms });

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

describe('demo stay picker', () => {
  useHotelNock();

  beforeEach(() => {
    resetRateLimits();
  });

  it('returns a stay built from a shortlisted hotel and a supplier room', async () => {
    anyHotelPrice();

    const stay = await pickDemoStay();

    expect(stay).to.not.equal(null);
    if (!stay) return;

    const hotel = DEMO_HOTELS.find((entry) => entry.hotelId === stay.hotelId);
    expect(hotel, 'picked a hotel that is not on the shortlist').to.exist;
    expect(stay.hotelName).to.equal(hotel?.hotelName);
    expect(stay.destinationId).to.equal(hotel?.destinationId);

    expect(stay.roomTypes).to.have.lengthOf(1);
    expect(stay.roomLabels).to.have.lengthOf(1);
    expect(stay.roomTypes[0]).to.equal(ascendaRoom().key);
    expect(stay.indicativeTotal).to.be.greaterThan(0);
  });

  /**
   * The dates have to be bookable, not merely well-formed. A stay in the past
   * is refused by buildQuote, so a demo that generated one would send the
   * visitor to a checkout page that only shows an error.
   */
  it('picks dates in the future, within the limits checkout enforces', async () => {
    anyHotelPrice(undefined, 8);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const stay = await pickDemoStay();
      expect(stay).to.not.equal(null);
      if (!stay) return;

      const start = Date.parse(stay.startDate);
      const end = Date.parse(stay.endDate);
      const nights = Math.round((end - start) / 86_400_000);

      expect(start, stay.startDate).to.be.greaterThan(Date.now());
      expect(nights, `${stay.startDate}→${stay.endDate}`).to.be.within(2, 5);
      expect(stay.adults).to.be.within(1, 3);
      expect(stay.children).to.be.within(0, 2);
    }
  });

  /** A picker that keeps returning the same stay is not demonstrating anything. */
  it('varies what it picks across calls', async () => {
    anyHotelPrice(undefined, 12);

    const seen = new Set<string>();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const stay = await pickDemoStay();
      if (stay) seen.add(`${stay.hotelId}|${stay.startDate}|${stay.adults}|${stay.children}`);
    }

    // Twelve draws over ten hotels, a hundred start dates and nine parties.
    // Landing on fewer than three distinct stays means the randomness is broken,
    // not unlucky.
    expect(seen.size).to.be.greaterThan(2);
  });

  /**
   * A hotel with nothing available for the dates drawn is an ordinary outcome.
   * Reporting it as a failed demo would make the button look broken whenever a
   * property happens to be full.
   */
  it('moves on to another hotel when the first has no rooms', async () => {
    nock(HOTEL_API)
      .get(/^\/api\/hotels\/[^/]+\/price$/)
      .query(true)
      .reply(200, { completed: true, rooms: [] });
    anyHotelPrice();

    const stay = await pickDemoStay();

    expect(stay).to.not.equal(null);
    expect(stay?.roomTypes[0]).to.equal(ascendaRoom().key);
  });

  it('gives up with null rather than throwing when nothing is available', async () => {
    nock(HOTEL_API)
      .get(/^\/api\/hotels\/[^/]+\/price$/)
      .query(true)
      .times(3)
      .reply(200, { completed: true, rooms: [] });

    expect(await quietly(() => pickDemoStay())).to.equal(null);
  });

  describe('GET /api/bookings/demo-stay', () => {
    it('hands back a checkout query string that prices without further help', async () => {
      // Two interceptors: one for the pick, one for the checkout quote that
      // follows it. They are separate supplier calls for the same stay, and the
      // rate cache makes the second free — but only if the parameters match,
      // which is exactly what this asserts.
      anyHotelPrice(undefined, 2);

      const picked = await request(app).get('/api/bookings/demo-stay');
      expect(picked.status).to.equal(200);
      expect(picked.body.checkoutQuery).to.be.a('string');

      const quoted = await request(app).get(
        `/api/bookings/checkout?${picked.body.checkoutQuery}`
      );

      expect(quoted.status, JSON.stringify(quoted.body)).to.equal(200);
      expect(quoted.body.hotelName).to.equal(picked.body.stay.hotelName);
      expect(quoted.body.totalPrice).to.equal(picked.body.stay.indicativeTotal);
    });

    /**
     * The indicative total is a label. If it ever reached the URL it would be an
     * amount the customer could edit, and /checkout would be quoting from the
     * browser rather than from the supplier.
     */
    it('keeps every price out of the checkout query', async () => {
      anyHotelPrice();

      const response = await request(app).get('/api/bookings/demo-stay');

      expect(response.status).to.equal(200);
      expect(response.body.checkoutQuery).to.not.match(/price|total|amount|rate/i);
      expect(response.body.checkoutQuery).to.not.contain(
        String(response.body.stay.indicativeTotal)
      );
    });

    it('answers 503 rather than 500 when no stay can be found', async () => {
      nock(HOTEL_API)
        .get(/^\/api\/hotels\/[^/]+\/price$/)
        .query(true)
        .times(3)
        .reply(200, { completed: true, rooms: [] });

      const response = await quietly(() => request(app).get('/api/bookings/demo-stay'));

      expect(response.status).to.equal(503);
      expect(response.body.error).to.match(/try again/i);
    });

    /** Literal segments must precede /:id, or this routes to the lookup handler. */
    it('is not swallowed by the booking lookup route', async () => {
      anyHotelPrice();

      const response = await request(app).get('/api/bookings/demo-stay');

      expect(response.status).to.not.equal(400);
      expect(response.body.error).to.not.match(/reference/i);
    });
  });
});
