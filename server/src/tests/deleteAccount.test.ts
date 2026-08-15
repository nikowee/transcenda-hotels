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
 * The handler erases the profiles row itself rather than trust an unverified
 * cascade from auth.users, so the entitlement check is the whole defence: an
 * authenticated caller may delete themselves and nobody else.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';

/** Supabase's admin delete, faked at the socket like every other upstream. */
const expectAdminDelete = (userId: string, status = 200, times = 1) =>
  nock(SUPABASE_URL)
    .delete(`/auth/v1/admin/users/${userId}`)
    .times(times)
    .reply(status, status === 200 ? {} : { message: 'boom' });

describe('DELETE /api/users/:uid — account deletion', () => {
  beforeEach(() => {
    resetRateLimits();
    nock.cleanAll();
  });

  /**
   * Leave no interceptor behind. helpers/stripeNock.ts still checks the global
   * nock.isDone(), so an unconsumed interceptor from this file fails a suite
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
      // Exactly 400: a 403 would mean the id reached the entitlement check unvalidated.
      expect(response.status, `id=${id.slice(0, 24)}`).to.equal(400);
    }
  });

  /** Supabase's own message names the id and what the admin API thinks of it, so it stays server-side. */
  it('withholds the upstream message when deletion fails, and returns a correlation id', async () => {
    const session = signIn();
    // 400, not 5xx: a 5xx is retryable, so the loop would spend three attempts
    // on one interceptor — and a 5xx Response stringifies to "{}", leaving no
    // upstream message to withhold and nothing for the regex to catch.
    const scope = expectAdminDelete(session.userId, 400);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(500);
    expect(response.body.correlationId, 'a handle for the server log').to.be.a('string');
    expect(JSON.stringify(response.body)).to.not.match(/supabase|boom|auth\/v1/i);
    expect(scope.isDone(), 'the failure must come from the upstream, not from an unreached mock').to.equal(true);
  });

  /** The erasure is already committed by this point, so a transient hop failure must not strand it. */
  it('retries a transient 5xx and deletes on the second attempt', async () => {
    const session = signIn();
    const failed = expectAdminDelete(session.userId, 503);
    const succeeded = expectAdminDelete(session.userId);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(200);
    expect(failed.isDone(), 'the first attempt must be the 503').to.equal(true);
    expect(succeeded.isDone(), 'the retry must actually be issued').to.equal(true);
  });

  /** Bounded, not endless: the caller is holding a half-finished erasure while this loop runs. */
  it('retries a 5xx to the attempt limit before giving up', async () => {
    const session = signIn();
    // times(3): with one interceptor, attempts 2-3 would fail on nock's
    // no-match guard rather than on the mocked 500, and isDone() is the only
    // thing proving the loop ran at all — a 5xx body stringifies to "{}".
    const scope = expectAdminDelete(session.userId, 500, 3);

    const response = await request(app).delete(`/api/users/${session.userId}`).set(session.header);

    expect(response.status).to.equal(500);
    expect(scope.isDone(), 'every attempt must reach the mocked 500').to.equal(true);
  });
});
