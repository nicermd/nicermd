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
// Plus deep-link handling via `@tauri-apps/plugin-deep-link`:
//   onOpenUrl(urls)             — fires for warm-state `nicermd://…`
//                                 arrivals (browser click while app
//                                 already running).
//   getCurrent()                — returns the cold-start URL(s), i.e.
//                                 the deep-link that LAUNCHED the
//                                 app. Doing this from JS, after the
//                                 frontend is ready, avoids the race
//                                 where a Rust-side on_open_url would
//                                 fire before the WebView has any
//                                 listeners. Parsed for `?url=…` and
//                                 routed to loadFromUrl with no
//                                 phishing gate — the OS already
//                                 surfaced an "Open Nicer.md?"
//                                 prompt before launching us.

import type { Harness } from './main'
import { openFile, saveFile, newFile, openFromTauriPath, isDirty } from './doc-source'
import { loadFromUrl, openUrlPrompt } from './url-open'
import { openPalette } from './command-palette'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function setupTauriBridge(harness: Harness): Promise<void> {
  if (!isTauri()) return

  const { listen } = await import('@tauri-apps/api/event')
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')

  // Per-window scoping is critical for multi-window: the Rust shell
  // uses `app.emit_to(focused_window_label, …)` to route menu events
  // to only the focused window so Cmd+S in window A doesn't trigger a
  // save in window B. A default `listen()` call registers with
  // `EventTarget::Any`, which Tauri's filter only matches against the
  // unscoped `emit()` path — meaning `Any` listeners would NEVER hear
  // a label-targeted emit. Passing the current window's label as the
  // target string registers as `EventTarget::AnyLabel(label)`, which
  // DOES match emit_to. Wrapped here so each listener below registers
  // with the same scoping consistently.
  const label = getCurrentWebviewWindow().label
  const listenHere = <T>(event: string, handler: (ev: { payload: T }) => void) =>
    listen<T>(event, handler, { target: label })

  await listenHere<number>('menu:view-mode', (event) => {
    harness.switchTo(event.payload)
  })

  await listenHere('menu:view-cycle', () => {
    harness.cycle()
  })

  await listenHere('menu:command-palette', () => {
    openPalette()
  })

  await listenHere('menu:view-focus-toggle', () => {
    // Focus mode wiring lands in a future iteration. Listener is
    // registered so the menu item doesn't appear dead; intentional no-op.
  })

  await listenHere('menu:file-open', () => {
    void openFile(harness)
  })
  await listenHere('menu:file-open-url', () => {
    openUrlPrompt(harness)
  })
  await listenHere('menu:file-save', () => {
    void saveFile(harness)
  })
  await listenHere('menu:file-save-as', () => {
    void saveFile(harness, { saveAs: true })
  })
  await listenHere('menu:file-new', () => {
    void newFile(harness)
  })
  await listenHere('menu:view-reload', async () => {
    // Cmd+R is right next to Cmd+T / Cmd+W on the keyboard and easy
    // to hit accidentally. Without a guard, a misfire wipes anything
    // not yet flushed by the 1.5s autosave debounce AND drops the
    // file association (recovery banner restores text but anonymises
    // the source — the next Cmd+S becomes Save As, not a write-back).
    if (isDirty()) {
      const { ask } = await import('@tauri-apps/plugin-dialog')
      const ok = await ask('Discard unsaved changes and reload?', {
        title: 'Nicer.md',
        kind: 'warning',
      })
      if (!ok) return
    }
    window.location.reload()
  })
  await listenHere<string>('menu:file-open-path', (event) => {
    void openFromTauriPath(harness, event.payload)
  })

  // Cold-start file-open replay. RunEvent::Opened can fire before
  // this bundle has finished loading and registered the listener
  // above (e.g. user double-clicks a .md in Finder while Nicer.md
  // isn't running — the OS launches us, fires Opened, and the JS
  // realm isn't ready yet). The Rust side caches those paths in
  // `PendingOpened`; drain them here now that we have a listener and
  // a harness. The command also flips the cache's `drained` flag so
  // subsequent Opened events emit live instead of caching. Mirrors
  // the deep-link getCurrent() pattern above.
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const pending = await invoke<string[]>('drain_pending_opened')
    for (const path of pending) {
      void openFromTauriPath(harness, path)
    }
  } catch (err) {
    console.error('[tauri-bridge] failed to drain pending opens:', err)
  }

  // Deep-link arrivals from `nicermd://` clicks (e.g. Chrome extension's
  // "Open in Nicer.md desktop").
  const deepLink = await import('@tauri-apps/plugin-deep-link')

  // Warm state: app already running, browser fires a deep-link.
  await deepLink.onOpenUrl((urls) => {
    for (const url of urls) {
      void handleDeepLink(harness, url)
    }
  })

  // Cold start: the deep-link click is what launched the app. The
  // plugin stashes those URLs during boot; we pull them out now that
  // the frontend (and the harness) is ready to consume them.
  const cold = await deepLink.getCurrent()
  if (cold && cold.length > 0) {
    for (const url of cold) {
      void handleDeepLink(harness, url)
    }
  }
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
