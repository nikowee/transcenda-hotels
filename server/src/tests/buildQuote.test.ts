import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  buildQuote,
  validateGuestDetails,
  validateBillingAddress,
  CURRENCY,
  MAX_NIGHTS,
  MAX_ROOMS,
  MAX_GUESTS,
} from '../controllers/bookingController.js';
import type { GuestDetails } from '../models/bookingTypes.js';

/** buildQuote and validateGuestDetails, exercised directly. */

/** deluxe-king is 240/night; 3 nights × 1 room = 720, +9% tax = 784.80 */
const VALID = {
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2026-08-01',
  endDate: '2026-08-04',
  adults: 2,
  children: 0,
};

/** Narrows the union so assertions do not need casts. */
const quoteOf = (input: unknown) => {
  const result = buildQuote(input);
  if ('error' in result) {
    throw new Error(`expected a quote, got error: ${result.error}`);
  }
  return result.quote;
};

const errorOf = (input: unknown): string => {
  const result = buildQuote(input);
  if (!('error' in result)) {
    throw new Error('expected an error, got a quote');
  }
  return result.error;
};

/** Builds an end date N nights after the start, for boundary cases. */
const stayOfNights = (nights: number) => {
  const startDate = new Date('2026-08-01T00:00:00Z');
  const endDate = new Date(startDate.getTime() + nights * 86_400_000);
  return { ...VALID, startDate: '2026-08-01', endDate: endDate.toISOString().slice(0, 10) };
};

