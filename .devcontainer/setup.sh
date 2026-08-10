#!/usr/bin/env bash
# Devcontainer setup: everything the Claude Code agents need to build and test Personal Space.
set -euo pipefail

echo "Installing Claude Code..."
npm install -g @anthropic-ai/claude-code

# The Claude Code typescript-lsp plugin spawns the language server by name from PATH, so it has to
# be a global install: a root devDependency in node_modules/.bin is invisible to it. TypeScript
# comes along because the server needs a compiler to answer with.
echo "Installing the TypeScript language server (global, on PATH, for the Claude Code LSP plugin)..."
npm install -g typescript-language-server typescript

# Playwright needs two separate things: OS-level shared libraries (graphics, fonts, codecs) and a
# browser binary. The libraries are apt packages and version-independent, so they are installed
# once here, at create time, while root is available. The browser binary is deliberately NOT
# installed globally: it must come from the project's own Playwright version, or a global install
# and the project's @playwright/test devDependency drift apart and fail to launch the browser.
echo "Installing Playwright OS dependencies (no browser binary yet)..."
npx --yes playwright install-deps chromium

# Once the project exists, install its dependencies and let its own Playwright fetch the matching
# browser. On a fresh clone with no package.json this is skipped, and the first agent to run
# `npm install` is followed by `npx playwright install chromium` to get the browser.
if [ -f package.json ]; then
  echo "package.json found: installing project dependencies..."
  npm install
  echo "Installing the browser using the project's own Playwright version..."
  npx playwright install chromium
else
  echo "No package.json yet (pre-implementation)."
  echo "After the project is scaffolded, run: npm install && npx playwright install chromium"
fi

echo "Verifying the installs..."
claude --version
gh --version

# Warn rather than fail: the container is still usable for building and testing without these.
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Note: ANTHROPIC_API_KEY is not set. Run 'claude' and sign in interactively, or add the key"
  echo "      to .env and rebuild the container."
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "Note: CLOUDFLARE_API_TOKEN is not set. Local development with 'wrangler dev' works without"
  echo "      it; 'wrangler deploy' needs it, because the browser login flow cannot run in here."
fi

echo "Setup complete."
