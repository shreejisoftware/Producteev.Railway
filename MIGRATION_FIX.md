# Prisma Migration Error P3005 - Fix Guide

## Problem Summary

The application is failing to start with this error:

```
Error: P3005
The database schema is not empty. Read more about how to baseline an existing production database
Error: Invariant violation: called markMigrationRolledBack on a database without migrations table.
```

### Root Cause

Your Railway database has existing tables from a previous setup, but **no `_prisma_migrations` tracking table**. Prisma cannot:
- Determine which migrations have already been applied
- Roll back failed migrations (since it can't track them)

This happens when:
1. The database was manually created or imported from another source
2. The database exists but is being managed by Prisma for the first time
3. The migrations table was accidentally deleted

## Solution

### Option 1: Baseline the Existing Database (Recommended for Production)

If your existing database schema is correct and you want to keep it:

```bash
cd backend
npm run db:baseline
```

Or manually run:
```bash
npx prisma db push --skip-generate
npx prisma migrate resolve --applied 20260315_init
npx prisma migrate resolve --applied 20260316_add_spaces_and_hierarchy
# ... repeat for all existing migrations
```

**What this does:**
- Creates the Prisma migrations tracking table
- Marks all existing migrations as "already applied"
- Allows future migrations to work normally

### Option 2: Reset Database (Development Only)

**⚠️ WARNING: This will DELETE all data!** Only use for development/testing:

#### For Railway PostgreSQL:
1. Go to [Railway Dashboard](https://railway.app)
2. Select your database service
3. If you see **Settings → Danger Zone → Reset Database**, use it
4. If the reset button is missing, Railway is likely hiding destructive actions for this service type or plan
5. In that case, the practical reset is to delete and recreate the database service, then point `DATABASE_URL` and `DATABASE_PUBLIC_URL` at the new database
6. Run the backend again: `npm run dev` (it will apply migrations fresh)

#### If you only need the repo-side helper
```bash
cd backend
npm run db:baseline
```

This helper is for baselining an existing database, not for wiping it. If you want a true reset and the UI button is unavailable, recreate the database service.

#### Or via CLI:
```bash
# Reset using prisma
npx prisma migrate reset

# Or reset using Railway CLI
railway db:reset
```

### Option 3: Fix Incrementally (Advanced)

If you want to understand and fix migration by migration:

1. **Check current migration status:**
   ```bash
   npx prisma migrate status
   ```

2. **Mark specific migrations as applied:**
   ```bash
   npx prisma migrate resolve --applied <migration-name>
   ```

3. **Then try deploy:**
   ```bash
   npx prisma migrate deploy
   ```

## Prevention

### For Future Deployments

1. **Always run migrations on startup:** This is already in `package.json`:
   ```json
   "prestart": "npm run db:migrate:prod"
   ```

2. **Use environment-specific database URLs:**
   - Keep `DATABASE_INTERNAL_URL` for Railway internal (fast)
   - Keep `DATABASE_PUBLIC_URL` for external access
   - The script automatically selects the best one

3. **Never manually modify the `_prisma_migrations` table** - let Prisma manage it

## Debugging

### Check what's happening:

```bash
# See all migrations and their status
npx prisma migrate status

# See what migrations Prisma has found
ls prisma/migrations/

# See current database schema
npx prisma db pull

# See what Prisma thinks should exist
npx prisma generate
```

### Environment Variable Verification

Make sure these are set in Railway:
```
DATABASE_URL=postgresql://user:pass@host:port/db
DATABASE_PUBLIC_URL=postgresql://user:pass@proxy:port/db (if applicable)
```

The migration script automatically uses `DATABASE_PUBLIC_URL` if it's available and the internal database URL indicates Railway internal database.

## Timeline of What Happened

Looking at the log file, here's what occurred:

1. **06:37:32** - Container started, Prisma loaded schema
2. **06:37:32** - Migration process started, found 14 migrations
3. **06:37:32** - P3005 error: Database not empty, migrations table doesn't exist
4. **06:37:33** - Script tried to mark migrations as rolled back, but failed (no migrations table yet)
5. **06:37:36** - Command failed, container crashed
6. **06:37:39-38:12** - Multiple retry attempts, all failed with same errors

The infinite retry loop was the migration script attempting to recover but failing because the migrations table didn't exist.

## Updated Files

### 1. `backend/scripts/run-migrations.mjs` (Updated)
- Better error detection
- Distinguishes between P3005 (schema mismatch) and migration table errors
- Provides helpful error messages instead of silently failing
- Only exits 0 on success

### 2. `backend/scripts/baseline-db.mjs` (New)
- Interactive baseline script with safety prompts
- Automatically detects if database needs baseline
- Walks through the initialization process
- Shows success confirmation

## Next Steps

1. **Identify your situation:**
   - Do you want to keep the existing data? → Use baseline (Option 1)
   - Is this a development database? → Use reset (Option 2)
   - Is this a stuck migration? → Use incremental (Option 3)

2. **Run the appropriate fix**

3. **Verify:** `npm run dev` should start successfully

4. **Monitor:** Check logs for any lingering migration issues

## References

- [Prisma Migrate Documentation](https://www.prisma.io/docs/orm/prisma-migrate/workflows/resolving-migration-issues)
- [P3005 Error Explanation](https://www.prisma.io/docs/reference/api-reference/error-reference#p3005)
- [Baselining an existing database](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining)
