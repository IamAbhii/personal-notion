#!/usr/bin/env bash
# Devcontainer setup: everything the Claude Code agents need to build and test Personal Space.
set -euo pipefail

echo "Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

echo "Installing Playwright and its browsers (with OS dependencies)..."
# Playwright drives the real app in a real browser for the end-to-end suite and the adversary.
npm install -g playwright
npx --yes playwright install --with-deps chromium

echo "Verifying the installs..."
claude --version
npx --yes playwright --version

echo "Setup complete."
