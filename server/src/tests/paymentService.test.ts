import './env.js';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import Stripe from 'stripe';
import { toMinorUnits, toSafeError } from '../services/paymentService.js';

/**
 * Unit tests for the two pure helpers in paymentService.
 *
 * These are deliberately not driven through HTTP. An endpoint test asserts that
 * a redirect URL came back; it cannot see that the amount attached to the Stripe
 * line item was off by 100x, because the simulated gateway never looks at it.
 * The same applies to toSafeError — a 500 body looks identical whether or not
 * the API key leaked into it.
 */

/** Silences the correlation-id log so a passing run stays readable. */
const withSilencedErrorLog = <T>(fn: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

describe('paymentService.toMinorUnits', () => {
  it('converts a two-decimal currency to cents', () => {
    expect(toMinorUnits(784.8, 'SGD')).to.equal(78480);
    expect(toMinorUnits(0, 'SGD')).to.equal(0);
  });

  it('survives binary floating-point representation error', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE-754. Truncating instead of
    // rounding would undercharge by a cent on a very common price shape.
    expect(19.99 * 100).to.not.equal(1999);
    expect(toMinorUnits(19.99, 'SGD')).to.equal(1999);
  });

  it('does not multiply zero-decimal currencies', () => {
    // The 100x overcharge this guards against: ¥5000 must bill as 5000, not 500000.
    expect(toMinorUnits(5000, 'JPY')).to.equal(5000);
    expect(toMinorUnits(15000, 'KRW')).to.equal(15000);
    expect(toMinorUnits(1234.6, 'VND')).to.equal(1235);
  });

  it('scales three-decimal currencies by 1000', () => {
    expect(toMinorUnits(12.345, 'KWD')).to.equal(12345);
    expect(toMinorUnits(1.5, 'BHD')).to.equal(1500);
  });

  it('is case-insensitive in the currency code', () => {
    // Stripe wants lowercase codes, our rate table holds uppercase; a
    // case-sensitive lookup here would silently fall through to the 2-decimal
    // default and overcharge JPY by 100x.
    expect(toMinorUnits(5000, 'jpy')).to.equal(toMinorUnits(5000, 'JPY'));
    expect(toMinorUnits(12.345, 'kwd')).to.equal(12345);
  });

  it('rounds half-way amounts to a whole minor unit', () => {
    expect(toMinorUnits(10.005, 'SGD')).to.equal(1001);
    expect(Number.isInteger(toMinorUnits(33.333, 'SGD'))).to.equal(true);
  });
});

describe('paymentService.toSafeError', () => {
  it('maps a known decline_code to its allowlisted message', () => {
    const error = new Stripe.errors.StripeCardError({
      type: 'card_error',
      code: 'card_declined',
      decline_code: 'insufficient_funds',
      message: 'Your card has insufficient funds.',
    } as never);

    const safe = toSafeError(error);

    expect(safe.message).to.equal('Your card has insufficient funds.');
    expect(safe.correlationId).to.equal(undefined);
  });

  it('maps a card error carrying only `code` to its specific message', () => {
    // Stripe leaves decline_code as an empty string rather than undefined when
    // the raw payload omits it, so this only works if the fallback to `code`
    // treats '' as absent. With `??` it does not, and every expired card is
    // reported as a generic decline.
    const error = new Stripe.errors.StripeCardError({
      type: 'card_error',
      code: 'expired_card',
      message: 'raw stripe message',
    } as never);

    expect(error.decline_code).to.equal('');

    const safe = toSafeError(error);

    expect(safe.message).to.equal('That card has expired. Please use a different card.');
    expect(safe.correlationId).to.equal(undefined);
  });

  it('falls back to a generic decline for an unrecognised card error code', () => {
    const error = new Stripe.errors.StripeCardError({
      type: 'card_error',
      code: 'some_unmapped_future_code',
      message: 'raw stripe message',
    } as never);

    const safe = toSafeError(error);

    expect(safe.message).to.equal(
      'Your card was declined. Please try a different payment method.'
    );
    expect(safe.correlationId).to.equal(undefined);
  });

  it('never relays a card error message verbatim', () => {
    const error = new Stripe.errors.StripeCardError({
      type: 'card_error',
      code: 'card_declined',
      decline_code: 'card_declined',
      message: 'Invalid API Key provided: sk_test_51H8xQ2****',
    } as never);

    const safe = toSafeError(error);

    expect(safe.message).to.not.contain('sk_test');
    expect(safe.message).to.not.contain('API Key');
  });

  it('withholds non-card error detail behind a correlation id', () => {
    const error = new Error('Invalid API Key provided: sk_test_51H8xQ2DEADBEEF');

    const safe = withSilencedErrorLog(() => toSafeError(error));

    expect(safe.message).to.equal(
      'Payment could not be processed. Please try again or contact support.'
    );
    expect(safe.message).to.not.contain('sk_test');
    expect(safe.correlationId).to.be.a('string');
    expect(safe.correlationId).to.match(/^err_[a-z0-9]+$/);
  });

  it('logs the underlying error against the correlation id it returns', () => {
    // The id is only useful if support can find the real error by it.
    const error = new Error('upstream exploded');
    const original = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };

    let safe;
    try {
      safe = toSafeError(error);
    } finally {
      console.error = original;
    }

    expect(logged).to.have.lengthOf(1);
    expect(String(logged[0]?.[0])).to.contain(safe.correlationId as string);
    expect(logged[0]?.[1]).to.equal(error);
  });

  it('issues a distinct correlation id per call', () => {
    const ids = withSilencedErrorLog(() =>
      Array.from({ length: 50 }, () => toSafeError(new Error('boom')).correlationId)
    );

    expect(new Set(ids).size).to.equal(ids.length);
  });

  it('handles a thrown non-Error value without crashing', () => {
    const safe = withSilencedErrorLog(() => toSafeError('just a string'));

    expect(safe.message).to.contain('could not be processed');
    expect(safe.correlationId).to.be.a('string');
  });
});
