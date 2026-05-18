#!/usr/bin/env node
// Package the Chrome extension at packages/chrome-ext/ into a single
// .zip file suitable for:
//
//   - Loading unpacked from a downloaded folder (users unzip, then
//     chrome://extensions -> Load unpacked -> select the folder).
//   - Submitting to the Chrome Web Store (the store wants a .zip).
//
// Filename is intentionally version-less (`nicermd-chrome-ext.zip`)
// so the GitHub Releases /latest/download/ URL stays stable across
// versions. The version itself lives in manifest.json (and in the
// release tag / title); users can confirm what they have via
// chrome://extensions after loading.
//
// Usage: pnpm package:chrome-ext

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const extDir = resolve(repoRoot, 'packages/chrome-ext')
const distDir = resolve(extDir, 'dist')
const zipName = 'nicermd-chrome-ext.zip'
const zipPath = resolve(distDir, zipName)

const manifest = JSON.parse(readFileSync(resolve(extDir, 'manifest.json'), 'utf-8'))
const version = manifest.version

if (!existsSync(extDir)) {
  console.error(`No extension directory at ${extDir}`)
  process.exit(1)
}

mkdirSync(distDir, { recursive: true })

// Remove any prior artefact so the new one replaces it cleanly. `zip`
// in append mode would otherwise grow the archive over re-runs.
if (existsSync(zipPath)) rmSync(zipPath)

// Pack: exclude the dist/ output dir (to avoid recursion) and any
// dotfiles (`.DS_Store`, `.git*`). The `-X` flag strips extra file
// attributes / extra fields so the archive is reproducible across
// macOS / Linux Finder runs.
execSync(
  `cd "${extDir}" && zip -rX "${zipPath}" . -x "dist/*" -x ".*" -x "*/.*"`,
  { stdio: 'inherit' },
)

console.log('')
console.log(`Packaged Chrome extension v${version}`)
console.log(`  → ${zipPath}`)
console.log('')
console.log('To attach to a GitHub release:')
console.log(`  gh release create chrome-ext-v${version} \\`)
console.log(`    --title "Chrome extension ${version}" \\`)
console.log(`    --notes "See packages/chrome-ext/README.md for install + use." \\`)
console.log(`    "${zipPath}"`)
