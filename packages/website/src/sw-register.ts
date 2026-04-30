// Registers the service worker on the public web build only. We skip:
//
//   - Tauri (the desktop shell already has the app local; SW would be
//     redundant and the file:// scheme behaviour varies).
//   - Dev mode (Vite HMR + a SW intercepting fetches is a debugging
//     trap; the SW would cache stale modules across reloads).
//   - Browsers without serviceWorker support (older Safari, etc.).
//
// Registration is fire-and-forget. If a new SW is waiting on next
// load it'll take over via skipWaiting/clients.claim in sw.js.

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return
  if (isTauri()) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] registration failed:', err)
    })
  })
}
