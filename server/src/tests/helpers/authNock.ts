import { randomUUID } from 'crypto';
import { afterEach } from 'mocha';
import nock from 'nock';
import { __clearAuthCache } from '../../middleware/auth.js';

/**
 * nock harness for Supabase token verification.
 *
 * ../../middleware/auth verifies a bearer token by asking Supabase about it,
 * which means a test that wants to be signed in has to answer that question.
 * Intercepting at the socket rather than stubbing the middleware keeps the real
 * code path under test: the header is parsed, the client is constructed, the
 * response is deserialised, and the cache is exercised.
 *
 * SUPABASE_URL is the placeholder from ../env.ts, and globalSetup.ts blocks
 * every non-loopback socket, so nothing here can reach a real project.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';

export interface FakeSession {
  userId: string;
  token: string;
  /** Ready to spread into supertest's .set(). */
  header: { Authorization: string };
}

/**
 * Makes `token` verify as `userId` for the rest of the test.
 *
 * `persist` because one test can make several authenticated calls — a payment
 * intent then a confirmation — and a one-shot interceptor would let the second
 * fall through to the blocked network and fail as a 503.
 */
export const signIn = (userId: string = randomUUID()): FakeSession => {
  const token = `test-token-${randomUUID()}`;

  nock(SUPABASE_URL)
    .persist()
    .get('/auth/v1/user')
    .matchHeader('authorization', `Bearer ${token}`)
    .reply(200, {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${userId}@example.test`,
    });

  return { userId, token, header: { Authorization: `Bearer ${token}` } };
};

/**
 * Makes any *other* token verify as rejected rather than unreachable.
 *
 * Without this an unrecognised token hits the blocked network and the
 * middleware correctly reports 503 — right for an outage, wrong for the thing
 * a test asserting on an expired session means to check.
 */
export const signInRejectsOthers = (): void => {
  nock(SUPABASE_URL)
    .persist()
    .get('/auth/v1/user')
    .reply(401, { message: 'invalid claim: missing sub claim' });
};

/**
 * Clears verified tokens between tests.
 *
 * The middleware caches a successful verification for its 60 s TTL, which
 * outlives a test — a token proven valid in one would stay valid in the next
 * even after its interceptor was removed, so a test could pass on a session it
 * never established. Call inside describe().
 */
export const useAuthNock = (): void => {
  afterEach(() => {
    __clearAuthCache();
  });
};
