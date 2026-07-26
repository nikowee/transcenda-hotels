import { redis, CACHE_TTL, isCacheReady } from './redisClient.ts';

/**
 * Read-through caching for upstream reads.
 *
 * The cache is an optimisation, never a dependency. Every failure mode here —
 * Redis down, a get that errors mid-flight, a write that is rejected — has to
 * degrade to "call the upstream and answer normally", because a booking flow
 * that 500s when the cache blinks is worse than one that is merely slow.
 *
 * hotelController held this logic inline for hotel search only. Extracted so
 * the other upstream reads can adopt it in one line instead of repeating the
 * isCacheReady/get/parse/set dance four times.
 */

/**
 * Indirection so the hit, miss and failure paths are testable without a live
 * Redis. The default store is the real client; tests pass a fake.
 */
export interface CacheStore {
    isReady(): boolean;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const redisStore: CacheStore = {
    isReady: isCacheReady,
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
        await redis.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } });
    },
};

/**
 * Returns the cached value for `key`, or calls `fetcher` and caches its result.
 *
 * The write is deliberately not awaited: the caller already has the value it
 * needs, and making the response wait on a cache round-trip only adds latency
 * to a request that already paid full price for the upstream call.
 */
export async function withCache<T>(
    key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
    store: CacheStore = redisStore,
): Promise<T> {
    if (store.isReady()) {
        try {
            const hit = await store.get(key);
            if (hit !== null) {
                console.log(`✅ Cache HIT for: ${key}`);
                return JSON.parse(hit) as T;
            }
        } catch (err) {
            // A malformed entry or a dropped connection is a miss, not a failure.
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`⚠️ Cache read failed for ${key}, treating as miss:`, message);
        }
    }

    console.log(`❌ Cache MISS for: ${key}`);
    const fresh = await fetcher();

    if (store.isReady()) {
        void store
            .set(key, JSON.stringify(fresh), ttlSeconds)
            .then(() => console.log(`💾 Cached ${key} (TTL: ${ttlSeconds}s)`))
            .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`⚠️ Cache write failed for ${key}:`, message);
            });
    }

    return fresh;
}

export { CACHE_TTL };
