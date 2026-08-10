import { type Request, type Response, type NextFunction } from 'express';

/**
 * Minimal fixed-window rate limiter, hand-written to keep the dependency
 * lockfile untouched (no express-rate-limit).
 *
 * Scaling guardrail: the buckets live in-process, so limits do not hold across
 * replicas. Two things gate running more than one instance:
 *   1. A unique constraint on bookings.payment_id in the database — without it
 *      a second replica silently defeats bookingModel's duplicate lock. Fix
 *      first (money-correctness).
 *   2. This store — N replicas make every limit N× its configured value. Fix
 *      second (degraded protection, not corruption).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Sweep expired buckets, keeping the map bounded on a long-running process. */
const sweep = (now: number) => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

let lastSweep = Date.now();

/** Test hook: supertest reuses one loopback address, so state must be clearable. */
export const resetRateLimits = (): void => {
  buckets.clear();
};

export const rateLimit = (options: { windowMs: number; max: number }) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    if (now - lastSweep > options.windowMs) {
      sweep(now);
      lastSweep = now;
    }

    /**
     * Key on the route pattern, not the concrete path. req.path resolves
     * `/api/bookings/:id` to the full URL, handing every distinct id a fresh
     * bucket — a scanner walking ids would never be throttled on an endpoint
     * that returns full booking records. Pattern-keying also bounds the map to
     * one entry per (address, route).
     *
     * Fallback: req.route is undefined on a 404 (no route matched), so use the
     * path there — nothing is enumerable through a route that does not exist.
     */
    const routeKey =
      (req.route as { path?: string } | undefined)?.path ?? req.path;

    // req.ip honours `trust proxy`; fall back so the limiter never crashes.
    const key = `${req.ip ?? 'unknown'}:${req.baseUrl}${routeKey}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }

    next();
  };
};
