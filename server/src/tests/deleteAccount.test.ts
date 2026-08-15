import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { randomUUID } from 'crypto';
import request from 'supertest';
import nock from 'nock';
import { app } from './setup.js';
import { signIn } from './helpers/authNock.js';
import { resetRateLimits } from '../middleware/rateLimit.js';

/**
 * DELETE /api/users/:uid — the most destructive request this API accepts, and
 * until now the only route with no functional test of its own.
 *
 * Deleting the auth user cascades to their profile row, so the entitlement
 * check is the whole defence: an authenticated caller may delete themselves and
 * nobody else.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';

/** Supabase's admin delete, faked at the socket like every other upstream. */
const expectAdminDelete = (userId: string, status = 200) =>
  nock(SUPABASE_URL).delete(`/auth/v1/admin/users/${userId}`).reply(status, status === 200 ? {} : { message: 'boom' });

describe('DELETE /api/users/:uid — account deletion', () => {
  beforeEach(() => {
    resetRateLimits();
    nock.cleanAll();
  });

  /**
   * Leave no interceptor behind. hotelName.test.ts asserts nock.isDone(),
   * which is global, so an unconsumed interceptor from this file fails a suite
   * that never touched it.
   */
  afterEach(() => {
    nock.cleanAll();
  });

  it('deletes the caller’s own account', async () => {
    const session = signIn();
    const scope = expectAdminDelete(session.userId);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(200);
    expect(response.body.success).to.equal(true);
    expect(scope.isDone(), 'the admin delete must actually be issued').to.equal(true);
  });

  /** The entitlement check. Without it, one token deletes any account. */
  it('refuses to delete somebody else’s account', async () => {
    const session = signIn();
    const victim = randomUUID();
    // No interceptor on purpose: globalSetup blocks outbound sockets, so a
    // delete that escaped the entitlement check would fail this test by
    // erroring rather than quietly succeeding.
    const response = await request(app).delete(`/api/users/${victim}`).set(session.header);

    expect(response.status).to.equal(403);
  });

  /** 403, not 404: the caller is authenticated, just not entitled — and a 404 would confirm which ids exist. */
  it('answers 403 rather than 404, so it cannot be used to enumerate accounts', async () => {
    const session = signIn();

    const response = await request(app).delete(`/api/users/${randomUUID()}`).set(session.header);

    expect(response.status).to.equal(403);
    expect(JSON.stringify(response.body)).to.not.match(/not found/i);
  });

  it('rejects an unauthenticated caller before looking at the id', async () => {
    const response = await request(app).delete(`/api/users/${randomUUID()}`);

    expect(response.status).to.equal(401);
  });

  it('rejects a malformed id', async () => {
    const session = signIn();

    for (const id of ['not-a-uuid', '../../etc/passwd', "' or 1=1", 'x'.repeat(4096)]) {
      resetRateLimits();
      const response = await request(app).delete(`/api/users/${encodeURIComponent(id)}`).set(session.header);
      expect(response.status, `id=${id.slice(0, 24)}`).to.be.oneOf([400, 403, 404]);
    }
  });

  /** Supabase's own message names the id and what the admin API thinks of it, so it stays server-side. */
  it('withholds the upstream message when deletion fails, and returns a correlation id', async () => {
    const session = signIn();
    expectAdminDelete(session.userId, 500);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(500);
    expect(response.body.correlationId, 'a handle for the server log').to.be.a('string');
    expect(JSON.stringify(response.body)).to.not.match(/supabase|boom|auth\/v1/i);
  });
});
