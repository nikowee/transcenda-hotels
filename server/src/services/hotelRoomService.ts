// Loads .env at import time. index.ts calls dotenv.config() in its own body,
// which ESM runs only after every import has been evaluated — too late for the
// module-scope reads below.
import 'dotenv/config';
import axios from 'axios';

/**
 * Room rates — the supplier half of the «External API» box in the UC4 class
 * diagram, and the thing bookingController's ROOM_RATES was standing in for.
 *
 * Every amount the booking flow charges is built from a table produced here.
 * The browser sends which rooms it wants; it never sends what they cost.
 *
 * Two sources feed one table:
 *
 *   supplier — Ascenda's /hotels/{id}/price, keyed by the opaque room `key` the
 *              API returns. This is what a booking made from the real search
 *              results prices against.
 *   demo     — four fixed slugs that need no network. /checkout reached
 *              directly still has to price something, the e2e suite runs
 *              offline, and a graded demo cannot depend on a third party being
 *              up.
 *
 * The two key spaces are disjoint (UUIDs versus slugs), so merging them cannot
 * shadow a real room with a cheaper fake one.
 */

const HOTEL_API_BASE = (process.env.HOTEL_API_URL ?? 'https://hotelapi.loyalty.dev/api').replace(
  /\/+$/,
  ''
);

/**
 * Required on every priced Ascenda request — they select the white-label
 * partner whose rates come back. Omitting them returns an empty room list
 * rather than an error, which reads as "no availability" and is very hard to
 * tell from a genuinely full hotel.
 */
const PARTNER_PARAMS = {
  partner_id: '1089',
  landing_page: 'wl-acme-earn',
  product_type: 'earn',
  lang: 'en_US',
} as const;

/**
 * The price endpoint answers immediately with `completed: false` and an empty
 * room list while it fans out to suppliers, so the first response is almost
 * never the answer. Poll until it settles.
 */
const POLL_INTERVAL_MS = Number(process.env.HOTEL_API_POLL_MS ?? 1200);
const MAX_POLLS = Number(process.env.HOTEL_API_MAX_POLLS ?? 8);
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * A quote is priced three times over one checkout — once for display, once when
 * the PaymentIntent is minted, once when the charge is confirmed — and all three
 * amounts have to agree or the confirm-time cross-check rejects a payment that
 * already went through. Supplier rates move on their own schedule, so this cache
 * is what makes those three reads return the same number. It is a correctness
 * mechanism first and a latency one second.
 */
const CACHE_TTL_MS = Number(process.env.HOTEL_API_CACHE_MS ?? 30 * 60 * 1000);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A room the booking flow can charge for, with every figure already resolved. */
export interface PricedRoom {
  key: string;
  label: string;
  /** subtotal / nights. Display only — the breakdown sums from subtotal, not from this. */
  nightlyRate: number;
  /** Whole stay, before tax. */
  subtotal: number;
  taxes: number;
  /** Always exactly subtotal + taxes. */
  total: number;
  /** False for the demo catalogue, so a caller can tell an invented price from a real one. */
  supplier: boolean;
}

export type RateTable = Record<string, PricedRoom>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

// ── Demo catalogue ──────────────────────────────────────────────────────────

/** GST, applied only to the demo rooms. Supplier rooms arrive tax-inclusive. */
const DEMO_TAX_RATE = 0.09;

const DEMO_NIGHTLY_RATES: Record<string, { label: string; nightlyRate: number }> = {
  'standard-queen': { label: 'Standard Queen', nightlyRate: 180 },
  'deluxe-king': { label: 'Deluxe King', nightlyRate: 240 },
  'executive-suite': { label: 'Executive Suite', nightlyRate: 420 },
  'family-room': { label: 'Family Room', nightlyRate: 310 },
};

/**
 * Object.hasOwn, not a plain lookup: DEMO_NIGHTLY_RATES['constructor'] resolves
 * to a function off Object.prototype rather than undefined, so a `!== undefined`
 * test waves every inherited key straight through.
 */
export const isDemoRoom = (roomId: string): boolean => Object.hasOwn(DEMO_NIGHTLY_RATES, roomId);

export const demoRateTable = (nights: number): RateTable => {
  const table: RateTable = {};

  for (const [key, room] of Object.entries(DEMO_NIGHTLY_RATES)) {
    const subtotal = round2(room.nightlyRate * nights);
    const taxes = round2(subtotal * DEMO_TAX_RATE);

    table[key] = {
      key,
      label: room.label,
      nightlyRate: room.nightlyRate,
      subtotal,
      taxes,
      total: round2(subtotal + taxes),
      supplier: false,
    };
  }

  return table;
};

// ── Supplier lookup ─────────────────────────────────────────────────────────

/**
 * The subset of Ascenda's room object this service reads. Everything else the
 * endpoint returns — images, amenities, market rates, long descriptions — is
 * presentation for the hotel page and has no business influencing a charge.
 */
interface AscendaRoom {
  key?: string;
  roomNormalizedDescription?: string;
  roomDescription?: string;
  description?: string;
  /** Tax-inclusive whole-stay total in the requested currency. */
  converted_price?: number;
  price?: number;
  included_taxes_and_fees_total_in_currency?: number;
  included_taxes_and_fees_total?: number;
}

interface AscendaPriceResponse {
  completed?: boolean;
  currency?: string | null;
  rooms?: AscendaRoom[];
}

export interface RoomRateRequest {
  hotelId: string;
  destinationId: string;
  checkin: string;
  checkout: string;
  /** Ascenda's own spelling: "2" for one room, "2|2" for two. */
  guests: string;
  nights: number;
  currency: string;
  countryCode?: string;
}

export type RateLookup =
  | { ok: true; table: RateTable }
  | { ok: false; status: number; error: string };

