import Redis from 'ioredis';
import { config } from './index';

class NoopRedis {
  lastErrorTime = 0;
  on() {
    return this;
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  get() {
    return Promise.resolve(null);
  }
  set() {
    return Promise.resolve('OK');
  }
  del() {
    return Promise.resolve(0);
  }
  keys() {
    return Promise.resolve([]);
  }
}

export const redis = config.REDIS_URL
  ? new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: true,
      retryStrategy(times) {
        if (times > 2) return null;
        return Math.min(times * 200, 1000);
      },
    })
  : new NoopRedis() as unknown as Redis;

if (config.REDIS_URL) {
  redis.on('error', (err) => {
    const message = err?.message || String(err);
    if (message.includes('getaddrinfo') || message.includes('Connection')) {
      if (!redis.lastErrorTime || Date.now() - redis.lastErrorTime > 30000) {
        console.warn('Redis connection error:', message);
        redis.lastErrorTime = Date.now();
      }
    } else {
      console.error('Redis error:', message);
    }
  });

  redis.on('connect', () => console.log('[Redis] Connected'));
} else {
  console.warn('Redis disabled because REDIS_URL is not configured.');
}
