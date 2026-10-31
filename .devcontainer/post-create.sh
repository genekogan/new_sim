#!/usr/bin/env bash
# Runs once when the dev container is created (devcontainer.json postCreateCommand).
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ffmpeg
sudo rm -rf /var/lib/apt/lists/*

sudo corepack enable
corepack prepare pnpm@10.27.0 --activate

pnpm install --frozen-lockfile

# Playwright Chromium at the version the workspace pins (mars/viewer, @playwright/test ^1.63), with its system deps.
pnpm --filter mars-campus-viewer exec playwright install --with-deps chromium

# Media is not in git; pull it from the CDN by the manifest (tools/assets).
pnpm run --if-present assets:pull

node --version; pnpm --version; ffmpeg -version | head -n1
