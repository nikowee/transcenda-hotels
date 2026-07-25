import { before, after, beforeEach, afterEach } from 'mocha';
import nock from 'nock';
import { allowLoopbackOnly } from '../globalSetup.js';
import { __clearRateCache } from '../../services/hotelRoomService.js';

/**
 * nock harness for Ascenda's room price endpoint.
 *
 * The demo catalogue proves our own arithmetic; it cannot prove we read the
 * supplier correctly, because it never parses a response. These interceptors sit
 * at the socket, so hotelRoomService does its real polling, its real field
 * selection and its real subtotal-by-subtraction against payloads shaped like
 * the ones the API actually returns.
 *
 * Every helper here also clears the rate cache between tests. Supplier rates are
 * held for half an hour so that quoting, charging and confirming a stay all
 * agree on one number — which means without this, the second test to price the
 * same stay would be answered from the first test's fixture and never touch its
 * own interceptor.
 */

export const HOTEL_API = 'https://hotelapi.loyalty.dev';

/** Call inside describe(); registers its own before/beforeEach/afterEach/after. */
export const useHotelNock = (): void => {
  before(() => {
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
    nock.enableNetConnect(allowLoopbackOnly);
  });

  beforeEach(() => {
    __clearRateCache();
  });

  afterEach(() => {
    nock.cleanAll();
    __clearRateCache();
  });

  after(() => {
    nock.cleanAll();
    nock.enableNetConnect(allowLoopbackOnly);
  });
};

export interface RoomFixtureOptions {
  key?: string;
  label?: string;
  /** Tax-inclusive whole-stay total, which is what `converted_price` means. */
  total?: number;
  taxes?: number;
}

/**
 * One room, trimmed to the fields hotelRoomService reads.
 *
 * The names are the supplier's, camelCase and snake_case side by side, because
 * that is genuinely how the endpoint answers — normalising them here would hide
 * the exact inconsistency the mapping code exists to absorb.
 */
export const ascendaRoom = (options: RoomFixtureOptions = {}) => ({
  key: options.key ?? '2eb243ba-2f54-561b-8069-0db1439138f1',
  roomNormalizedDescription: options.label ?? 'Premier Courtyard Room King',
  roomDescription: options.label ?? 'Premier Courtyard Room King',
  free_cancellation: false,
  converted_price: options.total ?? 1990.49,
  price: options.total ?? 1990.49,
  lowest_price: 1512,
  base_rate_in_currency: 1704.47,
  included_taxes_and_fees_total_in_currency: options.taxes ?? 286.03,
  included_taxes_and_fees_total: 217.27,
  excluded_taxes_and_fees_total: 0,
});

export interface PriceResponseOptions {
  hotelId?: string;
  /** False replays the "still searching" answer the endpoint opens with. */
  completed?: boolean;
  rooms?: ReturnType<typeof ascendaRoom>[];
  /** How many times this interceptor answers. Use with completed:false to force polling. */
  times?: number;
}

/**
 * Intercepts GET /api/hotels/:id/price.
 *
 * The query is matched loosely on purpose: the partner parameters are asserted
 * once, in the service's own suite, and repeating them in every controller test
 * would make an unrelated parameter change fail thirty tests instead of one.
 */
export const mockRoomPrices = (options: PriceResponseOptions = {}) =>
  nock(HOTEL_API)
    .get(`/api/hotels/${options.hotelId ?? 'hotel-1'}/price`)
    .query(true)
    .times(options.times ?? 1)
    .reply(200, {
      searchCompleted: null,
      completed: options.completed ?? true,
      status: null,
      currency: null,
      rooms: options.rooms ?? [ascendaRoom()],
    });

/** A settled search that found nothing — how the supplier reports a room id it does not sell. */
export const mockNoRooms = (hotelId = 'hotel-1') =>
  mockRoomPrices({ hotelId, rooms: [] });

/** Supplier down. Distinct from "no rooms": the price is unknown, not absent. */
export const mockPriceFailure = (hotelId = 'hotel-1', status = 500) =>
  nock(HOTEL_API).get(`/api/hotels/${hotelId}/price`).query(true).reply(status, {
    error: 'upstream exploded',
  });
