import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function resolveDatabaseUrl(): string | undefined {
  const internalUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;

  if (internalUrl && internalUrl.includes('postgres.railway.internal') && publicUrl) {
    return publicUrl;
  }

  return internalUrl ?? publicUrl;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'warn', 'error'] 
      : ['warn', 'error'],
    datasources: {
      db: {
        url: resolveDatabaseUrl(),
      },
    },
  });

// Use process event to handle graceful shutdowns (Prisma library engine doesn't support $on('beforeExit'))
process.on('beforeExit', () => {
  // Attempt to disconnect Prisma client, but don't block shutdown
  prisma
    .$disconnect()
    .then(() => console.log('[Prisma] Database client disconnected on beforeExit'))
    .catch((err) => console.warn('[Prisma] Error disconnecting client on beforeExit', err));
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

