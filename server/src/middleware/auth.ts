import { type Request, type Response, type NextFunction } from 'express';

/**
 * Turn the caller's Supabase access token into a verified user id.  Core rule:
 * a user id in a request body or URL path is an identifier, not a credential
 * (anyone can type a UUID).
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
 * Verification cache: skip the Supabase round trip for a token verified
 * moments ago (/payment-intent and /confirm land seconds apart, and the
 * profile modal refetches on every open).  Kept short so a signed-out session
 * only looks live for one minute, and only successes are cached — a rejection
 * is cheap to repeat and must not stick.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

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
  // Evict oldest-first once full, keeping the map bounded on a long-running
  // process (tokens rotate on refresh, so entries accumulate — and Map
  // preserves insertion order, so the first key is the oldest).
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

/** Lazy import: supabaseClient throws at module scope when env vars are absent. */
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
    // Transport failure, not a rejection: getUser throws on some network
    // errors, so answer 503 rather than letting an outage read as an
    // invalid session.
    return { ok: false, status: 503, error: 'Could not verify your session. Please try again.' };
  }

  if (error) {
    /**
     * Status split: a 4xx from the auth API means the token really was
     * rejected (401 back).  Anything else means Supabase could not answer (503
     * back), keeping a guest mid-payment from being signed out by an outage on
     * our side.
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
 * Optional authentication: set req.auth when a token is presented, pass a
 * guest with no token straight through, and still reject a bad token — falling
 * through to anonymous would write the booking with no user_id and silently
 * hide it from the guest's booking history.
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
