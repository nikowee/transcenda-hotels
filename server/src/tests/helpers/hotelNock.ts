import { before, after, beforeEach, afterEach } from 'mocha';
import nock from 'nock';
import { allowLoopbackOnly } from '../globalSetup.js';
import { __clearRateCache } from '../../services/hotelRoomService.js';

/** nock harness for Ascenda's room price endpoint. */

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

/** One room, trimmed to the fields hotelRoomService reads. */
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

/** Intercepts GET /api/hotels/:id/price. */
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
