import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import request from 'supertest';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';
import { fetchHotelName, __clearHotelNameCache } from '../services/hotelRoomService.js';
import { HOTEL_API, useHotelNock, mockRoomPrices, ascendaRoom } from './helpers/hotelNock.js';

/** Hotel-name resolution — the server half of the RoomList connector. */

const HOTEL_ID = 'diH7';
const NAME = 'The Fullerton Hotel Singapore';

const mockHotel = (id = HOTEL_ID, body: Record<string, unknown> = { id, name: NAME }, status = 200) =>
  nock(HOTEL_API).get(`/api/hotels/${id}`).reply(status, body);

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

describe('hotel name resolution', () => {
  useHotelNock();

  beforeEach(() => {
    __clearHotelNameCache();
    resetRateLimits();
  });

  it('reads the name the supplier reports', async () => {
    mockHotel();
    expect(await fetchHotelName(HOTEL_ID)).to.equal(NAME);
  });

  /** Held for the process lifetime rather than a TTL: unlike a rate, a hotel's name does not move, and re-fetching it would add a round trip to every quote for a value already known to be right. */
  it('asks the supplier once and remembers the answer', async () => {
    mockHotel();

    expect(await fetchHotelName(HOTEL_ID)).to.equal(NAME);
    expect(await fetchHotelName(HOTEL_ID)).to.equal(NAME);

    // One interceptor, two calls, nock clean — the second never left the process.
    expect(nock.isDone()).to.equal(true);
  });

  /** A display string must never be the reason a bookable stay cannot be priced, so every failure mode resolves to null rather than throwing. */
  it('returns null rather than throwing when the supplier will not say', async () => {
    mockHotel(HOTEL_ID, { error: 'no such hotel' }, 404);
    expect(await quietly(() => fetchHotelName(HOTEL_ID))).to.equal(null);

    __clearHotelNameCache();
    mockHotel(HOTEL_ID, {}, 200);
    expect(await quietly(() => fetchHotelName(HOTEL_ID))).to.equal(null);

    __clearHotelNameCache();
    nock(HOTEL_API).get(`/api/hotels/${HOTEL_ID}`).replyWithError('socket hang up');
    expect(await quietly(() => fetchHotelName(HOTEL_ID))).to.equal(null);
  });

  it('does not cache a failure, so a transient outage self-heals', async () => {
    mockHotel(HOTEL_ID, { error: 'boom' }, 500);
    await quietly(() => fetchHotelName(HOTEL_ID));

    mockHotel();
    expect(await fetchHotelName(HOTEL_ID)).to.equal(NAME);
  });

  describe('through GET /api/bookings/checkout', () => {
    const ROOM_KEY = '2eb243ba-2f54-561b-8069-0db1439138f1';

    const stay = {
      destinationId: 'WD0M',
      hotelId: HOTEL_ID,
      roomTypes: ROOM_KEY,
      startDate: '2026-10-01',
      endDate: '2026-10-04',
      adults: '2',
      children: '0',
    };

    /** Exactly what BookingEntry forwards: no hotelName at all. */
    it('prices a stay that arrived with no hotel name', async () => {
      mockHotel();
      mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY })] });

      const response = await request(app).get('/api/bookings/checkout').query(stay);

      expect(response.status, JSON.stringify(response.body)).to.equal(200);
      expect(response.body.hotelName).to.equal(NAME);
    });

    /** Search results already know the name, and asking the supplier again would add a round trip per quote for an answer we were handed. */
    it('keeps a name the caller supplied without asking the supplier', async () => {
      mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY })] });

      const response = await request(app)
        .get('/api/bookings/checkout')
        .query({ ...stay, hotelName: 'Marina Bay Sands' });

      expect(response.status).to.equal(200);
      expect(response.body.hotelName).to.equal('Marina Bay Sands');
      // No hotel-details interceptor was registered, and globalSetup blocks the
      // socket — reaching for one would have failed this test.
    });

    it('still refuses the stay when neither the caller nor the supplier has a name', async () => {
      mockHotel(HOTEL_ID, {}, 404);
      mockRoomPrices({ hotelId: HOTEL_ID, rooms: [ascendaRoom({ key: ROOM_KEY })] });

      const response = await quietly(() =>
        request(app).get('/api/bookings/checkout').query(stay)
      );

      expect(response.status).to.equal(400);
      expect(response.body.error).to.match(/hotelName/i);
    });
  });
});