describe('buildQuote', () => {
  describe('pricing a valid stay', () => {
    it('derives every figure from the room rate table', () => {
      const quote = quoteOf(VALID);

      expect(quote.nights).to.equal(3);
      expect(quote.nightlyRates).to.deep.equal([240]);
      expect(quote.nightlyTotal).to.equal(240);
      expect(quote.subtotal).to.equal(720);
      expect(quote.taxes).to.equal(64.8);
      expect(quote.totalPrice).to.equal(784.8);
      expect(quote.currency).to.equal(CURRENCY);
    });

    it('itemises a multi-room stay index-aligned with roomTypes', () => {
      // The confirmation page shows a line per room, so the rates have to come
      // back in the order the rooms were asked for rather than as one total.
      const quote = quoteOf({ ...VALID, roomTypes: ['deluxe-king', 'standard-queen'] });

      expect(quote.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
      expect(quote.nightlyRates).to.deep.equal([240, 180]);
      expect(quote.nightlyTotal).to.equal(420);
      expect(quote.subtotal).to.equal(1260);
      expect(quote.totalPrice).to.equal(1373.4);
    });

    it('prices each room type from the rate table, not from the input', () => {
      expect(quoteOf({ ...VALID, roomTypes: ['standard-queen'] }).nightlyTotal).to.equal(180);
      expect(quoteOf({ ...VALID, roomTypes: ['deluxe-king'] }).nightlyTotal).to.equal(240);
      expect(quoteOf({ ...VALID, roomTypes: ['executive-suite'] }).nightlyTotal).to.equal(420);
      expect(quoteOf({ ...VALID, roomTypes: ['family-room'] }).nightlyTotal).to.equal(310);
    });

    // Regression: the amount was once read straight off the request body.
    it('ignores any price fields present on the input', () => {
      // The whole point of the function: a caller cannot contribute an amount.
      const quote = quoteOf({
        ...VALID,
        totalPrice: 0.01,
        subtotal: 1,
        taxes: 0,
        nightlyRates: [1],
        nightlyTotal: 1,
        pricePaid: 0.01,
        amount: 1,
      });

      expect(quote.totalPrice).to.equal(784.8);
      expect(quote.nightlyRates).to.deep.equal([240]);
      expect(quote.subtotal).to.equal(720);
    });

    it('accepts a comma-joined roomTypes string, as a query string supplies it', () => {
      // Repeated query keys arrive as an array, a single key as a string. Both
      // spellings have to reach the same quote or the GET and POST paths price
      // the same stay differently.
      const fromString = quoteOf({ ...VALID, roomTypes: 'deluxe-king,standard-queen' });
      const fromArray = quoteOf({ ...VALID, roomTypes: ['deluxe-king', 'standard-queen'] });

      expect(fromString.roomTypes).to.deep.equal(['deluxe-king', 'standard-queen']);
      expect(fromString.totalPrice).to.equal(fromArray.totalPrice);
    });

    it('rounds tax and total to whole cents', () => {
      // Spread first, overrides after: stayOfNights re-spreads VALID, so putting
      // it last silently reverts roomTypes and prices a different stay.
      const quote = quoteOf({
        ...stayOfNights(7),
        roomTypes: ['standard-queen', 'standard-queen', 'standard-queen'],
      });

      // 180 × 3 rooms × 7 nights = 3780. 9% of that is 340.2 in decimal but
      // 340.20000000000005 in binary floating point, which would otherwise put a
      // fraction of a cent on the invoice and disagree with the Stripe total.
      expect(quote.subtotal).to.equal(3780);
      expect(quote.taxes).to.equal(340.2);
      expect(quote.totalPrice).to.equal(4120.2);
    });

    it('trims surrounding whitespace on ids', () => {
      const quote = quoteOf({
        ...VALID,
        destinationId: '  RsBU  ',
        hotelId: '  marina-bay  ',
        hotelName: '  Marina Bay Sands  ',
        roomTypes: [' deluxe-king '],
      });

      expect(quote.destinationId).to.equal('RsBU');
      expect(quote.hotelId).to.equal('marina-bay');
      expect(quote.hotelName).to.equal('Marina Bay Sands');
      expect(quote.roomTypes).to.deep.equal(['deluxe-king']);
    });
  });

  describe('destinationId, hotelId and hotelName', () => {
    it('rejects a missing destinationId', () => {
      expect(errorOf({ ...VALID, destinationId: undefined })).to.match(/valid destinationId/i);
      expect(errorOf({ ...VALID, destinationId: '   ' })).to.match(/valid destinationId/i);
    });

    it('rejects a missing hotelId or hotelName', () => {
      expect(errorOf({ ...VALID, hotelId: '' })).to.match(/valid hotelId/i);
      expect(errorOf({ ...VALID, hotelName: '  ' })).to.match(/valid hotelName/i);
    });

    it('bounds the length of every free-text id', () => {
      // An unbounded id is a storage and log-injection surface, and hotel_name
      // is written straight into a text column.
      expect(errorOf({ ...VALID, destinationId: 'x'.repeat(65) })).to.match(/destinationId/i);
      expect(quoteOf({ ...VALID, destinationId: 'x'.repeat(64) }).destinationId).to.have.length(64);

      expect(errorOf({ ...VALID, hotelId: 'x'.repeat(65) })).to.match(/hotelId/i);
      expect(quoteOf({ ...VALID, hotelId: 'x'.repeat(64) }).hotelId).to.have.length(64);

      expect(errorOf({ ...VALID, hotelName: 'x'.repeat(201) })).to.match(/hotelName/i);
      expect(quoteOf({ ...VALID, hotelName: 'x'.repeat(200) }).hotelName).to.have.length(200);
    });

    it('rejects non-string ids rather than stringifying them', () => {
      expect(errorOf({ ...VALID, hotelId: 12345 })).to.match(/valid hotelId/i);
      expect(errorOf({ ...VALID, hotelName: { toString: () => 'evil' } })).to.match(
        /valid hotelName/i
      );
    });
  });

  describe('roomTypes', () => {
    // Regression: an unknown room used to be priced rather than refused, which
    // let a client invent a room id to get a cheaper rate.
    it('refuses a room type absent from the rate table instead of pricing it', () => {
      expect(errorOf({ ...VALID, roomTypes: ['presidential-penthouse'] })).to.match(
        /not available/i
      );
      expect(errorOf({ ...VALID, roomTypes: ['deluxe-king', 'invented-cheap-room'] })).to.match(
        /not available/i
      );
    });

    /** A plain `ROOM_RATES[roomType]` returns a function for any key inherited from Object.prototype, so `=== undefined` waves it straight past the guard and it is multiplied into a NaN subtotal. */
    it('does not treat inherited Object properties as room types', () => {
      for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
        expect(errorOf({ ...VALID, roomTypes: [key] }), key).to.match(/not available/i);
      }
    });

    it('requires at least one room', () => {
      expect(errorOf({ ...VALID, roomTypes: [] })).to.match(/between 1 and/i);
      expect(errorOf({ ...VALID, roomTypes: '' })).to.match(/between 1 and/i);
      expect(errorOf({ ...VALID, roomTypes: '  ,  ' })).to.match(/between 1 and/i);
      expect(errorOf({ ...VALID, roomTypes: undefined })).to.match(/between 1 and/i);
    });

    it('rejects a roomTypes value that is neither array nor string', () => {
      expect(errorOf({ ...VALID, roomTypes: 7 })).to.match(/between 1 and/i);
      expect(errorOf({ ...VALID, roomTypes: [7] })).to.match(/between 1 and/i);
      expect(errorOf({ ...VALID, roomTypes: { 0: 'deluxe-king' } })).to.match(/between 1 and/i);
    });

    it('accepts exactly MAX_ROOMS rooms and rejects one more', () => {
      const rooms = Array.from({ length: MAX_ROOMS }, () => 'standard-queen');

      expect(quoteOf({ ...VALID, roomTypes: rooms }).roomTypes).to.have.length(MAX_ROOMS);
      expect(errorOf({ ...VALID, roomTypes: [...rooms, 'standard-queen'] })).to.match(
        /between 1 and/i
      );
    });
  });

  describe('dates', () => {
    it('rejects a malformed date', () => {
      expect(errorOf({ ...VALID, startDate: 'not-a-date' })).to.match(/YYYY-MM-DD/);
      expect(errorOf({ ...VALID, endDate: '01-08-2026' })).to.match(/YYYY-MM-DD/);
    });

    it('rejects a well-shaped but impossible date', () => {
      expect(errorOf({ ...VALID, startDate: '2026-13-45' })).to.match(/YYYY-MM-DD/);
    });

    it('rejects a missing date', () => {
      expect(errorOf({ ...VALID, startDate: undefined })).to.match(/YYYY-MM-DD/);
      expect(errorOf({ ...VALID, endDate: null })).to.match(/YYYY-MM-DD/);
    });

    it('rejects a same-day or reversed stay', () => {
      expect(errorOf({ ...VALID, endDate: VALID.startDate })).to.match(/after startDate/i);
      expect(errorOf({ ...VALID, startDate: '2026-08-04', endDate: '2026-08-01' })).to.match(
        /after startDate/i
      );
    });

    it('accepts a single-night stay', () => {
      expect(quoteOf(stayOfNights(1)).nights).to.equal(1);
    });

    it('accepts a stay of exactly MAX_NIGHTS', () => {
      expect(quoteOf(stayOfNights(MAX_NIGHTS)).nights).to.equal(MAX_NIGHTS);
    });

    it('rejects a stay of MAX_NIGHTS + 1', () => {
      // Without a ceiling, a decade-long stay prices into six figures and is
      // sent to Stripe as a real charge.
      expect(errorOf(stayOfNights(MAX_NIGHTS + 1))).to.match(
        new RegExp(`limited to ${MAX_NIGHTS} nights`, 'i')
      );
    });
  });

  describe('occupancy', () => {
    it('requires at least one adult', () => {
      expect(errorOf({ ...VALID, adults: 0 })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, adults: -1 })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, adults: undefined })).to.match(/at least one adult/i);
    });

    it('allows zero children but not a negative count', () => {
      expect(quoteOf({ ...VALID, children: 0 }).children).to.equal(0);
      expect(errorOf({ ...VALID, children: -1 })).to.match(/zero or more/i);
    });

    it('defaults children to zero when the field is absent', () => {
      // The search form omits it entirely for an adults-only stay; treating that
      // as invalid would reject the most common booking there is.
      expect(quoteOf({ ...VALID, children: undefined }).children).to.equal(0);
      expect(quoteOf({ ...VALID, children: null }).children).to.equal(0);
    });

    it('rejects fractional counts', () => {
      // 2.5 adults would otherwise price as a real amount.
      expect(errorOf({ ...VALID, adults: 1.5 })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, children: 0.5 })).to.match(/zero or more/i);
    });

    it('rejects NaN, Infinity and non-numeric strings', () => {
      // typeof NaN === 'number' and NaN < 1 is false, so a plain range check
      // lets both through and the stay prices to NaN.
      expect(errorOf({ ...VALID, adults: NaN })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, adults: Infinity })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, adults: 'abc' })).to.match(/at least one adult/i);
      expect(errorOf({ ...VALID, children: NaN })).to.match(/zero or more/i);
      expect(errorOf({ ...VALID, children: Infinity })).to.match(/zero or more/i);
      expect(errorOf({ ...VALID, children: 'abc' })).to.match(/zero or more/i);
    });

    it('accepts numeric strings, since query params arrive as strings', () => {
      const quote = quoteOf({ ...VALID, adults: '4', children: '2' });

      expect(quote.adults).to.equal(4);
      expect(quote.children).to.equal(2);
    });

    it('caps adults plus children at MAX_GUESTS', () => {
      expect(quoteOf({ ...VALID, adults: MAX_GUESTS, children: 0 }).adults).to.equal(MAX_GUESTS);
      expect(quoteOf({ ...VALID, adults: MAX_GUESTS - 1, children: 1 }).children).to.equal(1);
      expect(errorOf({ ...VALID, adults: MAX_GUESTS, children: 1 })).to.match(
        new RegExp(`limited to ${MAX_GUESTS} guests`, 'i')
      );
      expect(errorOf({ ...VALID, adults: MAX_GUESTS + 1 })).to.match(
        new RegExp(`limited to ${MAX_GUESTS} guests`, 'i')
      );
    });
  });

  describe('the final total', () => {
    it('never returns a non-finite or non-positive total', () => {
      // Whatever the input, the outcome is either a usable price or an error —
      // never a quote carrying NaN, Infinity, or zero. A NaN total reaches
      // Stripe as an invalid unit_amount and a zero one is a free stay.
      const hostile: unknown[] = [
        VALID,
        { ...VALID, adults: Number.MAX_SAFE_INTEGER },
        { ...VALID, children: Number.MAX_VALUE },
        { ...VALID, adults: '1e308' },
        { ...VALID, roomTypes: ['__proto__'] },
        { ...VALID, roomTypes: Array.from({ length: 1000 }, () => 'executive-suite') },
        {},
        null,
        undefined,
        'not an object',
        [],
      ];

      for (const input of hostile) {
        const result = buildQuote(input);
        if ('error' in result) continue;
        expect(Number.isFinite(result.quote.totalPrice)).to.equal(true);
        expect(result.quote.totalPrice).to.be.greaterThan(0);
        expect(Number.isFinite(result.quote.subtotal)).to.equal(true);
        expect(Number.isFinite(result.quote.taxes)).to.equal(true);
      }
    });

    it('returns an error rather than throwing on junk input', () => {
      for (const input of [null, undefined, 'string', 42, [], {}, true]) {
        expect(() => buildQuote(input)).to.not.throw();
        expect(buildQuote(input)).to.have.property('error');
      }
    });
  });
});

