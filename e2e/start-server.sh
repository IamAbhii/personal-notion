#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"

# Clean the local D1 database to ensure a fresh seeded state for each test run
rm -rf .wrangler/state/v3/d1

# Start the app
exec npm start
