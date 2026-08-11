import { randomUUID } from 'crypto';
import { afterEach } from 'mocha';
import nock from 'nock';
import { __clearAuthCache } from '../../middleware/auth.js';

/** nock harness for Supabase token verification. */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';

export interface FakeSession {
  userId: string;
  token: string;
  /** Ready to spread into supertest's .set(). */
  header: { Authorization: string };
}

/** Makes `token` verify as `userId` for the rest of the test. */
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

/** Makes any *other* token verify as rejected rather than unreachable. */
export const signInRejectsOthers = (): void => {
  nock(SUPABASE_URL)
    .persist()
    .get('/auth/v1/user')
    .reply(401, { message: 'invalid claim: missing sub claim' });
};

/** Clears verified tokens between tests. */
export const useAuthNock = (): void => {
  afterEach(() => {
    __clearAuthCache();
  });
};