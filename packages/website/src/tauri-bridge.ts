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
import {
  openFile,
  saveFile,
  newFile,
  openFromTauriPath,
  isDirty,
  getDuplicateSnapshot,
  setDocState,
  kindForFilename,
  type DuplicateSnapshot,
} from './doc-source'
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
  await listenHere('menu:file-duplicate-window', () => {
    void duplicateCurrentWindow(harness)
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
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const pending = await invoke<string[]>('drain_pending_opened')
    for (const path of pending) {
      void openFromTauriPath(harness, path)
    }
  } catch (err) {
    console.error('[tauri-bridge] failed to drain pending opens:', err)
  }

  // Window-payload drain. When this window was spawned by
  // `spawn_window_with_payload` (File → Duplicate Window, or right-
  // click → Open Link in New Window from another window), the Rust
  // side stashed an initial-state payload keyed by this window's
  // label. Consume it AFTER drain_pending_opened so an explicit
  // duplicate payload wins over any inherited cold-start file path.
  try {
    const payload = await invoke<WindowSpawnPayload | null>('drain_window_payload')
    if (payload) {
      await applySpawnPayload(harness, payload)
    }
  } catch (err) {
    console.error('[tauri-bridge] failed to drain window payload:', err)
  }

  // Cold-start deep-link only. The warm-state `onOpenUrl` listener
  // used to live here too, but the plugin emits the event unscoped
  // so EVERY window's listener fired in parallel — multiple windows
  // racing to load the same URL. Rust now owns warm-state deep links
  // via `app.deep_link().on_open_url(…)` in lib.rs's setup, which
  // spawns a fresh window for each arrival (rather than replacing
  // the focused window). Cold-start arrivals continue here so the
  // URL lands in the auto-spawned main window instead of creating a
  // second one — and the focus check below makes sure only main
  // actually loads it.
  if (label === 'main') {
    const deepLink = await import('@tauri-apps/plugin-deep-link')
    const cold = await deepLink.getCurrent()
    if (cold && cold.length > 0) {
      for (const url of cold) {
        void handleDeepLink(harness, url)
      }
    }
  }
}

// Initial-state payload shape for a window spawned via
// `spawn_window_with_payload`. Two variants:
//
//   - 'snapshot' — File → Duplicate Window. Carries the originator's
//     doc identity (sourceKind + sourceValue, or null=scratch) plus
//     fallback text. Path / URL sources are re-loaded from authority
//     in the new window; scratch falls back to replacing the doc with
//     the carried text so the user keeps their unsaved buffer.
//   - 'fresh-url' — right-click → Open Link in New Window. Loads the
//     target URL directly, bypassing the phishing gate because the
//     originating click happened inside a trusted Nicer.md window.
type WindowSpawnPayload =
  | { kind: 'snapshot'; snapshot: DuplicateSnapshot }
  | { kind: 'fresh-url'; url: string }

async function applySpawnPayload(
  harness: Harness,
  payload: WindowSpawnPayload,
): Promise<void> {
  if (payload.kind === 'fresh-url') {
    try {
      await loadFromUrl(harness, payload.url)
    } catch (err) {
      console.error('[tauri-bridge] open-link-in-new-window failed:', payload.url, err)
    }
    return
  }
  const snap = payload.snapshot
  if (snap.sourceKind === 'tauri-path' && snap.sourceValue) {
    try {
      await openFromTauriPath(harness, snap.sourceValue)
      return
    } catch (err) {
      console.error('[tauri-bridge] duplicate re-read failed:', snap.sourceValue, err)
      // Fall through to scratch with the carried text — better to
      // surface SOMETHING than to leave the new window empty.
    }
  } else if (snap.sourceKind === 'url' && snap.sourceValue) {
    try {
      await loadFromUrl(harness, snap.sourceValue)
      return
    } catch (err) {
      console.error('[tauri-bridge] duplicate re-fetch failed:', snap.sourceValue, err)
    }
  }
  // Scratch / FSA / failed re-load: replace the doc with the carried
  // text. Source stays null so a later Cmd+S falls through to Save-As
  // (the new window doesn't own the original file's write path).
  setDocState(snap.text, snap.name, null, snap.contentKind)
  harness.replaceDoc(snap.text)
}

// Spawn a new window seeded with the current window's doc state.
// Reuses the Tauri `spawn_window_with_payload` command which builds
// the window AFTER inserting the payload, so the new window's
// `drain_window_payload` always finds it. Errors are logged but not
// surfaced — the menu item is fire-and-forget.
export async function duplicateCurrentWindow(harness: Harness): Promise<void> {
  if (!isTauri()) return
  const snapshot = getDuplicateSnapshot(harness.getMarkdown())
  // Keep the snapshot's contentKind in sync with the name in case the
  // user renamed mid-session and we want the new window to classify
  // correctly. Name-driven classify wins when present.
  if (snapshot.name) {
    snapshot.contentKind = kindForFilename(snapshot.name)
  }
  const payload: WindowSpawnPayload = { kind: 'snapshot', snapshot }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<string>('spawn_window_with_payload', { payload })
  } catch (err) {
    console.error('[tauri-bridge] duplicate window failed:', err)
  }
}

// Spawn a new window already pointed at a URL — used by the right-
// click "Open Link in New Window" affordance on rendered anchors.
// Trust model: the click happened inside an existing Nicer.md window,
// which means the user trusts the originating doc; the new window
// loads via `loadFromUrl` directly (no phishing gate) so it matches
// the in-place chained-click flow.
export async function openUrlInNewWindow(url: string): Promise<void> {
  if (!isTauri()) return
  const payload: WindowSpawnPayload = { kind: 'fresh-url', url }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke<string>('spawn_window_with_payload', { payload })
  } catch (err) {
    console.error('[tauri-bridge] open-url-in-new-window failed:', err)
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
