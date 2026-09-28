#!/bin/bash
set -e

# Kill any stale wrangler/workerd processes before starting a new server.
# This must happen first, in the webServer command itself, to ensure we clear stale servers
# before launching a fresh one. This prevents false-pass scenarios where tests would run
# against a stale build.
npm run kill-servers

# Ensure Node.js 22 is selected. Playwright runs this script in a fresh shell without nvm.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use

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
