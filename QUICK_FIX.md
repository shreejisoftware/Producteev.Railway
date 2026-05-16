# Quick Fix Reference

## Error Code: P3005 + markMigrationRolledBack

**Problem:** Database schema exists but Prisma can't track migrations

**Quick Fix (Choose One):**

### Development Database
```bash
npx prisma migrate reset
```
✓ Deletes all data and resets migrations

### Production Database  
```bash
npx prisma db push --skip-generate
npx prisma migrate resolve --applied <all-migration-names>
npx prisma migrate deploy
```
✓ Keeps all data, initializes tracking

### Or Use the Baseline Script
```bash
npm run db:baseline  # if npm script is added
# or
node backend/scripts/baseline-db.mjs
```

## What Was Wrong in the Log

| Issue | Location | Error |
|-------|----------|-------|
| **Primary** | Line 3-14 | Database has tables but no `_prisma_migrations` table |
| **Secondary** | Line 25-33 | Migration recovery attempted without table existing |
| **Result** | Repeating | Infinite retry loop that fails 15+ times |

## Environment Setup

Set in Railway environment variables:
```
DATABASE_URL=postgresql://user:pass@db-host/dbname
DATABASE_PUBLIC_URL=postgresql://user:pass@proxy-host/dbname  # optional, Railway uses automatically
```

## Files Updated

✓ `backend/scripts/run-migrations.mjs` - Better error handling  
✓ `backend/scripts/baseline-db.mjs` - NEW: Baseline script  
✓ `MIGRATION_FIX.md` - Detailed troubleshooting guide  

## Test It Works

```bash
# Should see migrations status now
npx prisma migrate status

# Should start without P3005 error
npm run dev
```
