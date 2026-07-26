import { createClient, type RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const CACHE_TTL = parseInt(process.env.REDIS_TTL || '300', 10);

/**
 * reconnectStrategy returning false makes a failed connection give up instead of
 * retrying forever. Without it `connect()` never settles when nothing is
 * listening, which is not a rejection the catch below can see.
 */
export const redis = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: false },
});

// Connection events
redis.on('connect', () => {
    console.log('🔗 Redis connected successfully');
});

redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
});

/**
 * Connect without blocking the module.
 *
 * This was a top-level `await redis.connect()`. Inside Docker that is fine
 * because compose starts a redis service, but with nothing listening the client
 * retried indefinitely and the await never settled — so importing this file hung
 * forever. Anything that reaches it transitively (hotelController → index.ts →
 * the whole server suite) hung with it, before a single test could run.
 *
 * Fire-and-forget delivers what the original comment intended: a missing Redis
 * degrades to "no cache" rather than stopping the process.
 */
void redis.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ Redis unavailable, running without cache:', message);
});

/** True only when a command will actually succeed. Callers must check. */
export const isCacheReady = (): boolean => redis.isReady;

// Shutdown
process.on('SIGINT', async () => {
    try { await redis.destroy(); } catch {}
    console.log('🔌 Redis disconnected');
    process.exit(0);
});
