import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Attempts to run Prisma migrations
 * Retries up to 10 times with exponential backoff
 * Does NOT throw - returns success/failure status
 */
export async function runMigrations(_prisma: PrismaClient, maxRetries = 10): Promise<boolean> {
  console.log('[DB] Attempting to run pending migrations...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Try to run migrations
      const { stdout } = await execAsync('npx prisma migrate deploy', {
        cwd: process.cwd(),
        env: { ...process.env },
      });

      // Check if migrations actually ran
      if (stdout.includes('Already up to date') || stdout.includes('migrations')) {
        console.log('[Migrations] ✓ Completed successfully');
        return true;
      }

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log less frequently to avoid spam
      if (attempt === 1 || attempt === Math.ceil(maxRetries / 2) || attempt === maxRetries) {
        console.warn(
          `[Migrations] Attempt ${attempt}/${maxRetries} failed`,
          errorMsg.includes('P1001') ? '(Database not ready yet)' : ''
        );
      }

      if (attempt < maxRetries) {
        const waitTime = Math.min(8000, Math.pow(1.5, attempt) * 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.warn('[Migrations] ⚠ Failed after all attempts - app will continue');
        return false;
      }
    }
  }

  return false;
}

/**
 * Verify database is accessible and has required tables
 * Returns true if DB is ready, false if not ready yet
 */
export async function checkDatabaseHealth(prisma: PrismaClient): Promise<boolean> {
  try {
    // Simple connectivity test
    await prisma.$queryRaw`SELECT 1 as connected`;
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Wait for database to be ready
 * Retries up to maxRetries times
 * Does NOT throw - returns success/failure
 */
export async function waitForDatabase(prisma: PrismaClient, maxRetries = 10): Promise<boolean> {
  console.log('[DB] Waiting for database to be ready...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1 as connected`;
      console.log('[DB] ✓ Database is ready');
      return true;
    } catch (error) {
      if (attempt === 1) {
        console.log('[DB] Database not ready yet, waiting...');
      }

      if (attempt === maxRetries) {
        console.warn('[DB] ⚠ Database still not ready, but starting app anyway');
        return false;
      }

      // Exponential backoff
      const waitTime = Math.min(5000, Math.pow(1.3, attempt) * 500);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return false;
}

/**
 * Repairs the critical schema drift that blocks notifications and task comments.
 * Uses idempotent ALTER TABLE statements so it is safe to run on every startup.
 */
export async function repairCriticalSchema(prisma: PrismaClient): Promise<void> {
  const statements = [
    'ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "sender_id" UUID',
    'ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "sender_avatar_url" TEXT',
    'ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "organization_id" UUID',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "attachments" JSONB',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "file_url" TEXT',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "file_type" TEXT',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "file_name" TEXT',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "file_size" INTEGER',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[]',
    'ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "is_private" BOOLEAN DEFAULT false',
  ];

  console.log('[DB] Repairing critical schema drift if needed...');

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  console.log('[DB] ✓ Critical schema repair completed');
}
