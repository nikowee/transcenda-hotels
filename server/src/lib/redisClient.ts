import { createClient, type RedisClientType } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const CACHE_TTL = parseInt(process.env.REDIS_TTL || '300', 10);

export const redis = createClient({url: redisUrl});

// Connection events
redis.on('connect', () => {
    console.log('🔗 Redis connected successfully');
});

redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
});

// Connect to Redis
await redis.connect();

// Shutdown
process.on('SIGINT', async () => {
    await redis.destroy();
    console.log('🔌 Redis disconnected');
    process.exit(0);
});