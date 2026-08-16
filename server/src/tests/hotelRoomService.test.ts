import { describe, it } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import {
  demoRateTable,
  isDemoRoom,
  resolveRateTable,
  type RoomRateRequest,
} from '../services/hotelRoomService.js';
import {
  HOTEL_API,
  useHotelNock,
  ascendaRoom,
  mockRoomPrices,
  mockPriceFailure,
} from './helpers/hotelNock.js';

/** Room rate resolution against Ascenda. */

const REQUEST: RoomRateRequest = {
  hotelId: 'hotel-1',
  destinationId: 'WD0M',
  checkin: '2026-10-01',
  checkout: '2026-10-04',
  guests: '2',
  nights: 3,
  currency: 'SGD',
};

const ROOM_KEY = '2eb243ba-2f54-561b-8069-0db1439138f1';

const silently = async <T>(fn: () => Promise<T>): Promise<T> => {
  const error = console.error;
  const warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
};

describe('hotelRoomService', () => {
  useHotelNock();

  describe('demo catalogue', () => {
    it('prices the four offline rooms for the length of the stay', () => {
      const table = demoRateTable(3);

      expect(Object.keys(table)).to.have.members([
        'standard-queen',
        'deluxe-king',
        'executive-suite',
        'family-room',
      ]);

      // 240/night × 3 nights, +9% GST — the figure the whole booking suite
      // asserts against.
      expect(table['deluxe-king']).to.include({
        nightlyRate: 240,
        subtotal: 720,
        taxes: 64.8,
        total: 784.8,
        supplier: false,
      });
    });

    it('keeps subtotal + taxes exactly equal to the total', () => {
      for (const nights of [1, 3, 7, 30]) {
        for (const room of Object.values(demoRateTable(nights))) {
          expect(Math.round((room.subtotal + room.taxes) * 100) / 100, room.key).to.equal(
            room.total
          );
        }
      }
    });

    /** The guard that stops `rates['constructor']` resolving to a function off Object.prototype and being multiplied into a NaN subtotal. */
    it('does not report inherited Object properties as demo rooms', () => {
      for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(isDemoRoom(key), key).to.equal(false);
      }
    });
  });

  describe('resolveRateTable', () => {
    it('never calls the supplier when every requested room is a demo slug', async () => {
      // No interceptor is registered. globalSetup blocks outbound sockets, so a
      // request here fails the test rather than reaching the real API — which is
      // exactly the assertion.
      const result = await resolveRateTable(REQUEST, ['deluxe-king', 'family-room']);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table['deluxe-king']?.supplier).to.equal(false);
    });

    it('maps a supplier room onto the quote shape', async () => {
      mockRoomPrices();

      const result = await resolveRateTable(REQUEST, [ROOM_KEY]);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;

      const room = result.table[ROOM_KEY];
      expect(room).to.exist;
      expect(room).to.include({
        label: 'Premier Courtyard Room King',
        total: 1990.49,
        taxes: 286.03,
        supplier: true,
      });
      // Derived by subtraction, not read from base_rate_in_currency (1704.47),
      // so the breakdown adds up to the cent.
      expect(room?.subtotal).to.equal(1704.46);
      expect(room?.nightlyRate).to.equal(568.15);
    });

    it('merges the demo catalogue in alongside supplier rooms', async () => {
      mockRoomPrices();

      const result = await resolveRateTable(REQUEST, [ROOM_KEY, 'deluxe-king']);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table[ROOM_KEY]?.supplier).to.equal(true);
      expect(result.table['deluxe-king']?.supplier).to.equal(false);
    });

    /** The endpoint answers `completed: false` with an empty room list while it fans out to suppliers. */
    it('polls past an unfinished search rather than reporting no rooms', async () => {
      mockRoomPrices({ completed: false, rooms: [], times: 2 });
      mockRoomPrices();

      const result = await resolveRateTable(REQUEST, [ROOM_KEY]);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table[ROOM_KEY]).to.exist;
    });

    it('gives up with a 504 when the search never settles', async () => {
      // env.ts caps the suite at 3 polls.
      mockRoomPrices({ completed: false, rooms: [], times: 3 });

      const result = await silently(() => resolveRateTable(REQUEST, [ROOM_KEY]));

      expect(result.ok).to.equal(false);
      if (result.ok) return;
      expect(result.status).to.equal(504);
    });

    /** Falling back to the demo catalogue here would price a real supplier room at an invented rate and charge a guest an amount no supplier ever quoted. */
    it('fails rather than substituting demo rates when the supplier is down', async () => {
      mockPriceFailure();

      const result = await silently(() => resolveRateTable(REQUEST, [ROOM_KEY]));

      expect(result.ok).to.equal(false);
      if (result.ok) return;
      expect(result.status).to.equal(502);
      expect(result.error).to.not.match(/partner_id|hotelapi/i);
    });

    /** Ascenda answers an unknown hotel or destination with 422 and a body of {completed: true, rooms: []}. */
    it('reads a 4xx rejection as no availability rather than an outage', async () => {
      mockPriceFailure('hotel-1', 422);

      const result = await silently(() => resolveRateTable(REQUEST, [ROOM_KEY]));

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table[ROOM_KEY]).to.equal(undefined);
      // The demo rooms still price — only the supplier had nothing to offer.
      expect(result.table['deluxe-king']).to.exist;
    });

    it('still reports a 5xx as an outage', async () => {
      mockPriceFailure('hotel-1', 503);

      const result = await silently(() => resolveRateTable(REQUEST, [ROOM_KEY]));

      expect(result.ok).to.equal(false);
      if (result.ok) return;
      expect(result.status).to.equal(502);
    });

    it('sends the partner parameters the endpoint needs to return any rates', async () => {
      let seen: Record<string, string> = {};

      nock(HOTEL_API)
        .get('/api/hotels/hotel-1/price')
        .query((actual) => {
          seen = actual as Record<string, string>;
          return true;
        })
        .reply(200, { completed: true, rooms: [ascendaRoom()] });

      await resolveRateTable(REQUEST, [ROOM_KEY]);

      expect(seen).to.include({
        partner_id: '1089',
        landing_page: 'wl-acme-earn',
        product_type: 'earn',
        destination_id: 'WD0M',
        checkin: '2026-10-01',
        checkout: '2026-10-04',
        guests: '2',
        currency: 'SGD',
      });
    });

    it('drops rooms with no key or no usable price instead of pricing them at zero', async () => {
      mockRoomPrices({
        rooms: [
          ascendaRoom({ key: '' }),
          ascendaRoom({ key: 'no-price', total: 0 }),
          ascendaRoom({ key: 'good', total: 500, taxes: 50 }),
        ],
      });

      const result = await resolveRateTable(REQUEST, ['good']);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table['no-price']).to.equal(undefined);
      expect(result.table['good']).to.include({ subtotal: 450, taxes: 50, total: 500 });
    });

    /** The two tax fields are reported in different currencies — the converted one and the supplier's own. */
    it('ignores a tax figure larger than the total rather than going negative', async () => {
      mockRoomPrices({ rooms: [ascendaRoom({ key: 'odd', total: 100, taxes: 9999 })] });

      const result = await resolveRateTable(REQUEST, ['odd']);

      expect(result.ok).to.equal(true);
      if (!result.ok) return;
      expect(result.table['odd']).to.include({ subtotal: 100, taxes: 0, total: 100 });
    });

    /** A stay is priced three times over one checkout — display, charge, confirm. */
    it('answers a repeat lookup for the same stay from cache', async () => {
      const scope = mockRoomPrices();

      const first = await resolveRateTable(REQUEST, [ROOM_KEY]);
      const second = await resolveRateTable(REQUEST, [ROOM_KEY]);

      expect(first.ok && second.ok).to.equal(true);
      if (!first.ok || !second.ok) return;
      expect(second.table[ROOM_KEY]?.total).to.equal(first.table[ROOM_KEY]?.total);
      // This scope's one interceptor was consumed, so the second lookup never
      // reached the network. Asserted on the scope, not nock.isDone(): that is
      // global, so an interceptor another suite legitimately holds fails a
      // test that has nothing to do with it.
      expect(scope.isDone()).to.equal(true);
    });

    it('does not serve one stay from another stay cache entry', async () => {
      mockRoomPrices({ rooms: [ascendaRoom({ key: ROOM_KEY, total: 900 })] });
      await resolveRateTable(REQUEST, [ROOM_KEY]);

      mockRoomPrices({ rooms: [ascendaRoom({ key: ROOM_KEY, total: 1500 })] });
      const later = await resolveRateTable(
        { ...REQUEST, checkin: '2026-11-01', checkout: '2026-11-04' },
        [ROOM_KEY]
      );

      expect(later.ok).to.equal(true);
      if (!later.ok) return;
      expect(later.table[ROOM_KEY]?.total).to.equal(1500);
    });

    /** An unfinished search is transient. */
    it('does not cache a search that timed out', async () => {
      mockRoomPrices({ completed: false, rooms: [], times: 3 });
      await silently(() => resolveRateTable(REQUEST, [ROOM_KEY]));

      mockRoomPrices();
      const retry = await resolveRateTable(REQUEST, [ROOM_KEY]);

      expect(retry.ok).to.equal(true);
      if (!retry.ok) return;
      expect(retry.table[ROOM_KEY]).to.exist;
    });
  });
});
