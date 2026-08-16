/** Run-wide network guard. */
import './env.js';

export const allowLoopbackOnly = (host: string): boolean =>
  host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('::1');

// The external real-network tests (`npm run test:external`, and
// `test:all` which includes them) must be able to reach the live Ascenda API.
// Every other run keeps the guard so unit tests can never accidentally touch a real external service.
const isExternalRun =
  process.env.npm_lifecycle_event === 'test:external' ||
  process.env.npm_lifecycle_event === 'test:all' ||
  // Skips the value after --exclude: that argument names the external tests in
  // order to exclude them, so matching it disarms the guard for a normal run.
  process.argv.some(
    (arg, i) => arg.includes('src/tests/external') && process.argv[i - 1] !== '--exclude'
  );

// nock is imported lazily and only when actually needed
if (!isExternalRun) {
  const { default: nock } = await import('nock');
  nock.disableNetConnect();
  nock.enableNetConnect(allowLoopbackOnly);
}
