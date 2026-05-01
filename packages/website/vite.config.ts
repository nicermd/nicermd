import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// Build-time provenance — injected as compile-time constants so the
// 'About' popover can show users which build they're on. Falls back
// to 'dev' if git isn't available (shallow clones, dev server, etc.)
// so the build never breaks; the popover just shows 'dev'.
function tryGit(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}
const BUILD_SHA = tryGit('git rev-parse --short HEAD')
const BUILT_AT = new Date().toISOString()

export default defineConfig({
  server: {
    port: 3333,
    // `?url=https://…` links in showcase.md trip Vite's fs allowlist
    // because the dev middleware mis-parses the query value as a path.
    // Disabling the strict check is dev-only; prod and Tauri don't run
    // this middleware. No file-serving code path takes user input.
    fs: { strict: false },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILT_AT__: JSON.stringify(BUILT_AT),
  },
  // nicermd-core is a workspace package we rebuild manually; excluding it
  // from dep pre-bundling ensures Vite always reads the current dist rather
  // than serving a stale cached version.
  optimizeDeps: {
    exclude: ['nicermd-core'],
  },
})
