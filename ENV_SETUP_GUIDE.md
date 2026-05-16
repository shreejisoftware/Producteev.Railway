# 📋 Environment Variables Setup Guide

## Which `.env` file should I use?

### `.env.production` (Railway Production)
- **Use when:** Deploying to Railway in production
- **Contains:** Railway PostgreSQL connection, production JWT secrets
- **Location:** Root directory of project
- **Action:** Upload these variables to Railway dashboard manually

### `.env.development` (Local Development)
- **Use when:** Running the app locally on your machine
- **Contains:** Local PostgreSQL connection (localhost)
- **Location:** Root directory of project
- **Action:** Use this for `npm run dev`

### `backend/.env.example` (Template)
- **Use when:** Setting up a new environment
- **Action:** Copy and rename to `.env`, then fill in your values

---

## ⚡ Quick Setup

### For Production (Railway)

1. **Copy values from `.env.production`**
   ```
   DATABASE_URL=postgresql://postgres:JrukktONTgAcLdARbhxExscPxia3cLrS@postgres.railway.internal:5432/railway?schema=public&sslmode=require
   NODE_ENV=production
   PORT=4000
   ```

2. **In Railway Dashboard → Backend Service → Variables:**
   - Paste `DATABASE_URL` (Railway auto-provides this)
   - Set `NODE_ENV=production`
   - Set `PORT=4000`
   - Set `JWT_SECRET` (generate: `openssl rand -base64 64`)
   - Set `JWT_REFRESH_SECRET` (generate: `openssl rand -base64 64`)
   - Set `CORS_ORIGIN` (your frontend domain)

### For Local Development

1. **Copy `.env.development` to `.env`:**
   ```bash
   cp .env.development .env
   ```

2. **Update database connection to match your local setup:**
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/producteev?schema=public
   ```

3. **Generate JWT secrets:**
   ```bash
   # Generate 2 random 64-byte strings (base64 encoded)
   openssl rand -base64 64
   openssl rand -base64 64
   ```

4. **Update `.env` with the secrets:**
   ```
   JWT_SECRET=<paste-first-secret>
   JWT_REFRESH_SECRET=<paste-second-secret>
   ```

---

## 🔐 Security Checklist

- [ ] **NEVER commit `.env` files to Git**
- [ ] **NEVER share `.env.production` with anyone**
- [ ] `.env` files are in `.gitignore` ✓
- [ ] JWT secrets are strong (64+ random characters)
- [ ] DATABASE_URL uses SSL for production (`sslmode=require`)
- [ ] CORS_ORIGIN matches your frontend domain
- [ ] Change default passwords in production

---

## 📦 Environment Variables Needed in Railway

When you push to Railway, these variables are required:

```
DATABASE_URL          # Auto-provided by Railway PostgreSQL plugin
NODE_ENV=production
PORT=4000
JWT_SECRET            # Generate with: openssl rand -base64 64
JWT_REFRESH_SECRET    # Generate with: openssl rand -base64 64
CORS_ORIGIN           # Your frontend domain
```

---

## 🛠 Generate Strong Secrets

```bash
# Generate for JWT_SECRET and JWT_REFRESH_SECRET
openssl rand -base64 64

# Example output:
# gB7hKp9z1mL4x5vN2qR3tU6w8yA9bC0d/e1F2G3H4I5J6K7L8M9N0O1P2Q3R4S5T6U7V8W9X0Y1Z
```

Copy each output and use as the corresponding secret in Railway.

---

## ❌ Common Issues

### Error: "Invalid environment variables"
- **Check:** Are all required variables set?
- **Fix:** Ensure `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` are set

### Error: "Cannot connect to database"
- **Check:** Is `DATABASE_URL` correct?
- **Fix:** For Railway, should be `postgres.railway.internal` (not public URL)

### Error: "CORS error from frontend"
- **Check:** Does `CORS_ORIGIN` match your frontend URL?
- **Fix:** Update `CORS_ORIGIN` to your actual frontend domain

### Error: "Token validation failed"
- **Check:** Did you generate new JWT secrets?
- **Fix:** Generate new secrets if you changed them
- **Note:** Existing tokens will become invalid

---

## 📝 File Locations

```
producteev-project/
├── .env.production          ← Production variables (Railway)
├── .env.development         ← Development variables (Local)
├── .gitignore              ← Excludes .env files
│
└── backend/
    ├── .env.example         ← Template/reference
    └── src/
        └── config/
            ├── index.ts     ← Reads .env variables
            └── database.ts  ← Uses DATABASE_URL
```

---

## ✅ Verification Steps

After setting up environment variables:

1. **Locally:** Run `npm run dev` and check console for:
   ```
   [Config] ✓ Environment variables loaded successfully
   [DB] ✓ Database connection verified
   ```

2. **On Railway:** Check deployment logs for:
   ```
   [1/3] Generating Prisma Client...
   [2/3] Running database migrations...
   [3/3] Starting Node.js server...
   ```

3. **Test API:** 
   ```bash
   curl http://localhost:4000/health
   # Response: {"status":"ok","timestamp":"..."}
   ```
