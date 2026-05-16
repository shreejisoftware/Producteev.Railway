import { createApp } from './app';
import { config } from './config';
import { createServer } from 'http';
import { initializeSocket } from './socket';
import { startSlackRealtime } from './integrations/slack.realtime';
import { prisma } from './config/database';
import { redis } from './config/redis';
import fs from 'fs';
import path from 'path';
import { repairCriticalSchema, runMigrations } from './utils/database-init';

async function verifyDatabaseConnection(maxRetries = 5): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 1) {
        console.log(`[DB] Verifying database connection...`);
      }
      await prisma.$queryRaw`SELECT 1 as connected`;
      console.log('[DB] ✓ Database connection verified');
      return true;
    } catch (error) {
      // Don't spam logs on every attempt
      if (attempt === 1) {
        console.warn(`[DB] Connection not ready yet...`);
      }
      
      if (attempt < maxRetries) {
        const waitTime = Math.min(5000, 1000 * attempt);
        if (attempt % 3 === 0 || attempt === maxRetries - 1) {
          console.log(`[DB] Still connecting... (attempt ${attempt}/${maxRetries})`);
        }
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  console.error('[DB] ✗ Could not connect after all attempts');
  return false;
}

async function startServer(port: number): Promise<void> {
  try {
    // Verify database connection with retries, but don't fail startup
    const dbConnected = await verifyDatabaseConnection(5);
    if (!dbConnected) {
      console.warn('[DB] ⚠ Starting without database connection - will retry on requests');
    }

    const app = createApp();
    const httpServer = createServer(app);

    initializeSocket(httpServer);
    // Optional: Slack Socket Mode realtime → emits `slack:message` to clients.
    startSlackRealtime();

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Server] ✗ Port ${port} is already in use. Stop the other running backend instance and restart.`);
        process.exit(1);
      } else {
        console.error('[Server] ✗ Error:', err);
        process.exit(1);
      }
    });

    // Ensure upload directories exist and are writable
    const uploadsBase = path.resolve(process.cwd(), 'uploads');
    ['avatars', 'chat', 'thumbnails', 'sounds'].forEach(dir => {
      const fullPath = path.join(uploadsBase, dir);
      if (!fs.existsSync(fullPath)) {
        console.log(`[Init] Creating missing directory: ${fullPath}`);
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });

    httpServer.listen(port, () => {
      console.log(`[Server] ✓ Running on port ${port} in ${config.NODE_ENV} mode`);
      console.log(`[Health] Endpoint: http://localhost:${port}/health`);
      console.log(`[API] Endpoint: http://localhost:${port}/api/v1`);
    });

    const shutdown = async () => {
      console.log('[Server] Shutting down gracefully...');
      httpServer.close();
      await prisma.$disconnect();
      redis.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('[Server] ✗ Failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function main() {
  console.log('[Init] Starting Producteev backend...');
  console.log(`[Init] Environment: ${config.NODE_ENV}`);
  console.log(`[Init] Database URL configured: ${process.env.DATABASE_URL ? '✓ Yes' : '✗ No'}`);

  if (config.NODE_ENV === 'production') {
    await runMigrations(prisma);
    await repairCriticalSchema(prisma);
  }

  await startServer(config.PORT);
}

main().catch((error) => {
  console.error('[Fatal] Unhandled error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
