/**
 * Run-wide network guard. Loaded by mocha via -r, before any test file.
 *
 * Blocks every outbound socket for the whole suite and leaves only loopback
 * open, since supertest binds an ephemeral port on 127.0.0.1.
 *
 * This is not belt-and-braces. Once ../env.ts supplies a STRIPE_SECRET_KEY the
 * Stripe client is real, and any call that misses the simulator's guard reaches
 * api.stripe.com for real — `verifySession('totally_made_up')` in
 * booking.test.ts did exactly that, got a 401, mapped it to the same 502 the
 * offline path produced, and passed. A test that silently depends on the
 * internet is worse than one that fails.
 *
 * Suites add interceptors on top of this; helpers/stripeNock.ts restores this
 * state rather than re-enabling the network outright.
 */
import './env.js';
import nock from 'nock';

export const allowLoopbackOnly = (host: string): boolean =>
  host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1');

nock.disableNetConnect();
nock.enableNetConnect(allowLoopbackOnly);
