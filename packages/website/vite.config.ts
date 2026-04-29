import { defineConfig } from 'vite'

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
  // nicermd-core is a workspace package we rebuild manually; excluding it
  // from dep pre-bundling ensures Vite always reads the current dist rather
  // than serving a stale cached version.
  optimizeDeps: {
    exclude: ['nicermd-core'],
  },
})
