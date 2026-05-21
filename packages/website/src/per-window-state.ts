// Per-window state persistence.
//
// localStorage is shared across same-origin webviews in Tauri, so any
// straightforward `localStorage.setItem('mode', '2')` would leak the
// active mode from window A to window B on its next boot. We key on
// the Tauri window label so each window restores its own state
// independently — matches the autosave pattern documented in
// autosave.ts.
//
// Two kinds of state restored here:
//
//   • Mode (1..4) — which of Read / Write / Split / Code was active
//     when the window last quit. Persists across launches so a
//     restored window comes back in the same mode the user left it.
//
//   • Source (tauri-path / url) — which doc was loaded. On boot the
//     window re-reads (or re-fetches) so the user lands back at the
//     same content. FSA handles are intentionally excluded: the
//     File-System-Access handle table doesn't survive a page reload,
//     so we'd lose write-back access anyway. Anonymous / scratch
//     docs (source = null) explicitly clear the persisted source.

const MODE_PREFIX = 'nicermd:mode'
const SOURCE_PREFIX = 'nicermd:source'

function getWindowLabel(): string {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } }
  }).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? 'main'
}

// --- Mode ----------------------------------------------------------------

export function persistMode(mode: number): void {
  try {
    localStorage.setItem(`${MODE_PREFIX}:${getWindowLabel()}`, String(mode))
  } catch {
    // localStorage unavailable — silent.
  }
}

export function readPersistedMode(): number | null {
  try {
    const raw = localStorage.getItem(`${MODE_PREFIX}:${getWindowLabel()}`)
    if (!raw) return null
    const n = parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 1 || n > 4) return null
    return n
  } catch {
    return null
  }
}

// --- Source ---------------------------------------------------------------

export interface PersistedSource {
  // Mirrors the DocSource discriminator without including the FSA
  // handle variant — that one can't round-trip through localStorage.
  kind: 'tauri-path' | 'url'
  value: string
  // Display name and content kind so the restored window's title +
  // mode-toggle UI come up correctly without an extra fetch.
  name: string | null
  contentKind: { kind: string; language?: string }
}

export function persistSource(source: PersistedSource | null): void {
  const key = `${SOURCE_PREFIX}:${getWindowLabel()}`
  try {
    if (source === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(source))
    }
  } catch {
    // localStorage unavailable / quota — silent.
  }
}

export function readPersistedSource(): PersistedSource | null {
  try {
    const raw = localStorage.getItem(`${SOURCE_PREFIX}:${getWindowLabel()}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedSource
    if (!parsed || typeof parsed.kind !== 'string') return null
    if (parsed.kind !== 'tauri-path' && parsed.kind !== 'url') return null
    if (typeof parsed.value !== 'string' || !parsed.value) return null
    return parsed
  } catch {
    return null
  }
}
