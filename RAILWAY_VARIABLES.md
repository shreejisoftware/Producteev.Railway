# 🚂 Railway Database Variables - Complete Reference

## Your Railway PostgreSQL Environment Variables

### ✅ Use These in Your Backend Service

#### 1. **DATABASE_URL** (Primary - Use This!)
```
postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@postgres.railway.internal:5432/railway
```
**Used for:**
- Prisma migrations in production
- Application database connections inside Railway network
- **Best for internal Railway service-to-service communication**

#### 2. **DATABASE_PUBLIC_URL** (External connections only)
```
postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@turunta-ble.proxy.rlwy.net:13830/railway
```
**Used for:**
- External connections from your local machine (debugging)
- Public connections outside Railway network
- **NOT for production backend - use DATABASE_URL instead**

---

## Individual Connection Components

These are the raw connection parameters if you need to construct a connection string:

| Variable | Value | Purpose |
|----------|-------|---------|
| **PGHOST** | `postgres.railway.internal` | Database hostname (internal) |
| **PGPORT** | `5432` | PostgreSQL port |
| **PGUSER** | `postgres` | Database user |
| **PGPASSWORD** | `JrukktONTgAcLdARbhxExscPxia3cLrS` | Database password |
| **PGDATABASE** | `railway` | Database name |
| **POSTGRES_DB** | `railway` | Same as PGDATABASE |
| **POSTGRES_USER** | `postgres` | Same as PGUSER |
| **POSTGRES_PASSWORD** | `JrukktONTgAcLdARbhxExscPxia3cLrS` | Same as PGPASSWORD |

---

## Other Railway Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| **PGDATA** | `/var/lib/postgresql/data/pgdata` | PostgreSQL data directory (internal) |
| **RAILWAY_DEPLOYMENT_DRAINING_SECONDS** | `60` | Graceful shutdown timeout |
| **SSL_CERT_DAYS** | `820` | SSL certificate validity days |

---

## 🔧 How to Set Up in Your Backend Service

### Step 1: Add to Railway Backend Service Environment Variables

In your Railway dashboard:
1. Go to **Backend Service** → **Variables**
2. Add these environment variables:

```
DATABASE_URL=postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@postgres.railway.internal:5432/railway?schema=public&sslmode=require

REDIS_URL=redis://default:password@host:port  # If using Redis

JWT_SECRET=your-super-secret-key-at-least-32-characters-long

JWT_REFRESH_SECRET=your-super-secret-refresh-key-at-least-32-characters

NODE_ENV=production

PORT=4000

CORS_ORIGIN=https://your-frontend-domain.com
```

### Step 2: Link PostgreSQL Plugin to Backend Service

1. In Railway dashboard, go to **Plugins**
2. Add **PostgreSQL** plugin (if not already added)
3. In **Backend Service**, click the PostgreSQL plugin
4. This automatically provides `DATABASE_URL`

### Step 3: Verify Connection

After deploying, check backend logs for:

```
[DB] ✓ Database connection verified
[Prisma] Running migrations...
[Server] ✓ Running on port 4000
```

---

## 🚨 Common Issues & Fixes

### Issue: "Cannot find module 'prisma'"
**Fix:** Ensure `package.json` has:
```json
"dependencies": {
  "@prisma/client": "5.14.0"
}
```

### Issue: "relation does not exist"
**Fix:** Migrations didn't run. Your entrypoint should run:
```bash
npx prisma migrate deploy
```

### Issue: "Connection refused"
**Fix:** Check if PostgreSQL plugin is:
- ✓ Added to project
- ✓ Running (green status)
- ✓ Linked to backend service

### Issue: "SSL error"
**Fix:** Add to DATABASE_URL:
```
?schema=public&sslmode=require
```

---

## 📝 Connection String Format

The standard PostgreSQL URL format is:

```
postgresql://[user]:[password]@[host]:[port]/[database]?schema=public&sslmode=require
```

Breaking down your URL:
```
postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@postgres.railway.internal:5432/railway?schema=public&sslmode=require
                    ↑                                    ↑                              ↑         ↑              ↑
                  user                            password                          host       port          db name
```

---

## ✅ Checklist Before Going Live

- [ ] DATABASE_URL set in backend environment variables
- [ ] Prisma schema has `url = env("DATABASE_URL")`
- [ ] Dockerfile runs `npx prisma generate` during build
- [ ] Entrypoint script runs `npx prisma migrate deploy`
- [ ] Health check endpoint working: `/health`
- [ ] Backend logs show "Database connection verified"
- [ ] Frontend can connect to backend API
- [ ] Database tables created (check with `\dt` in psql)

---

## 🔍 Debugging Commands

### Test connection from local machine:

Using DATABASE_PUBLIC_URL:
```bash
psql "postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@turunta-ble.proxy.rlwy.net:13830/railway"
```

List all tables:
```sql
\dt
```

Check migrations status:
```sql
SELECT * FROM "_prisma_migrations" ORDER BY "started_at" DESC;
```

---

## 📚 Reference Links

- [Railway PostgreSQL Plugin Docs](https://railway.app/docs/databases/postgresql)
- [Prisma Railway Guide](https://www.prisma.io/docs/orm/deploy/deployment-guides/railway)
- [PostgreSQL Connection Strings](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING)
