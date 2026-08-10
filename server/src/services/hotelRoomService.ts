// Loads .env at import time. index.ts calls dotenv.config() in its own body,
// which ESM runs only after every import has been evaluated — too late for the
// module-scope reads below.
import 'dotenv/config';
import axios from 'axios';

/** Room rates — the supplier half of the «External API» box in the class diagram. */

const HOTEL_API_BASE = 'https://hotelapi.loyalty.dev/api';

/** Required on every priced Ascenda request. */
const PARTNER_PARAMS = {
  partner_id: '1089',
  landing_page: 'wl-acme-earn',
  product_type: 'earn',
  lang: 'en_US',
} as const;

/** The price endpoint answers immediately with `completed: false` and an empty room list while it fans out to suppliers, so the first response is almost never the answer. */
const POLL_INTERVAL_MS = Number(process.env.HOTEL_API_POLL_MS ?? 1200);
const MAX_POLLS = Number(process.env.HOTEL_API_MAX_POLLS ?? 8);
const REQUEST_TIMEOUT_MS = 8_000;

/** A quote is priced three times over one checkout. */
const CACHE_TTL_MS = 30 * 60 * 1000;

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
 * Production guardrail: the demo catalogue is development scaffolding priced
 * from a hardcoded table, so it must never back a real charge. Without this a
 * request naming a demo slug is quoted and charged at an invented rate for a
 * room the supplier never sold.
 *
 * Read per call rather than captured at module scope, matching isSimulated(),
 * so a test can exercise both sides. Gated at the source so every path is
 * covered at once — resolveRateTable's merge and buildQuote's rates fallback.
 */
const demoRoomsEnabled = (): boolean => process.env.NODE_ENV !== 'production';

/** Object.hasOwn, not a plain lookup: DEMO_NIGHTLY_RATES['constructor'] resolves to a function off Object.prototype rather than undefined, so a `!== undefined` test waves every inherited key straight through. */
export const isDemoRoom = (roomId: string): boolean =>
  demoRoomsEnabled() && Object.hasOwn(DEMO_NIGHTLY_RATES, roomId);

export const demoRateTable = (nights: number): RateTable => {
  const table: RateTable = {};
  if (!demoRoomsEnabled()) return table;

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

/** The subset of Ascenda's room object this service reads. */
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

/** `converted_price` is the tax-inclusive stay total, and the tax component is reported separately. */
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

/** Polls Ascenda until the price search settles, then maps the rooms. */
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

      /** The supplier rejected the query. */
      const RETRYABLE_REJECTIONS = new Set([401, 403, 408, 425, 429]);

      if (response.status >= 400) {
        if (RETRYABLE_REJECTIONS.has(response.status)) {
          console.warn(
            `Supplier could not answer the price query for hotel ${request.hotelId} ` +
              `(HTTP ${response.status}). Not cached — this is transient.`
          );
          return {
            ok: false,
            status: 502,
            error: 'We could not reach our room supplier. Please try again.',
          };
        }

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

/** Hotel names, resolved from the supplier and held for the process lifetime. */
const hotelNameCache = new Map<string, string>();

/** The display name for a hotel, or null if the supplier will not say. */
export const fetchHotelName = async (hotelId: string): Promise<string | null> => {
  const cached = hotelNameCache.get(hotelId);
  if (cached !== undefined) return cached;

  try {
    const response = await axios.get<{ name?: string }>(
      `${HOTEL_API_BASE}/hotels/${encodeURIComponent(hotelId)}`,
      { timeout: REQUEST_TIMEOUT_MS, validateStatus: (status) => status < 500 }
    );

    if (response.status >= 400) return null;

    const name = typeof response.data?.name === 'string' ? response.data.name.trim() : '';
    if (!name) return null;

    hotelNameCache.set(hotelId, name);
    return name;
  } catch (error) {
    console.warn(`Could not resolve a name for hotel ${hotelId}:`, error);
    return null;
  }
};

/** Test seam, alongside __clearRateCache. */
export const __clearHotelNameCache = (): void => {
  hotelNameCache.clear();
};

/** The table bookingController prices a stay against. */
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
