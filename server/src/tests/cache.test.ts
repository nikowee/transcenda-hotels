import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { withCache, type CacheStore } from '../lib/cache.ts';

/**
 * The helper is exercised through an injected store rather than a live Redis.
 * The paths that matter most here are the failure paths — cache down, read
 * throws, write throws — and none of them are reachable on demand against a
 * real server.
 */

interface FakeStore extends CacheStore {
  entries: Map<string, { value: string; ttl: number }>;
  getCalls: string[];
  setCalls: Array<{ key: string; value: string; ttl: number }>;
}

const makeStore = (options?: {
  ready?: boolean;
  getError?: Error;
  setError?: Error;
}): FakeStore => {
  const entries = new Map<string, { value: string; ttl: number }>();
  const getCalls: string[] = [];
  const setCalls: Array<{ key: string; value: string; ttl: number }> = [];

  return {
    entries,
    getCalls,
    setCalls,
    isReady: () => options?.ready ?? true,
    get: async (key) => {
      getCalls.push(key);
      if (options?.getError) throw options.getError;
      return entries.get(key)?.value ?? null;
    },
    set: async (key, value, ttl) => {
      setCalls.push({ key, value, ttl });
      if (options?.setError) throw options.setError;
      entries.set(key, { value, ttl });
    },
  };
};

/** The write is fire-and-forget, so assertions on it need a microtask turn. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('withCache', () => {
  let fetcherCalls: number;
  const payload = { rooms: [{ key: 'r1', price: 250 }], completed: true };
  const fetcher = async () => {
    fetcherCalls += 1;
    return payload;
  };

  beforeEach(() => {
    fetcherCalls = 0;
  });

  it('calls the fetcher and caches the result on a miss', async () => {
    const store = makeStore();

    const result = await withCache('rooms:abc', 300, fetcher, store);
    await flush();

    expect(result).to.deep.equal(payload);
    expect(fetcherCalls).to.equal(1);
    expect(store.setCalls).to.have.lengthOf(1);
    expect(store.setCalls[0]).to.deep.include({
      key: 'rooms:abc',
      value: JSON.stringify(payload),
      ttl: 300,
    });
  });

  it('returns the cached value without calling the fetcher on a hit', async () => {
    const store = makeStore();
    store.entries.set('rooms:abc', { value: JSON.stringify(payload), ttl: 300 });

    const result = await withCache('rooms:abc', 300, fetcher, store);

    expect(result).to.deep.equal(payload);
    expect(fetcherCalls).to.equal(0);
    expect(store.setCalls).to.have.lengthOf(0);
  });

  it('keys entries independently', async () => {
    const store = makeStore();

    await withCache('rooms:abc', 300, fetcher, store);
    await flush();
    await withCache('rooms:xyz', 300, fetcher, store);
    await flush();

    expect(fetcherCalls).to.equal(2);
    expect(store.entries.size).to.equal(2);
  });

  it('bypasses the cache entirely when the store is not ready', async () => {
    const store = makeStore({ ready: false });

    const result = await withCache('rooms:abc', 300, fetcher, store);
    await flush();

    expect(result).to.deep.equal(payload);
    expect(fetcherCalls).to.equal(1);
    // Neither side of the cache is touched when it cannot serve.
    expect(store.getCalls).to.have.lengthOf(0);
    expect(store.setCalls).to.have.lengthOf(0);
  });

  it('treats a failed read as a miss rather than an error', async () => {
    const store = makeStore({ getError: new Error('connection reset') });

    const result = await withCache('rooms:abc', 300, fetcher, store);

    expect(result).to.deep.equal(payload);
    expect(fetcherCalls).to.equal(1);
  });

  it('treats a corrupt entry as a miss rather than an error', async () => {
    const store = makeStore();
    store.entries.set('rooms:abc', { value: '{not valid json', ttl: 300 });

    const result = await withCache('rooms:abc', 300, fetcher, store);

    expect(result).to.deep.equal(payload);
    expect(fetcherCalls).to.equal(1);
  });

  it('still answers when the write fails', async () => {
    const store = makeStore({ setError: new Error('OOM command not allowed') });

    const result = await withCache('rooms:abc', 300, fetcher, store);
    await flush();

    expect(result).to.deep.equal(payload);
  });

  it('propagates a fetcher error instead of masking it', async () => {
    const store = makeStore();
    const boom = new Error('Polling timed out');

    try {
      await withCache('rooms:abc', 300, async () => { throw boom; }, store);
      expect.fail('expected withCache to reject');
    } catch (err) {
      expect(err).to.equal(boom);
    }
    // A failed upstream call must never be written to the cache.
    expect(store.setCalls).to.have.lengthOf(0);
  });

  it('does not make the caller wait on the cache write', async () => {
    let released: (() => void) | undefined;
    const store = makeStore();
    const slowStore: CacheStore = {
      ...store,
      set: () => new Promise<void>((resolve) => { released = resolve; }),
    };

    // Resolves despite the write still being in flight.
    const result = await withCache('rooms:abc', 300, fetcher, slowStore);

    expect(result).to.deep.equal(payload);
    expect(released, 'write should still be pending').to.be.a('function');
    released?.();
  });

  it('preserves a legitimately empty payload', async () => {
    const store = makeStore();
    const soldOut = { completed: true, currency: 'SGD', rooms: [] };
    store.entries.set('rooms:sold-out', { value: JSON.stringify(soldOut), ttl: 300 });

    const result = await withCache('rooms:sold-out', 300, fetcher, store);

    expect(result).to.deep.equal(soldOut);
    expect(fetcherCalls).to.equal(0);
  });
});
