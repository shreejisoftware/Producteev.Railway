#!/bin/sh

# Wait for PostgreSQL to be ready
# This script checks if PostgreSQL is accessible before proceeding

HOST="${1:-postgres.railway.internal}"
PORT="${2:-5432}"
MAX_RETRIES="${3:-30}"
RETRY_INTERVAL="${4:-2}"

echo "Waiting for PostgreSQL at $HOST:$PORT..."
echo "Max retries: $MAX_RETRIES, Retry interval: ${RETRY_INTERVAL}s"

ATTEMPT=1

while [ $ATTEMPT -le $MAX_RETRIES ]; do
  echo "[$ATTEMPT/$MAX_RETRIES] Attempting to connect to $HOST:$PORT..."
  
  # Try to connect using nc (netcat) - more reliable than other methods
  if nc -z "$HOST" "$PORT" 2>/dev/null; then
    echo "✓ PostgreSQL is reachable!"
    exit 0
  fi
  
  if [ $ATTEMPT -lt $MAX_RETRIES ]; then
    echo "✗ Connection failed. Waiting ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
done

echo "✗ PostgreSQL is not reachable after $MAX_RETRIES attempts"
echo "⚠ Proceeding anyway - the application will retry connecting on startup"
exit 0
