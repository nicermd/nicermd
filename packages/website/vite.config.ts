import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3333,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
