import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { type Request, type Response } from 'express';
import { rateLimit, resetRateLimits } from '../middleware/rateLimit.js';

/** Unit tests for the fixed-window limiter. */

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
  {
    ip,
    path = '/api/bookings/payment',
    route,
    baseUrl = '',
  }: { ip?: string; path?: string; route?: string; baseUrl?: string }
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
  const req = {
    ip,
    path,
    baseUrl,
    ...(route ? { route: { path: route } } : {}),
  } as unknown as Request;
  middleware(req, res, () => {
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

  it('shares one bucket across every id on a wildcard route', () => {
    /** The defect this closes. */
    const middleware = rateLimit({ windowMs: 1000, max: 2 });
    const scan = (id: string) =>
      call(middleware, {
        ip: '1.1.1.1',
        path: `/api/bookings/${id}`,
        route: '/api/bookings/:id',
      });

    expect(scan('11111111-1111-1111-1111-111111111111').passed).to.equal(true);
    expect(scan('22222222-2222-2222-2222-222222222222').passed).to.equal(true);
    // Third distinct id, same route — must be throttled.
    const third = scan('33333333-3333-3333-3333-333333333333');
    expect(third.passed).to.equal(false);
    expect(third.res.statusCode).to.equal(429);
  });

  it('still separates two different wildcard routes', () => {
    // The fix must not collapse genuinely distinct routes into one bucket.
    const middleware = rateLimit({ windowMs: 1000, max: 1 });

    expect(
      call(middleware, { ip: '1.1.1.1', path: '/api/bookings/abc', route: '/api/bookings/:id' })
        .passed
    ).to.equal(true);
    expect(
      call(middleware, { ip: '1.1.1.1', path: '/api/users/abc', route: '/api/users/:uid' }).passed
    ).to.equal(true);
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
