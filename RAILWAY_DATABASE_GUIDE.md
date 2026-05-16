# Railway Database Connection Guide

## 1. Railway Environment Variables Setup

In your Railway project, you need to add the following environment variables:

### Required Variables:
```
DATABASE_URL=postgresql://user:password@host:port/database?schema=public&sslmode=require
REDIS_URL=redis://default:password@host:port
JWT_SECRET=your-long-secret-key-here-min-32-chars
JWT_REFRESH_SECRET=your-long-refresh-secret-key-min-32-chars
NODE_ENV=production
PORT=4000
```

## 2. How Railway PostgreSQL Connection Works

Railway automatically provides `DATABASE_URL` when you:
1. Add a PostgreSQL plugin to your Railway project
2. Link it to your backend service

The URL format is:
```
postgresql://user:password@host:port/database?schema=public&sslmode=require
```

### Key Components:
- **sslmode=require** - Required for Railway production (SSL encryption)
- **schema=public** - Default schema where tables are created
- **host** - Railway internal hostname (unique per deploy)

## 3. Prisma Configuration for Railway

Your `prisma/schema.prisma` should have:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

**Note:** `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` ensures Prisma works in Alpine Linux containers.

## 4. Docker Configuration for Railway

Your Dockerfile should:
1. Generate Prisma client during build
2. Run migrations on startup (already fixed)
3. Copy necessary files

Key points:
- Install `openssl` in production image
- Copy `prisma` folder for migrations
- Use entrypoint script for proper startup sequence

## 5. Connection Troubleshooting

### Error: "relation does not exist"
- **Cause**: Migrations haven't run
- **Fix**: Ensure entrypoint script runs `prisma migrate deploy`

### Error: "Connection timeout"
- **Cause**: Railway PostgreSQL container not ready
- **Fix**: Add retry logic (Prisma handles this automatically)

### Error: "SSL connection error"
- **Cause**: SSL mode mismatch
- **Fix**: Use `?sslmode=require` in DATABASE_URL

### Error: "Authentication failed"
- **Cause**: Wrong credentials in DATABASE_URL
- **Fix**: Copy DATABASE_URL directly from Railway plugin

## 6. Verification Steps

After Railway deployment, verify:

1. Check database connection:
```bash
psql $DATABASE_URL -c "SELECT version();"
```

2. Verify tables exist:
```bash
psql $DATABASE_URL -c "\dt"
```

3. Check backend logs for:
```
[1/3] Generating Prisma Client...
[2/3] Running database migrations...
[3/3] Starting Node.js server...
```

## 7. Common Railway Setup Issues

### Issue: Environment variables not recognized
- **Fix**: Restart/redeploy after adding variables

### Issue: Migrations fail with "Permission denied"
- **Fix**: Ensure database user has full permissions

### Issue: Connection pool exhausted
- **Fix**: Add connection limit to DATABASE_URL:
```
postgresql://user:pass@host/db?schema=public&sslmode=require&connection_limit=10
```

## 8. Prisma Best Practices for Production

1. Always use `prisma migrate deploy` (not `prisma db push`)
2. Create named migrations for production changes
3. Use connection pooling in production
4. Monitor query performance in production logs

## 9. Health Check Endpoint

Your backend has a `/health` endpoint for Railway monitoring:
```
GET /health → { "status": "ok", "timestamp": "..." }
```

Configure this in Railway deployment settings for health checks.