const cacheKey = (request: RoomRateRequest): string =>
  [
    request.hotelId,
    request.destinationId,
    request.checkin,
    request.checkout,
    request.guests,
    request.currency,
    request.countryCode ?? 'SG',
  ].join('|');

const supplierCache = new Map<string, { expiresAt: number; table: RateTable }>();

/** Test seam. Rates are cached for half an hour, which outlives any test run. */
export const __clearRateCache = (): void => {
  supplierCache.clear();
};

/**
 * `converted_price` is the tax-inclusive stay total, and the tax component is
 * reported separately. Deriving the subtotal by subtraction rather than reading
 * `base_rate_in_currency` guarantees subtotal + taxes === total exactly; the two
 * supplier fields disagree by a cent often enough that trusting both produces a
 * breakdown that does not add up on screen.
 */
const toPricedRoom = (room: AscendaRoom, nights: number): PricedRoom | null => {
  const key = typeof room.key === 'string' ? room.key.trim() : '';
  if (!key) return null;

  const total = room.converted_price ?? room.price;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;

  const reportedTaxes =
    room.included_taxes_and_fees_total_in_currency ?? room.included_taxes_and_fees_total ?? 0;

  // A tax line larger than the total means the two fields are in different
  // currencies — treat the stay as untaxed rather than charging a negative
  // subtotal.
  const taxes =
    typeof reportedTaxes === 'number' && Number.isFinite(reportedTaxes) && reportedTaxes >= 0 && reportedTaxes < total
      ? round2(reportedTaxes)
      : 0;

  const roundedTotal = round2(total);
  const subtotal = round2(roundedTotal - taxes);

  return {
    key,
    label:
      room.roomNormalizedDescription?.trim() ||
      room.roomDescription?.trim() ||
      room.description?.trim() ||
      'Room',
    nightlyRate: round2(subtotal / nights),
    subtotal,
    taxes,
    total: roundedTotal,
    supplier: true,
  };
};

/**
 * Polls Ascenda until the price search settles, then maps the rooms.
 *
 * Returns a failure rather than falling back to the demo catalogue. A real room
 * key priced from invented rates would charge a guest an amount no supplier ever
 * quoted, which is worse in every way than showing an error.
 *
 * Exported because the demo stay picker needs the same thing for a different
 * reason — it has no room in mind and wants the whole list to choose from — and
 * a second copy of the polling, mapping and caching would be a second place for
 * the price a demo shows to diverge from the price it charges.
 */
export const listSupplierRooms = async (request: RoomRateRequest): Promise<RateLookup> => {
  const key = cacheKey(request);
  const cached = supplierCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, table: cached.table };
  }

  const params = {
    ...PARTNER_PARAMS,
    destination_id: request.destinationId,
    checkin: request.checkin,
    checkout: request.checkout,
    guests: request.guests,
    currency: request.currency.toUpperCase(),
    country_code: request.countryCode ?? 'SG',
  };

  const url = `${HOTEL_API_BASE}/hotels/${encodeURIComponent(request.hotelId)}/price`;

  try {
    for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
      const response = await axios.get<AscendaPriceResponse>(url, {
        params,
        timeout: REQUEST_TIMEOUT_MS,
        // 4xx is handled below rather than thrown. Ascenda answers an unknown
        // hotel or destination with 422 and a body of {completed: true,
        // rooms: []} — a definite "there are no such rooms", which axios would
        // otherwise raise as an exception and this service would report as an
        // outage. Only 5xx and transport faults mean we failed to ask.
        validateStatus: (status) => status < 500,
      });

      /**
       * The supplier rejected the query. Cached like any other settled answer:
       * a malformed hotel or destination id will be just as malformed in four
       * seconds, and retrying it eight times helps nobody.
       */
      if (response.status >= 400) {
        console.warn(
          `Supplier rejected the price query for hotel ${request.hotelId} ` +
            `(HTTP ${response.status}). Treating it as no availability.`
        );
        supplierCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, table: {} });
        return { ok: true, table: {} };
      }

      if (response.data?.completed) {
        const table: RateTable = {};

        for (const room of response.data.rooms ?? []) {
          const priced = toPricedRoom(room, request.nights);
          if (priced) table[priced.key] = priced;
        }

        supplierCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, table });
        return { ok: true, table };
      }

      if (attempt < MAX_POLLS) await sleep(POLL_INTERVAL_MS);
    }

    // Not cached: an unfinished search is a transient state, and caching it
    // would keep answering "no rooms" for the next half hour.
    console.warn(
      `Room price search for hotel ${request.hotelId} did not complete in ${MAX_POLLS} polls.`
    );
    return { ok: false, status: 504, error: 'Room prices are taking too long to load.' };
  } catch (error) {
    // Supplier faults carry the partner id and the full query string, so the
    // detail is logged and only a generic message travels out.
    console.error(`Room price lookup failed for hotel ${request.hotelId}:`, error);
    return { ok: false, status: 502, error: 'Could not reach the hotel for room prices.' };
  }
};

/**
 * The table bookingController prices a stay against.
 *
 * The supplier is only called when a requested room is not one of the demo
 * slugs, which keeps the offline demo flow — and every test that uses it — off
 * the network without needing a mode flag to say so.
 */
export const resolveRateTable = async (
  request: RoomRateRequest,
  requestedRoomIds: readonly string[]
): Promise<RateLookup> => {
  const demo = demoRateTable(request.nights);

  const needsSupplier = requestedRoomIds.some((id) => !isDemoRoom(id));
  if (!needsSupplier) return { ok: true, table: demo };

  const supplier = await listSupplierRooms(request);
  if (!supplier.ok) return supplier;

  return { ok: true, table: { ...demo, ...supplier.table } };
};