describe('validateGuestDetails', () => {
  const VALID_GUEST = {
    salutation: 'Ms',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
  };

  it('accepts complete, well-formed details', () => {
    expect(validateGuestDetails(VALID_GUEST)).to.deep.equal({});
  });

  it('reports every missing field at once', () => {
    // One round trip should surface all problems, not the first, or the guest
    // fixes five fields over five submissions.
    const errors = validateGuestDetails({});

    expect(errors).to.have.keys('salutation', 'firstName', 'lastName', 'email', 'phone');
  });

  it('treats whitespace-only values as missing', () => {
    const errors = validateGuestDetails({
      salutation: ' ',
      firstName: '   ',
      lastName: '  ',
      email: ' ',
      phone: '  ',
    });

    expect(errors).to.have.keys('salutation', 'firstName', 'lastName', 'email', 'phone');
  });

  it('treats non-string values as missing rather than coercing them', () => {
    const errors = validateGuestDetails({
      salutation: 1,
      firstName: { toString: () => 'Jane' },
      lastName: ['Tan'],
      email: 42,
      phone: null,
    } as unknown as Partial<GuestDetails>);

    expect(errors).to.have.keys('salutation', 'firstName', 'lastName', 'email', 'phone');
  });

  describe('salutation', () => {
    it('accepts every allowlisted title', () => {
      for (const salutation of ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof']) {
        expect(
          validateGuestDetails({ ...VALID_GUEST, salutation }),
          salutation
        ).to.not.have.property('salutation');
      }
    });

    it('refuses anything outside the allowlist', () => {
      // guest_salutation is printed on correspondence and stored forever, so it
      // takes an allowlisted value or nothing — free text here is a persistent
      // injection surface with no upside.
      for (const salutation of ['Sir', 'Lord', 'mr', 'MR', 'Mr.', '<script>', 'Prof.']) {
        expect(
          validateGuestDetails({ ...VALID_GUEST, salutation }),
          salutation
        ).to.have.property('salutation');
      }
    });

    it('trims before checking the allowlist, so a stray space is not a rejection', () => {
      // The value is trimmed on the way in and stored trimmed, so matching the
      // untrimmed string would reject a title that is about to be valid.
      expect(validateGuestDetails({ ...VALID_GUEST, salutation: ' Ms ' })).to.not.have.property(
        'salutation'
      );
    });

    it('names the allowed values in the message so the client can render them', () => {
      const errors = validateGuestDetails({ ...VALID_GUEST, salutation: 'Sir' });

      expect(errors.salutation).to.contain('Mr');
      expect(errors.salutation).to.contain('Prof');
    });
  });

  describe('names', () => {
    it('accepts a single character, since some legal names are one letter', () => {
      expect(validateGuestDetails({ ...VALID_GUEST, firstName: 'J' })).to.not.have.property(
        'firstName'
      );
      expect(validateGuestDetails({ ...VALID_GUEST, lastName: 'O' })).to.not.have.property(
        'lastName'
      );
    });

    it('rejects a name over 100 characters but accepts exactly 100', () => {
      expect(
        validateGuestDetails({ ...VALID_GUEST, firstName: 'a'.repeat(101) })
      ).to.have.property('firstName');
      expect(
        validateGuestDetails({ ...VALID_GUEST, firstName: 'a'.repeat(100) })
      ).to.not.have.property('firstName');
      expect(
        validateGuestDetails({ ...VALID_GUEST, lastName: 'a'.repeat(101) })
      ).to.have.property('lastName');
    });

    it('reports the two name fields independently', () => {
      // They are separate columns; a client that highlights one input must not
      // be told the other is wrong.
      const errors = validateGuestDetails({ ...VALID_GUEST, lastName: '' });

      expect(errors).to.have.property('lastName');
      expect(errors).to.not.have.property('firstName');
    });
  });

  describe('email', () => {
    it('rejects addresses without a user, host, or dotted TLD', () => {
      for (const email of ['notanemail', '@example.com', 'jane@', 'jane@example', 'a b@c.com']) {
        expect(validateGuestDetails({ ...VALID_GUEST, email }), email).to.have.property('email');
      }
    });

    it('accepts ordinary real-world addresses', () => {
      for (const email of [
        'jane@example.com',
        'jane.tan+booking@sub.example.co.uk',
        '1009128@mymail.sutd.edu.sg',
      ]) {
        expect(validateGuestDetails({ ...VALID_GUEST, email }), email).to.not.have.property(
          'email'
        );
      }
    });

    it('rejects an address over the RFC length limit', () => {
      const long = `${'a'.repeat(250)}@example.com`;

      expect(validateGuestDetails({ ...VALID_GUEST, email: long })).to.have.property('email');
    });
  });

  describe('phone', () => {
    it('accepts international and spaced formats', () => {
      for (const phone of ['+65 9123 4567', '91234567', '+44-20-7946-0958']) {
        expect(validateGuestDetails({ ...VALID_GUEST, phone }), phone).to.not.have.property(
          'phone'
        );
      }
    });

    it('rejects letters and too-short or too-long numbers', () => {
      for (const phone of ['abcdefgh', '123', '1'.repeat(21), 'call me']) {
        expect(validateGuestDetails({ ...VALID_GUEST, phone }), phone).to.have.property('phone');
      }
    });
  });

  describe('special requests', () => {
    it('is optional', () => {
      expect(validateGuestDetails(VALID_GUEST)).to.not.have.property('specialRequests');
      expect(
        validateGuestDetails({ ...VALID_GUEST, specialRequests: '' })
      ).to.not.have.property('specialRequests');
      expect(
        validateGuestDetails({ ...VALID_GUEST, specialRequests: null })
      ).to.not.have.property('specialRequests');
    });

    it('is bounded at 500 characters', () => {
      // It has to fit one Stripe metadata value on the way out to the hosted
      // page; over the limit Stripe rejects the whole session, which would
      // surface as an opaque failure at the last step of the funnel.
      expect(
        validateGuestDetails({ ...VALID_GUEST, specialRequests: 'a'.repeat(500) })
      ).to.not.have.property('specialRequests');
      expect(
        validateGuestDetails({ ...VALID_GUEST, specialRequests: 'a'.repeat(501) })
      ).to.have.property('specialRequests');
    });
  });
});

