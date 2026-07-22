import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { generateBookingReference } from '../models/bookingModel.js';

/**
 * Unit tests for the booking reference generator.
 *
 * The reference is the customer's only handle on their booking — it goes in the
 * confirmation email and is what Manage Booking looks up. Two properties matter
 * and neither is observable through the HTTP tests, which only ever see one
 * reference at a time: collisions, and characters a guest cannot read back over
 * the phone.
 */

/** Mirrors the generator's alphabet: no I, O, 0 or 1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PATTERN = new RegExp(`^TRX-[${ALPHABET}]{10}$`);

describe('bookingModel.generateBookingReference', () => {
  it('produces the TRX-prefixed 10-character shape', () => {
    const reference = generateBookingReference();

    expect(reference).to.match(PATTERN);
    expect(reference).to.have.lengthOf(14);
  });

  it('never emits visually ambiguous characters', () => {
    // I/1 and O/0 are the classic misreads when a reference is dictated or
    // retyped from a printout.
    const suffixes = Array.from({ length: 500 }, () =>
      generateBookingReference().slice(4)
    ).join('');

    expect(suffixes).to.not.match(/[IO01]/);
    expect([...suffixes].every((char) => ALPHABET.includes(char))).to.equal(true);
  });

  it('does not repeat across many draws', () => {
    const references = new Set(
      Array.from({ length: 5000 }, () => generateBookingReference())
    );

    expect(references.size).to.equal(5000);
  });

  it('keeps the alphabet free of modulo bias', () => {
    // The generator maps a 0-255 byte with `byte % alphabet.length`. That is
    // uniform only while the length divides 256; at, say, 30 characters the
    // first 16 would come up 1/8 more often than the rest. This asserts the
    // invariant so a future edit to the alphabet cannot quietly skew it.
    expect(256 % ALPHABET.length).to.equal(0);
  });

  it('spans the whole alphabet rather than a subset', () => {
    const seen = new Set(
      Array.from({ length: 2000 }, () => generateBookingReference().slice(4)).join('')
    );

    expect(seen.size).to.equal(ALPHABET.length);
  });
});
