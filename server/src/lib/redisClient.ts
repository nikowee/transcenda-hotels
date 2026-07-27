import { createClient, type RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const CACHE_TTL = parseInt(process.env.REDIS_TTL || '300', 10);

/**
 * How long to keep trying before giving up on the *initial* connection, and how
 * to back off on every reconnection after that.
 *
 * These are two different problems and an earlier fix conflated them. Returning
 * false unconditionally stopped `connect()` hanging forever when nothing is
 * listening — but it also disabled node-redis's retry loop for the whole life
 * of the client, so a Redis that restarted (a deploy, an OOM kill, or simply
 * coming up a second after the API in compose) was never reconnected to.
 * isCacheReady() then reported false permanently and every hotel search made a
 * full supplier round trip until someone restarted the process by hand.
 *
 * So: bounded retries while starting up, unbounded-but-backed-off afterwards.
 * `retries` counts from zero on each fresh disconnect, and `hasConnected` is
 * what distinguishes "never came up" from "came up and dropped".
 */
const STARTUP_RETRY_LIMIT = Number(process.env.REDIS_STARTUP_RETRIES ?? 5);
let hasConnected = false;

export const redis = createClient({
    url: redisUrl,
    socket: {
        reconnectStrategy: (retries: number) => {
            if (!hasConnected && retries >= STARTUP_RETRY_LIMIT) {
                // Give up so connect() settles; the app runs without a cache.
                return false;
            }
            // 50ms, 100ms, 200ms … capped at 5s so a long outage does not spin.
            return Math.min(50 * 2 ** retries, 5_000);
        },
    },
});

// Connection events
redis.on('connect', () => {
    // Flips the reconnect strategy from bounded to unbounded: from here on a
    // drop is a recoverable outage rather than a Redis that was never there.
    hasConnected = true;
    console.log('🔗 Redis connected successfully');
});

/**
 * Errors arrive on every failed reconnect attempt, so logging each one turns a
 * Redis outage into an unbounded log flood. Log the first, then stay quiet
 * until the connection comes back.
 */
let errorLogged = false;

redis.on('error', (err) => {
    if (!errorLogged) {
        errorLogged = true;
        console.error('❌ Redis connection error:', err.message);
    }
});

redis.on('ready', () => {
    errorLogged = false;
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
