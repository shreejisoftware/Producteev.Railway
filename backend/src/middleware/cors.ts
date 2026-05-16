import cors from 'cors';
import { config } from '../config';

const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

function isLocalNetworkOrigin(origin?: string) {
  if (!origin) return false;
  return [
    'http://localhost:',
    'https://localhost:',
    'http://127.0.0.1:',
    'https://127.0.0.1:',
    'http://10.',
    'http://192.168.',
    'http://172.16.',
    'http://172.17.',
    'http://172.18.',
    'http://172.19.',
    'http://172.20.',
    'http://172.21.',
    'http://172.22.',
    'http://172.23.',
    'http://172.24.',
    'http://172.25.',
    'http://172.26.',
    'http://172.27.',
    'http://172.28.',
    'http://172.29.',
    'http://172.30.',
    'http://172.31.',
  ].some((prefix) => origin.startsWith(prefix));
}

function originMatches(origin: string, allowed: string) {
  if (allowed === '*') return true;
  if (allowed.startsWith('*.')) {
    return origin.endsWith(allowed.slice(1));
  }
  return origin === allowed;
}

export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed = allowedOrigins.some((allowedOrigin) => originMatches(origin, allowedOrigin));
    if (allowed) {
      callback(null, true);
      return;
    }

    if (config.NODE_ENV === 'development' || config.ALLOW_LOCALHOST_CORS) {
      if (isLocalNetworkOrigin(origin)) {
        callback(null, true);
        return;
      }
    }

    callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
