/** Run-wide network guard. */
import './env.js';
import nock from 'nock';

export const allowLoopbackOnly = (host: string): boolean =>
  host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1');

nock.disableNetConnect();
nock.enableNetConnect(allowLoopbackOnly);
