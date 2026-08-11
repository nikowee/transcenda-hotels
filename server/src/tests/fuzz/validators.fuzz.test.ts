import { describe, it } from 'mocha';
import { expect } from 'chai';
import fc from 'fast-check';
import { validateGuestDetails, validateBillingAddress } from '../../controllers/bookingController.js';

/**
 * Property-based / fuzz testing for the guest-details and billing-address
 * validators — the gate in front of every payment. Example-based tests in
 * booking.test.ts check specific known cases; this file checks invariants
 * that must hold across the entire input space, including shapes no one
 * thought to write by hand (wrong types, garbage objects, absurd lengths).
 *
 * Run standalone: npm run test:fuzz
 */

const KNOWN_GUEST_KEYS = ['salutation', 'firstName', 'lastName', 'email', 'phone', 'specialRequests'];
const KNOWN_BILLING_KEYS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'];
const SALUTATIONS = ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof'];

/** Any JS value a request body could plausibly hand a field, valid or not. */
const anyFieldValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(undefined),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.object({ maxDepth: 1 })
);

/** A guest-details body shaped correctly but with arbitrary — often invalid — values. */
const garbageGuestArb = fc.record({
  salutation: anyFieldValueArb,
  firstName: anyFieldValueArb,
  lastName: anyFieldValueArb,
  email: anyFieldValueArb,
  phone: anyFieldValueArb,
  specialRequests: anyFieldValueArb,
});

/** A billing body shaped correctly but with arbitrary — often invalid — values. */
const garbageBillingArb = fc.record({
  line1: anyFieldValueArb,
  line2: anyFieldValueArb,
  city: anyFieldValueArb,
  state: anyFieldValueArb,
  postalCode: anyFieldValueArb,
  country: anyFieldValueArb,
});

/** A guest-details body built to actually pass validation, for the success branch. */
const validGuestArb = fc.record({
  salutation: fc.constantFrom(...SALUTATIONS),
  firstName: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  lastName: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  email: fc.emailAddress(),
  phone: fc.constantFrom('+65 9123 4567', '91234567', '+1-555-123-4567', '020 7946 0958'),
  specialRequests: fc.option(fc.string({ maxLength: 500 }), { nil: null }),
});

/** A billing body built to actually pass validation, for the success branch. */
const validBillingArb = fc.record({
  line1: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  line2: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
  city: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  state: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  postalCode: fc.constantFrom('018956', 'SW1A 1AA', '90210', '000000'),
  country: fc.constantFrom('SG', 'US', 'GB', 'MY', 'AU'),
});

describe('validateGuestDetails — fuzz / property tests', function () {
  this.timeout(30_000);

  it('never throws, for any field shape including wrong types', () => {
    fc.assert(
      fc.property(garbageGuestArb, (input) => {
        expect(() => validateGuestDetails(input as never)).not.to.throw();
      })
    );
  });

  it('only ever reports errors on known field names', () => {
    fc.assert(
      fc.property(garbageGuestArb, (input) => {
        const errors = validateGuestDetails(input as never);
        for (const key of Object.keys(errors)) {
          expect(KNOWN_GUEST_KEYS).to.include(key);
        }
      })
    );
  });

  it('every reported error is a non-empty, human-readable message', () => {
    fc.assert(
      fc.property(garbageGuestArb, (input) => {
        const errors = validateGuestDetails(input as never);
        for (const message of Object.values(errors)) {
          expect(typeof message).to.equal('string');
          expect(message.trim().length).to.be.greaterThan(0);
        }
      })
    );
  });

  it('is deterministic — the same input always validates the same', () => {
    fc.assert(
      fc.property(garbageGuestArb, (input) => {
        const first = validateGuestDetails(input as never);
        const second = validateGuestDetails(input as never);
        expect(first).to.deep.equal(second);
      })
    );
  });

  it('a properly-shaped guest always passes with zero errors', () => {
    fc.assert(
      fc.property(validGuestArb, (input) => {
        const errors = validateGuestDetails(input);
        expect(errors).to.deep.equal({});
      })
    );
  });
});

describe('validateBillingAddress — fuzz / property tests', function () {
  this.timeout(30_000);

  it('never throws, for any field shape including wrong types', () => {
    fc.assert(
      fc.property(garbageBillingArb, (input) => {
        expect(() => validateBillingAddress(input as never)).not.to.throw();
      })
    );
  });

  it('never throws when the whole body is missing', () => {
    fc.assert(
      fc.property(fc.constantFrom(undefined, null, {}), (input) => {
        expect(() => validateBillingAddress(input as never)).not.to.throw();
      })
    );
  });

  it('only ever reports errors on known field names', () => {
    fc.assert(
      fc.property(garbageBillingArb, (input) => {
        const errors = validateBillingAddress(input as never);
        for (const key of Object.keys(errors)) {
          expect(KNOWN_BILLING_KEYS).to.include(key);
        }
      })
    );
  });

  it('every reported error is a non-empty, human-readable message', () => {
    fc.assert(
      fc.property(garbageBillingArb, (input) => {
        const errors = validateBillingAddress(input as never);
        for (const message of Object.values(errors)) {
          expect(typeof message).to.equal('string');
          expect(message.trim().length).to.be.greaterThan(0);
        }
      })
    );
  });

  it('is deterministic — the same input always validates the same', () => {
    fc.assert(
      fc.property(garbageBillingArb, (input) => {
        const first = validateBillingAddress(input as never);
        const second = validateBillingAddress(input as never);
        expect(first).to.deep.equal(second);
      })
    );
  });

  it('a properly-shaped billing address always passes with zero errors', () => {
    fc.assert(
      fc.property(validBillingArb, (input) => {
        const errors = validateBillingAddress(input);
        expect(errors).to.deep.equal({});
      })
    );
  });
});