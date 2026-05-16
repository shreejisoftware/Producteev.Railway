# --------- Build Stage ---------
FROM node:20-alpine AS builder

WORKDIR /app

# Set environment for build
ENV NODE_ENV=production

# Copy backend directory
COPY backend .

# Clean slate
RUN rm -rf node_modules package-lock.json

# Install dependencies (including dev for build tools)
RUN npm ci

# Generate prisma client & build backend
RUN npx prisma generate
RUN npm run build

# --------- Production Stage ---------
FROM node:20-alpine AS production

WORKDIR /app

# Install openssl for Prisma and netcat for connection checks
RUN apk add --no-cache openssl netcat-openbsd

# Copy from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/wait-for-db.sh ./wait-for-db.sh

# Install only production dependencies
RUN npm ci --omit=dev

# Create uploads directory
RUN mkdir -p uploads

# Make scripts executable
RUN chmod +x ./docker-entrypoint.sh ./wait-for-db.sh

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
