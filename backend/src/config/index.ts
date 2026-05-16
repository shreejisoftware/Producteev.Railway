import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATABASE_PUBLIC_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOW_LOCALHOST_CORS: z.coerce.boolean().default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  console.error('❌ Invalid environment variables:');
  Object.entries(errors).forEach(([key, messages]) => {
    console.error(`  - ${key}: ${messages?.join(', ')}`);
  });
  console.error('\n📋 Required variables:');
  console.error('  - DATABASE_URL (PostgreSQL connection string from Railway)');
  console.error('  - DATABASE_PUBLIC_URL (optional fallback for external Railway access)');
  console.error('  - JWT_SECRET (min 32 characters)');
  console.error('  - JWT_REFRESH_SECRET (min 32 characters)');
  process.exit(1);
}

console.log('[Config] ✓ Environment variables loaded successfully');

export const config = parsed.data;
