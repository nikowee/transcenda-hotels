import { type Request, type Response, type NextFunction } from 'express';

/**
 * Turns the caller's Supabase access token into a verified user id.
 *
 * The point of this file is one distinction the rest of the codebase depends
 * on: a user id in a request body or a URL path is an *identifier*, not a
 * *credential*. Anyone can type a UUID. Only the holder of a signed session can
 * produce a token that verifies to it, so `req.auth.userId` — and nothing else
 * — is allowed to decide which account a booking belongs to.
 *
 * Verification goes through supabaseAdmin.auth.getUser, which checks the token
 * against Supabase rather than merely decoding it. That costs a round trip, but
 * it is the only form of the check that honours a signed-out or revoked
 * session; a locally-decoded JWT stays valid until it expires no matter what
 * the user has done since.
 */

export interface AuthenticatedUser {
  userId: string;
  email: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by resolveUser. Absent means the request carried no token at all. */
    auth?: AuthenticatedUser;
  }
}

/**
 * A signed-in guest hits /payment-intent and then /confirm seconds apart, and
 * the profile modal refetches on every open. Verifying the same token on each
 * is a round trip to Supabase in the middle of the payment funnel for an answer
 * that cannot have changed.
 *
 * Deliberately short: this is the window in which a signed-out session still
 * looks live, so it trades a bounded amount of staleness for the latency, and
 * the bound is the thing being tuned. Only successful verifications are cached
 * — a rejection is cheap to repeat and must not be sticky.
 */
const DEFAULT_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * `??` alone is not enough here. dotenv assigns the empty string to a key
 * written as `AUTH_CACHE_MS=`, and `'' ?? default` is `''`, which Number()
 * turns into 0 — so the documented "leave blank for the default" would in fact
 * disable the cache. Anything that is not a usable number falls back.
 */
const CACHE_TTL_MS = (() => {
  const configured = Number(process.env.AUTH_CACHE_MS);
  return process.env.AUTH_CACHE_MS && Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_CACHE_TTL_MS;
})();

interface CacheEntry {
  user: AuthenticatedUser;
  expiresAt: number;
}

const verifiedTokens = new Map<string, CacheEntry>();

const readCache = (token: string): AuthenticatedUser | null => {
  const entry = verifiedTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    verifiedTokens.delete(token);
    return null;
  }
  return entry.user;
};

const writeCache = (token: string, user: AuthenticatedUser): void => {
  // Tokens rotate on refresh, so entries accumulate rather than being
  // overwritten. Evicting oldest-first keeps the map bounded on a long-running
  // process; Map preserves insertion order, so the first key is the oldest.
  if (verifiedTokens.size >= CACHE_MAX_ENTRIES) {
    const oldest = verifiedTokens.keys().next().value;
    if (oldest !== undefined) verifiedTokens.delete(oldest);
  }
  verifiedTokens.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });
};

/** Test seam: verification results outlive a single suite otherwise. */
export const __clearAuthCache = (): void => {
  verifiedTokens.clear();
};

/** `Authorization: Bearer <token>`, or null when the header is absent. */
const readBearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
};

/** Lazy: ../lib/supabaseClient throws at module scope when env vars are absent. */
const getClient = async () => {
  const { supabaseAdmin } = await import('../lib/supabaseClient.js');
  return supabaseAdmin;
};

type VerifyOutcome =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; status: 401 | 503; error: string };

const verifyToken = async (token: string): Promise<VerifyOutcome> => {
  const cached = readCache(token);
  if (cached) return { ok: true, user: cached };

  let data;
  let error;
  try {
    ({ data, error } = await (await getClient()).auth.getUser(token));
  } catch {
    // getUser throws rather than returning an error for some transport
    // failures. Either way the token was not rejected — we simply could not
    // ask — so this must not read as "your session is invalid".
    return { ok: false, status: 503, error: 'Could not verify your session. Please try again.' };
  }

  if (error) {
    /**
     * A 4xx from the auth API means the token really was rejected. Anything
     * else — a timeout, DNS, a 5xx — means Supabase could not answer, and
     * answering 401 there would sign a guest out in the middle of paying for a
     * booking because of an outage on our side.
     */
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
    }
    return { ok: false, status: 503, error: 'Could not verify your session. Please try again.' };
  }

  if (!data?.user?.id) {
    return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
  }

  const user: AuthenticatedUser = {
    userId: data.user.id,
    email: data.user.email ?? null,
  };
  writeCache(token, user);
  return { ok: true, user };
};

/**
 * Optional authentication: populates req.auth when a token is presented, and
 * lets the request through untouched when none is.
 *
 * A *bad* token is still rejected. Falling through to anonymous would be worse
 * than failing: the guest believes they are signed in, so the booking would be
 * written with no user_id and then be missing from the history page they expect
 * to find it on, with nothing anywhere saying why.
 */
export const resolveUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = readBearerToken(req);
  if (!token) {
    next();
    return;
  }

  const outcome = await verifyToken(token);
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  req.auth = outcome.user;
  next();
};

/** Mandatory authentication. Runs resolveUser's check, then insists on a result. */
export const requireUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!readBearerToken(req)) {
    res.status(401).json({ error: 'Sign in to view this.' });
    return;
  }

  await resolveUser(req, res, () => {
    if (req.auth) next();
  });
};
