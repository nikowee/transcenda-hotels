import { listSupplierRooms, type PricedRoom } from './hotelRoomService.js';
import type { StayDetails } from '../models/bookingTypes.js';

/**
 * Picks a real, currently-bookable stay at random — the "surprise me" entry
 * point for demos.
 *
 * Exists because a demo that always books deluxe-king at Marina Bay Sands does
 * not demonstrate very much: the interesting property of UC4 after the supplier
 * integration is that it prices a *real* room from a *real* hotel at whatever
 * the supplier is charging today, and a fixed fixture hides exactly that.
 * Everything here — the city, the hotel, the dates, the party, the room, the
 * price — is different on every call.
 *
 * The hotel shortlist is fixed while everything else is live. That is a
 * deliberate trade, not a shortcut: Ascenda's destination-level
 * /hotels/prices search fans out across every property in a city and takes
 * anywhere from two seconds to forty, and sometimes never settles at all —
 * measured, not assumed. A button that usually hangs is worse than no button.
 * Picking from hotels already known to answer keeps the round trip at roughly
 * one price call, and the rooms and rates it returns are still live.
 */

/**
 * Verified against the live API: each of these returns hotel details and a
 * settled room search in about two and a half seconds.
 *
 * If one goes dark the picker moves on to another — see pickDemoStay — so a
 * stale entry costs a retry rather than a failed demo.
 */
interface DemoHotel {
  destinationId: string;
  destination: string;
  hotelId: string;
  hotelName: string;
}

export const DEMO_HOTELS: readonly DemoHotel[] = [
  { destinationId: 'RsBU', destination: 'Singapore', hotelId: 'jsGI', hotelName: 'Aloft Singapore Novena' },
  { destinationId: 'RsBU', destination: 'Singapore', hotelId: 'Qrwy', hotelName: 'ibis Styles Singapore On Macpherson' },
  { destinationId: 'RsBU', destination: 'Singapore', hotelId: 'cxJh', hotelName: 'The Vagabond Club, Singapore' },
  { destinationId: 'A6Dz', destination: 'Rome', hotelId: 'OoE1', hotelName: 'Domus Domas & Boutique' },
  { destinationId: 'A6Dz', destination: 'Rome', hotelId: '53fD', hotelName: 'BQ House Santa Maria' },
  { destinationId: 'Zauv', destination: 'Bangkok', hotelId: 'Tymi', hotelName: '137 Pillars Residences Bangkok' },
  { destinationId: 'Zauv', destination: 'Bangkok', hotelId: 'bS9g', hotelName: 'Solitaire Bangkok Sukhumvit 11' },
  { destinationId: 'Zauv', destination: 'Bangkok', hotelId: 'MOT9', hotelName: 'COMO Metropolitan Bangkok' },
  { destinationId: '5qq3', destination: 'Amsterdam', hotelId: 'QiYd', hotelName: 'Rembrandtplein Hotel' },
  { destinationId: '5qq3', destination: 'Amsterdam', hotelId: 'hz8g', hotelName: 'Crowne Plaza Amsterdam South' },
];

/**
 * Far enough out that availability is not the constraint, near enough that the
 * dates read as a plausible trip.
 */
const MIN_DAYS_AHEAD = 21;
const MAX_DAYS_AHEAD = 120;
const MIN_NIGHTS = 2;
const MAX_NIGHTS = 5;

/** How many hotels to try before giving up. Each miss costs one price call. */
const MAX_ATTEMPTS = 3;

const DAY_MS = 86_400_000;

/** Inclusive of both bounds. */
const randomInt = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

const pickOne = <T>(items: readonly T[]): T => items[randomInt(0, items.length - 1)]!;

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export interface DemoStay extends StayDetails {
  /** City name, for the "we picked Bangkok for you" line. Not part of the booking. */
  destination: string;
  /** Index-aligned with roomTypes, as CheckoutQuote.roomLabels is. */
  roomLabels: string[];
  /**
   * What the supplier is charging for this room today, tax included.
   *
   * Display only, and never sent back: /checkout reprices the stay server-side
   * from the same supplier call, so a tampered figure here buys nothing. It is
   * here so a caller can show a price without a second round trip.
   */
  indicativeTotal: number;
  currency: string;
}

/**
 * Weighted towards rooms that are neither the cheapest nor the most expensive
 * on offer, because both extremes make for a poor screenshot — the cheapest is
 * usually a windowless single and the dearest is a suite that dwarfs every
 * other number on the page.
 */
const pickRoom = (rooms: PricedRoom[]): PricedRoom => {
  if (rooms.length <= 2) return pickOne(rooms);

  const sorted = [...rooms].sort((a, b) => a.total - b.total);
  const lower = Math.floor(sorted.length * 0.2);
  const upper = Math.ceil(sorted.length * 0.8) - 1;

  return pickOne(sorted.slice(lower, upper + 1));
};

/**
 * Ascenda counts heads per room. One room keeps the demo's arithmetic legible —
 * a multi-room stay itemises into a summary nobody reads on a projector.
 */
const guestsParam = (adults: number, children: number): string => String(adults + children);

/**
 * Returns null rather than throwing when every attempt misses, so the caller
 * decides whether that is a 503 or a quiet fallback. A demo helper that throws
 * would take a page down over a hotel being full.
 */
export const pickDemoStay = async (): Promise<DemoStay | null> => {
  const tried = new Set<string>();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidates = DEMO_HOTELS.filter((hotel) => !tried.has(hotel.hotelId));
    if (candidates.length === 0) break;

    const hotel = pickOne(candidates);
    tried.add(hotel.hotelId);

    const nights = randomInt(MIN_NIGHTS, MAX_NIGHTS);
    const start = new Date(Date.now() + randomInt(MIN_DAYS_AHEAD, MAX_DAYS_AHEAD) * DAY_MS);
    const end = new Date(start.getTime() + nights * DAY_MS);

    const adults = randomInt(1, 3);
    const children = randomInt(0, 2);

    const lookup = await listSupplierRooms({
      hotelId: hotel.hotelId,
      destinationId: hotel.destinationId,
      checkin: isoDate(start),
      checkout: isoDate(end),
      guests: guestsParam(adults, children),
      nights,
      currency: 'SGD',
    });

    // A hotel with no availability for these dates is an ordinary outcome, not
    // an error. Try another rather than reporting a broken demo.
    if (!lookup.ok) continue;

    const rooms = Object.values(lookup.table).filter((room) => room.supplier);
    if (rooms.length === 0) continue;

    const room = pickRoom(rooms);

    return {
      destinationId: hotel.destinationId,
      destination: hotel.destination,
      hotelId: hotel.hotelId,
      hotelName: hotel.hotelName,
      roomTypes: [room.key],
      roomLabels: [room.label],
      startDate: isoDate(start),
      endDate: isoDate(end),
      adults,
      children,
      indicativeTotal: room.total,
      currency: 'SGD',
    };
  }

  return null;
};
