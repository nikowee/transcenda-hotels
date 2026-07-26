import { type Request, type Response, type NextFunction } from 'express';

/**
 * Minimal fixed-window rate limiter.
 *
 * Written by hand rather than pulling in express-rate-limit because the README
 * forbids adding dependencies on a feature branch. Per-process and in-memory,
 * so it does not hold across replicas — swap for the real library (or a Redis
 * store) before this runs on more than one instance.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-running process. */
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

    // req.ip honours `trust proxy`; fall back so the limiter never crashes.
    const key = `${req.ip ?? 'unknown'}:${req.path}`;
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
