#!/bin/bash
set -e

# Free port 8787 in case a stray process is holding it
lsof -ti:8787 | xargs kill -9 2>/dev/null || true

# Get the project root (one level up from e2e directory)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$PROJECT_ROOT/packages/worker/.wrangler/state/v3/d1"

# Clear the local D1 database state to ensure migrations start from a clean slate
if [ -d "$DB_PATH" ]; then
  rm -rf "$DB_PATH"
  echo "Cleared database at $DB_PATH"
else
  echo "Database path $DB_PATH does not exist yet (first run)"
fi

# Build frontend once
npm run build:frontend

# Run migrations on the local D1 database once
npm run migrate:local

# Start the long-lived server process
# Use exec so the wrangler dev process replaces this shell script - when Playwright kills this
# process, it kills wrangler directly, not npm, preventing orphaned processes
exec npm run start:worker
