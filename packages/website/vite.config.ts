import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3333,
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
