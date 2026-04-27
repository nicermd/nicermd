// Bridges native menu events from the Tauri shell into the harness.
// No-op in plain browser contexts. Loaded lazily so the @tauri-apps/api
// chunk only ships to users running inside Tauri.
//
// Menu events emitted by src-tauri/src/lib.rs:
//   menu:view-mode  (number)   — switch to mode 1..4
//   menu:view-cycle ()         — cycle modes
//   menu:view-focus-toggle ()  — focus mode toggle (TODO)
//   menu:view-reload ()        — reload the WebView (Cmd+R)
//   menu:file-new ()           — TODO
//   menu:file-open ()          — opens system file dialog
//   menu:file-save ()          — writes back to current source, falls
//                                through to Save As if anonymous
//   menu:file-save-as ()       — always opens save dialog

import type { Harness } from './main'
import { openFile, saveFile, newFile } from './doc-source'

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

  await listen('menu:file-open', () => {
    void openFile(harness)
  })
  await listen('menu:file-save', () => {
    void saveFile(harness)
  })
  await listen('menu:file-save-as', () => {
    void saveFile(harness, { saveAs: true })
  })
  await listen('menu:file-new', () => {
    void newFile(harness)
  })
  await listen('menu:view-reload', () => {
    window.location.reload()
  })
}
