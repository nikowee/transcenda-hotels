import { describe, it } from 'mocha';
import { expect } from 'chai';
import fc from 'fast-check';
import { buildQuote, MAX_NIGHTS, MAX_ROOMS, MAX_GUESTS, CURRENCY } from '../../controllers/bookingController.js';

/**
 * Property-based / fuzz testing for buildQuote — the single source of truth
 * for pricing. Example-based tests in buildQuote.test.ts check specific
 * known cases; this file checks invariants that must hold across the ENTIRE
 * input space, including inputs no one thought to write by hand.
 *
 * Run standalone: npm run test:fuzz
 * Each property runs fast-check's default 100 random cases.
 */

const DEMO_ROOM_KEYS = ['standard-queen', 'deluxe-king', 'executive-suite'];

/** Arbitrary ISO date string within a fixed, sane calendar range. */
const isoDateArb = fc
  .date({
    min: new Date('2020-01-01T00:00:00.000Z'),
    max: new Date('2035-12-31T00:00:00.000Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));
  
/** A syntactically well-formed stay request — some valid, some deliberately not. */
const stayInputArb = fc.record({
  destinationId: fc.string({ minLength: 0, maxLength: 80 }),
  hotelId: fc.string({ minLength: 0, maxLength: 80 }),
  hotelName: fc.string({ minLength: 0, maxLength: 220 }),
  roomTypes: fc.oneof(
    fc.array(fc.constantFrom(...DEMO_ROOM_KEYS), { minLength: 0, maxLength: 10 }),
    fc.array(fc.string(), { minLength: 0, maxLength: 10 })
  ),
  startDate: fc.oneof(isoDateArb, fc.string()),
  endDate: fc.oneof(isoDateArb, fc.string()),
  adults: fc.oneof(fc.integer({ min: -5, max: 30 }), fc.constant(undefined)),
  children: fc.oneof(fc.integer({ min: -5, max: 30 }), fc.constant(undefined)),
});

/** A stay built to actually price, for the success branch: random inputs land there roughly once in 15 000. */
const pricedStayArb = fc
  .record({
    destinationId: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
    hotelId: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
    hotelName: fc.string({ minLength: 1, maxLength: 190 }).filter((s) => s.trim().length > 0),
    roomTypes: fc.array(fc.constantFrom(...DEMO_ROOM_KEYS), { minLength: 1, maxLength: MAX_ROOMS }),
    startDate: isoDateArb,
    nights: fc.integer({ min: 1, max: MAX_NIGHTS }),
    adults: fc.integer({ min: 1, max: MAX_GUESTS }),
    children: fc.integer({ min: 0, max: MAX_GUESTS }),
  })
  .map(({ nights, adults, children, ...stay }) => ({
    ...stay,
    // Date.parse of YYYY-MM-DD is UTC, so the offset lands on exactly `nights`.
    endDate: new Date(Date.parse(stay.startDate) + nights * 86_400_000).toISOString().slice(0, 10),
    adults,
    children: Math.min(children, MAX_GUESTS - adults),
  }));

describe('buildQuote — fuzz / property tests', function () {
  this.timeout(30_000);

  it('never throws, for any syntactically-shaped input', () => {
    fc.assert(
      fc.property(stayInputArb, (input) => {
        expect(() => buildQuote(input)).not.to.throw();
      })
    );
  });

  it('always returns exactly one of {quote} or {error}, never both, never neither', () => {
    fc.assert(
      fc.property(stayInputArb, (input) => {
        const result = buildQuote(input);
        const hasQuote = 'quote' in result;
        const hasError = 'error' in result;
        expect(hasQuote).to.not.equal(hasError);
      })
    );
  });

  it('every successful quote satisfies its own numeric invariants', () => {
    fc.assert(
      fc.property(pricedStayArb, (input) => {
        const result = buildQuote(input);
        // A priceable stay must price, or the invariants below check nothing.
        if (!('quote' in result)) expect.fail(`priceable stay rejected: ${result.error}`);

        const { quote } = result;

        // Currency is always what this service quotes in.
        expect(quote.currency).to.equal(CURRENCY);

        // Nights within the documented, enforced bounds.
        expect(quote.nights).to.be.at.least(1);
        expect(quote.nights).to.be.at.most(MAX_NIGHTS);

        // Occupancy within bounds.
        expect(quote.adults).to.be.at.least(1);
        expect(quote.children).to.be.at.least(0);
        expect(quote.adults + quote.children).to.be.at.most(MAX_GUESTS);

        // Room count within bounds.
        expect(quote.roomTypes.length).to.be.at.least(1);
        expect(quote.roomTypes.length).to.be.at.most(MAX_ROOMS);

        // The two numbers that make up the total actually sum to it, to the cent.
        const expectedTotal = Math.round((quote.subtotal + quote.taxes) * 100) / 100;
        expect(quote.totalPrice).to.equal(expectedTotal);

        // A priced stay is never free and never negative.
        expect(quote.totalPrice).to.be.greaterThan(0);

        // One nightly rate and one label per room requested — arrays never
        // drift out of sync with roomTypes.length.
        expect(quote.nightlyRates.length).to.equal(quote.roomTypes.length);
        expect(quote.roomLabels.length).to.equal(quote.roomTypes.length);
      })
    );
  });

  it('is deterministic — the same input always prices the same', () => {
    fc.assert(
      fc.property(stayInputArb, (input) => {
        const first = buildQuote(input);
        const second = buildQuote(input);
        expect(first).to.deep.equal(second);
      })
    );
  });

  it('never returns a quote for a room type outside the demo catalogue', () => {
    const nonDemoRoomArb = fc
      .string({ minLength: 1, maxLength: 40 })
      .filter((s) => !DEMO_ROOM_KEYS.includes(s));

    fc.assert(
      fc.property(
        fc.record({
          destinationId: fc.constant('dest-1'),
          hotelId: fc.constant('marina-bay'),
          hotelName: fc.constant('Test Hotel'),
          roomTypes: fc.array(nonDemoRoomArb, { minLength: 1, maxLength: 3 }),
          startDate: fc.constant('2027-08-01'),
          endDate: fc.constant('2027-08-04'),
          adults: fc.constant(2),
          children: fc.constant(0),
        }),
        (input) => {
          const result = buildQuote(input);
          expect('error' in result).to.equal(true);
        }
      )
    );
  });
});