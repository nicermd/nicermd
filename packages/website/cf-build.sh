#!/usr/bin/env bash
# Cloudflare Workers build script. Invoked by CF as the single build
# command so the dashboard never has to hold a multi-line `&&` chain
# (which dash splits across lines and chokes on).
#
# CF's root directory should be `packages/website`. This script
# climbs to the workspace root for `pnpm install` (so the lockfile
# resolves correctly) and the recursive build, then returns to
# `packages/website` for wrangler to find `wrangler.jsonc` + `dist/`.
set -euo pipefail

corepack enable
cd "$(dirname "$0")/../.."
pnpm install --frozen-lockfile
pnpm -r build
