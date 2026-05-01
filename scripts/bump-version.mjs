#!/usr/bin/env node
// Bump the user-facing version across the surfaces that show it. The
// Tauri SemVer is the canonical 'release line' (becomes the macOS
// .app's CFBundleShortVersionString); the rest align to it:
//
//   - tauri.conf.json `version`
//   - APP_VERSION label in version.ts (shown in the corner-badge
//     popover meta line: 'v0.1.2 alpha · <sha> · <date>')
//   - CACHE_VERSION in sw.js (forces a fresh SW + cache eviction
//     on PWA reload, so users get the new bundle)
//
// The 'alpha' suffix is preserved on each bump until you explicitly
// drop it from APP_VERSION manually (signals graduation to GA).
//
// Usage: pnpm version:bump <semver>   (e.g., pnpm version:bump 0.2.0)

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const semver = process.argv[2]
if (!semver || !/^\d+\.\d+\.\d+$/.test(semver)) {
  console.error('usage: bump-version.mjs <semver>   (e.g., 0.2.0)')
  process.exit(1)
}

// Tauri version
const tauriConfPath = resolve(root, 'packages/website/src-tauri/tauri.conf.json')
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'))
const oldTauri = tauriConf.version
tauriConf.version = semver
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n')

// APP_VERSION label — full semver, alpha suffix preserved if present
const versionTsPath = resolve(root, 'packages/website/src/version.ts')
const versionTs = readFileSync(versionTsPath, 'utf-8')
const oldMatch = versionTs.match(/APP_VERSION = '([^']*)'/)
const oldLabel = oldMatch ? oldMatch[1] : ''
const isAlpha = oldLabel.toLowerCase().includes('alpha')
const newLabel = `v${semver}${isAlpha ? ' alpha' : ''}`
writeFileSync(
  versionTsPath,
  versionTs.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${newLabel}'`),
)

// CACHE_VERSION — keep it in lockstep so a release bump always
// invalidates the SW. If you need a between-release SW bump (e.g. a
// CSS hotfix without a new Tauri release), edit sw.js manually and
// append '-N' (e.g., 'v0.1.2-alpha-1', 'v0.1.2-alpha-2').
const swPath = resolve(root, 'packages/website/public/sw.js')
const sw = readFileSync(swPath, 'utf-8')
const oldCacheMatch = sw.match(/CACHE_VERSION = '([^']*)'/)
const oldCache = oldCacheMatch ? oldCacheMatch[1] : ''
const newCache = `v${semver}${isAlpha ? '-alpha' : ''}`
writeFileSync(swPath, sw.replace(/CACHE_VERSION = '[^']*'/, `CACHE_VERSION = '${newCache}'`))

console.log(`tauri.conf.json: ${oldTauri} → ${semver}`)
console.log(`APP_VERSION:     ${oldLabel} → ${newLabel}`)
console.log(`CACHE_VERSION:   ${oldCache} → ${newCache}`)
