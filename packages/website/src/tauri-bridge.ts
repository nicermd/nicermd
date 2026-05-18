// Bridges native menu events from the Tauri shell into the harness.
// No-op in plain browser contexts. Loaded lazily so the @tauri-apps/api
// chunk only ships to users running inside Tauri.
//
// Menu events emitted by src-tauri/src/lib.rs:
//   menu:view-mode       (number) — switch to mode 1..4
//   menu:view-cycle      ()       — cycle modes
//   menu:view-focus-toggle ()     — focus mode toggle (not yet wired)
//   menu:view-reload     ()       — reload the WebView (Cmd+R)
//   menu:file-new        ()       — new untitled document
//   menu:file-open       ()       — opens system file dialog
//   menu:file-save       ()       — writes back to current source, falls
//                                   through to Save As if anonymous
//   menu:file-save-as    ()       — always opens save dialog
//   menu:file-open-path  (string) — OS-level file-open (Open With,
//                                   double-click, Dock drop) carrying
//                                   the chosen file path.
//
// Plus the app-level deep-link event from tauri-plugin-deep-link:
//   app:deep-link        (string) — incoming `nicermd://…` URL from
//                                   the OS (browser-initiated, share
//                                   sheet, etc.). Parsed for `?url=…`
//                                   and routed to loadFromUrl with no
//                                   phishing gate — the OS already
//                                   surfaced an "Open Nicer.md?"
//                                   prompt before launching us.

import type { Harness } from './main'
import { openFile, saveFile, newFile, openFromTauriPath } from './doc-source'
import { loadFromUrl } from './url-open'

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
    // Focus mode wiring lands in a future iteration. Listener is
    // registered so the menu item doesn't appear dead; intentional no-op.
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
  await listen<string>('menu:file-open-path', (event) => {
    void openFromTauriPath(harness, event.payload)
  })

  // Deep-link arrivals from `nicermd://` clicks (e.g. Chrome extension's
  // "Open in Nicer.md desktop"). Payload is the full `nicermd://?url=…`
  // URL; we parse the `?url=` param and route to loadFromUrl.
  await listen<string>('app:deep-link', (event) => {
    void handleDeepLink(harness, event.payload)
  })
}

async function handleDeepLink(harness: Harness, deepLinkUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(deepLinkUrl)
  } catch {
    return
  }
  if (parsed.protocol !== 'nicermd:') return
  const target = parsed.searchParams.get('url')
  if (!target) return
  try {
    await loadFromUrl(harness, target)
  } catch (err) {
    // Failed loads (404, not-a-GitHub-URL, etc.) — the deep-link came
    // from outside the page, so the existing in-page error UX doesn't
    // see it. Log for now; a banner here would mirror the link-chain
    // failure path but isn't urgent until deep-link gets real usage.
    console.error('[deep-link] failed to load:', target, err)
  }
}
