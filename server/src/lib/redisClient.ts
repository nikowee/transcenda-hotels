import { createClient, type RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// REDIS_URL is deployment-injected env (docker-compose sets redis://redis:6379;
// a cloud deploy points it at its cache) — not an .env knob.
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
/** Search-result cache lifetime, seconds. */
export const CACHE_TTL = 300;

/** Two different reconnection problems, two different answers: bounded retries while starting up (so connect() cannot hang forever against a Redis that is not there), unbounded-but-backed-off retries afterwards (so a Redis that restarted. */
const STARTUP_RETRY_LIMIT = 5;
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

/** Errors arrive on every failed reconnect attempt, so logging each one turns a Redis outage into an unbounded log flood. */
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

/** Connect without blocking the module. */
void redis.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ Redis unavailable, running without cache:', message);
});

/** True only when a command will actually succeed. Callers must check. */
export const isCacheReady = (): boolean => redis.isReady;

// Shutdown lives in index.ts, not here: it must close the HTTP listener and
// drain in-flight requests *before* tearing Redis down, and only the entry
// point holds the server handle. A second signal handler in this module would
// race that drain and exit mid-request.
