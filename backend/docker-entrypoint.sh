#!/bin/sh

echo "=========================================="
echo "Starting Backend Application"
echo "=========================================="

# Generate Prisma Client
echo "[1/3] Generating Prisma Client..."
if ! npx prisma generate; then
  echo "✗ Failed to generate Prisma client"
  exit 1
fi
echo "✓ Prisma client generated"

# Run migrations with retry logic
echo "[2/2] Running database migrations (will retry if DB not ready)..."
echo ""

MAX_RETRIES=60
RETRY_INTERVAL=2
RETRY_INTERVAL=1
ATTEMPT=1

while [ $ATTEMPT -le $MAX_RETRIES ]; do
  echo "[Migration] Attempt $ATTEMPT/$MAX_RETRIES..."
  
  if npx prisma migrate deploy 2>&1; then
    echo ""
    echo "✓ Migrations completed successfully"
    echo ""
    break
  else
      MIGRATION_EXIT=$?
    if [ $ATTEMPT -eq $MAX_RETRIES ]; then
      echo ""
      echo "⚠ Migrations failed after $MAX_RETRIES attempts"
      echo "⚠ Starting app anyway - it will retry on first database request"
      echo ""
      break
    fi
    
    # Show wait message
    if [ $((ATTEMPT % 10)) -eq 0 ]; then
      echo "  Still waiting for database... ($ATTEMPT/$MAX_RETRIES)"
    fi
    
    sleep $RETRY_INTERVAL
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

# Start the application
echo "[3/3] Starting Node.js server..."
echo ""
exec node dist/index.js
