// Bridges native menu events from the Tauri shell into the harness.
// No-op in plain browser contexts. Loaded lazily so the @tauri-apps/api
// chunk only ships to users running inside Tauri.
//
// Menu events emitted by src-tauri/src/lib.rs:
//   menu:view-mode  (number)   — switch to mode 1..4
//   menu:view-cycle ()         — cycle modes
//   menu:view-focus-toggle ()  — focus mode toggle (TODO)
//   menu:file-new ()           — TODO
//   menu:file-open ()          — TODO
//   menu:file-save ()          — TODO
//   menu:file-save-as ()       — TODO

import type { Harness } from './main'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function setupTauriBridge(harness: Harness): Promise<void> {
  if (!isTauri()) return

  const { listen } = await import('@tauri-apps/api/event')

  await listen<number>('menu:view-mode', (event) => {
    harness.switchTo(event.payload)
  })

  await listen('menu:view-cycle', () => {
    harness.cycle()
  })

  await listen('menu:view-focus-toggle', () => {
    // Focus mode wiring lands in the next iteration. Logging for now so
    // we can confirm the menu event is reaching the web side.
    console.log('[tauri] menu:view-focus-toggle')
  })

  for (const id of ['file-new', 'file-open', 'file-save', 'file-save-as'] as const) {
    await listen(`menu:${id}`, () => {
      console.log(`[tauri] menu:${id}`)
    })
  }
}
