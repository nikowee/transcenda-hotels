import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { type Request, type Response } from 'express';
import { rateLimit, resetRateLimits } from '../middleware/rateLimit.js';

/**
 * Unit tests for the fixed-window limiter.
 *
 * booking.test.ts proves the limiter throttles. It does not prove the window
 * ever reopens — a limiter that blocks forever passes that test and locks every
 * guest out of checkout after five attempts.
 *
 * Driven with fake req/res objects rather than supertest so the window can be
 * set to milliseconds and expiry observed without a slow test.
 */

interface FakeResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: unknown;
}

interface Call {
  res: FakeResponse;
  passed: boolean;
}

/** Runs the middleware once against a synthetic request. */
const call = (
  middleware: ReturnType<typeof rateLimit>,
  { ip, path = '/api/bookings/payment' }: { ip?: string; path?: string }
): Call => {
  const state: FakeResponse = { statusCode: null, headers: {}, body: undefined };

  const res = {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  } as unknown as Response;

  let passed = false;
  middleware({ ip, path } as Request, res, () => {
    passed = true;
  });

  return { res: state, passed };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('rateLimit middleware', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('admits exactly `max` requests inside one window', () => {
    const middleware = rateLimit({ windowMs: 1000, max: 3 });

    const results = [1, 2, 3].map(() => call(middleware, { ip: '1.1.1.1' }));

    expect(results.every((r) => r.passed)).to.equal(true);
    expect(results.every((r) => r.res.statusCode === null)).to.equal(true);
  });

  it('rejects the request after `max` with 429 and does not call next', () => {
    const middleware = rateLimit({ windowMs: 1000, max: 2 });

    call(middleware, { ip: '1.1.1.1' });
    call(middleware, { ip: '1.1.1.1' });
    const blocked = call(middleware, { ip: '1.1.1.1' });

    expect(blocked.passed).to.equal(false);
    expect(blocked.res.statusCode).to.equal(429);
    expect(blocked.res.body).to.deep.equal({
      error: 'Too many requests. Please try again shortly.',
    });
  });

  it('sends a positive whole-second Retry-After', () => {
    const middleware = rateLimit({ windowMs: 5000, max: 1 });

    call(middleware, { ip: '1.1.1.1' });
    const blocked = call(middleware, { ip: '1.1.1.1' });

    const retryAfter = blocked.res.headers['retry-after'];
    expect(retryAfter).to.be.a('string');
    expect(Number(retryAfter)).to.be.greaterThan(0);
    expect(Number(retryAfter)).to.be.at.most(5);
    expect(Number.isInteger(Number(retryAfter))).to.equal(true);
  });

  it('reopens the window once it elapses', async () => {
    const middleware = rateLimit({ windowMs: 40, max: 1 });

    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(true);
    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(false);

    await sleep(60);

    const afterExpiry = call(middleware, { ip: '1.1.1.1' });
    expect(afterExpiry.passed).to.equal(true);
    expect(afterExpiry.res.statusCode).to.equal(null);
  });

  it('counts each address separately', () => {
    const middleware = rateLimit({ windowMs: 1000, max: 1 });

    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(true);
    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(false);
    // One guest exhausting their allowance must not lock out everyone else.
    expect(call(middleware, { ip: '2.2.2.2' }).passed).to.equal(true);
  });

  it('counts each path separately', () => {
    const middleware = rateLimit({ windowMs: 1000, max: 1 });

    expect(call(middleware, { ip: '1.1.1.1', path: '/api/bookings/payment' }).passed).to.equal(
      true
    );
    expect(call(middleware, { ip: '1.1.1.1', path: '/api/bookings/payment' }).passed).to.equal(
      false
    );
    expect(call(middleware, { ip: '1.1.1.1', path: '/api/bookings/confirm' }).passed).to.equal(
      true
    );
  });

  it('does not crash when req.ip is undefined', () => {
    // req.ip is undefined when `trust proxy` is misconfigured; the limiter must
    // degrade to a shared bucket rather than throw and 500 the payment route.
    const middleware = rateLimit({ windowMs: 1000, max: 1 });

    expect(() => call(middleware, {})).to.not.throw();
    expect(call(middleware, {}).passed).to.equal(false);
  });

  it('clears all buckets on resetRateLimits', () => {
    const middleware = rateLimit({ windowMs: 1000, max: 1 });

    call(middleware, { ip: '1.1.1.1' });
    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(false);

    resetRateLimits();

    expect(call(middleware, { ip: '1.1.1.1' }).passed).to.equal(true);
  });
});
