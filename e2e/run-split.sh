#!/bin/bash
# run-split.sh — Run the full Playwright suite in three batches, each with a fresh server.
#
# Background: DEF-090 observed wrangler dev crashing mid-suite when ~150+ chromium tests
# ran in a single server session. The split ensures each batch starts with a fresh miniflare
# D1 state (start-server.sh wipes the database on start), keeping the server stable.
#
# Usage: bash e2e/run-split.sh
#   Runs chromium batch 1, then chromium batch 2, then mobile. All three batches always run
#   regardless of individual failures, so the complete picture is visible. Exit code is
#   non-zero if any batch failed.
#
# Each batch is a standalone Playwright invocation. Because reuseExistingServer: false is set
# in playwright.config.ts, each invocation runs start-server.sh which kills any existing
# server and starts a fresh one. No manual kill step is needed between batches.

# Do not use set -e: all three batches must always run so we see the full picture.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
FAILURES=0

# Select Node 22 (required for workerd / vitest-pool-workers).
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use

PLAYWRIGHT="npx playwright test --config=e2e/playwright.config.ts"

echo "=========================================="
echo " Batch 1: Chromium — first half of specs"
echo "=========================================="
$PLAYWRIGHT --project=chromium \
  e2e/specs/block-drag-reorder.spec.ts \
  e2e/specs/block-enter-backspace.spec.ts \
  e2e/specs/block-todo.spec.ts \
  e2e/specs/block-typing-autosave.spec.ts \
  e2e/specs/cascade-delete-pages.spec.ts \
  e2e/specs/create-page.spec.ts \
  e2e/specs/database-create.spec.ts \
  e2e/specs/database-mobile.spec.ts \
  e2e/specs/database-persistence.spec.ts \
  e2e/specs/database-table.spec.ts \
  e2e/specs/def-021-retest.spec.ts \
  e2e/specs/defect-014-truncation.spec.ts \
  e2e/specs/defect-017-drag-styling.spec.ts \
  e2e/specs/defect-019-drag-announcements.spec.ts \
  e2e/specs/defect-037-040-regressions.spec.ts \
  e2e/specs/tailwind-migration-regressions.spec.ts || FAILURES=$((FAILURES + 1))

echo ""
echo "=========================================="
echo " Batch 2: Chromium — second half of specs"
echo "=========================================="
$PLAYWRIGHT --project=chromium \
  e2e/specs/defect-020-skip-link.spec.ts \
  e2e/specs/delete-page.spec.ts \
  e2e/specs/persistence.spec.ts \
  e2e/specs/phase-2-defect-regressions.spec.ts \
  e2e/specs/phase-2-restyle-regressions.spec.ts \
  e2e/specs/phase-3-defect-regressions.spec.ts \
  e2e/specs/phase-4-gate-retest.spec.ts \
  e2e/specs/phase-5-defect-retests.spec.ts \
  e2e/specs/phase-5-search-theme.spec.ts \
  e2e/specs/rename-page.spec.ts \
  e2e/specs/retest-def-035-036.spec.ts \
  e2e/specs/seeded-tree.spec.ts \
  e2e/specs/slash-menu.spec.ts \
  e2e/specs/views-board-list.spec.ts || FAILURES=$((FAILURES + 1))

echo ""
echo "==========================================="
echo " Batch 3: Mobile specs (Pixel 5 + views)"
echo "==========================================="
$PLAYWRIGHT --project=mobile-chrome || FAILURES=$((FAILURES + 1))

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All three batches complete. PASS."
else
  echo "All three batches complete. FAILURES in $FAILURES batch(es)."
fi
exit "$FAILURES"