/** Billing address validation. */
describe('validateBillingAddress', () => {
  const VALID = {
    line1: '10 Bayfront Avenue',
    line2: '#12-34',
    city: 'Singapore',
    state: null,
    postalCode: '018956',
    country: 'SG',
  };

  it('accepts a complete address', () => {
    expect(validateBillingAddress(VALID)).to.deep.equal({});
  });

  it('accepts an address with no line2 or state', () => {
    // Plenty of the world has neither, and rejecting them would block a sale.
    // Omitted rather than set to undefined: exactOptionalPropertyTypes draws a
    // distinction between the two, and absent is what a real form sends.
    const { line2: _line2, state: _state, ...withoutOptionals } = VALID;

    expect(validateBillingAddress(withoutOptionals)).to.deep.equal({});
  });

  it('reports every missing field at once', () => {
    const errors = validateBillingAddress({});

    expect(errors).to.have.keys('line1', 'city', 'postalCode', 'country');
  });

  it('treats whitespace-only values as missing', () => {
    const errors = validateBillingAddress({
      line1: '   ',
      city: ' ',
      postalCode: '  ',
      country: ' ',
    });

    expect(errors).to.have.keys('line1', 'city', 'postalCode', 'country');
  });

  it('requires an ISO 3166-1 alpha-2 country code', () => {
    // Stripe matches on the two-letter code; a full country name silently
    // weakens the AVS check rather than failing loudly.
    for (const country of ['Singapore', 'SGP', 'S', '65', '']) {
      expect(validateBillingAddress({ ...VALID, country }), country).to.have.property('country');
    }
    expect(validateBillingAddress({ ...VALID, country: 'sg' })).to.deep.equal({});
  });

  it('accepts the postal formats real countries actually use', () => {
    for (const postalCode of ['018956', 'SW1A 1AA', '10001', 'K1A 0B1', '75008']) {
      expect(
        validateBillingAddress({ ...VALID, postalCode }),
        postalCode
      ).to.not.have.property('postalCode');
    }
  });

  it('rejects a postal code that could not belong to anywhere', () => {
    for (const postalCode of ['!', '@@@@', 'x'.repeat(13)]) {
      expect(
        validateBillingAddress({ ...VALID, postalCode }),
        postalCode
      ).to.have.property('postalCode');
    }
  });

  it('bounds every free-text field', () => {
    // These land in text columns and in Stripe metadata, which caps a value at
    // 500 characters and rejects the whole request if one is over.
    expect(validateBillingAddress({ ...VALID, line1: 'x'.repeat(201) })).to.have.property('line1');
    expect(validateBillingAddress({ ...VALID, line2: 'x'.repeat(201) })).to.have.property('line2');
    expect(validateBillingAddress({ ...VALID, city: 'x'.repeat(101) })).to.have.property('city');
    expect(validateBillingAddress({ ...VALID, state: 'x'.repeat(101) })).to.have.property('state');
  });

  it('does not throw on junk input', () => {
    for (const input of [undefined, {}, { line1: 42 }, { country: [] }]) {
      expect(() => validateBillingAddress(input as never)).to.not.throw();
    }
  });
});