// Spike-variant cycler. Lets us A/B between candidate UI states without
// reload, persisted to localStorage.
//
// Currently wired to one variant set: where the mode-switcher icons
// live (`none` / `top` / `bottom`). The filename is always pinned to
// the top — the bottom slot is reserved for mode-specific chrome
// (e.g. a format toolbar in mode 2). Browser cycles all three;
// Tauri cycles just `top` / `bottom` because its title strip is
// always visible.
//
// On boot, resolves: ?strip=… URL param > localStorage > shell default.
// The URL param exists for share-a-link.
//
// Keyboard cycle (Cmd+Shift+. / Cmd+Shift+,) is dev-only and
// tree-shaken from production builds via `import.meta.env.DEV`. The
// state-application logic ships in production so URL params still
// work.

export type StripVariant = 'none' | 'top' | 'bottom'

const STORAGE_KEY = 'nicermd:strip-variant'
const BROWSER_VARIANTS: StripVariant[] = ['none', 'top', 'bottom']
const TAURI_VARIANTS: StripVariant[] = ['top', 'bottom']

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function variantsForShell(): StripVariant[] {
  return isTauri() ? TAURI_VARIANTS : BROWSER_VARIANTS
}

function shellDefault(): StripVariant {
  return isTauri() ? 'top' : 'none'
}

function readStored(): StripVariant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'none' || raw === 'top' || raw === 'bottom') return raw
  } catch {
    // localStorage may be unavailable; fall through.
  }
  return null
}

function readUrl(): StripVariant | null {
  const v = new URLSearchParams(window.location.search).get('strip')
  if (v === 'bottom') return 'bottom'
  if (v === 'top' || v === '1') return 'top'
  if (v === 'none') return 'none'
  return null
}

function getInitialVariant(): StripVariant {
  const valid = variantsForShell()
  const fromUrl = readUrl()
  if (fromUrl && valid.includes(fromUrl)) return fromUrl
  const fromStorage = readStored()
  if (fromStorage && valid.includes(fromStorage)) return fromStorage
  return shellDefault()
}

let current: StripVariant = 'none'

export function getCurrentVariant(): StripVariant {
  return current
}

export function applyVariant(next: StripVariant): void {
  current = next
  const html = document.documentElement
  if (next === 'none') {
    delete html.dataset.tauri
    delete html.dataset.shell
    delete html.dataset.stripPos
  } else {
    html.dataset.tauri = '1'
    html.dataset.shell = isTauri() ? 'tauri' : 'browser-strip'
    html.dataset.stripPos = next
  }
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // localStorage may be unavailable; ignore.
  }
}

function cycle(direction: 1 | -1): void {
  const valid = variantsForShell()
  const idx = valid.indexOf(current)
  const start = idx === -1 ? 0 : idx
  const next = valid[(start + direction + valid.length) % valid.length]
  applyVariant(next)
}

export function setupVariantCycle(): void {
  applyVariant(getInitialVariant())

  // Dev-only keyboard cycle. `import.meta.env.DEV` is replaced with the
  // literal `false` in production builds, so the listener and its
  // closure are tree-shaken away.
  if (import.meta.env.DEV) {
    window.addEventListener('keydown', (e) => {
      if (!e.metaKey || !e.shiftKey || e.altKey || e.ctrlKey) return
      // Match by physical key (`e.code`): when Cmd is held, some
      // browsers suppress shift's character mapping in `e.key`, so
      // testing for `>` / `<` misses. `Period` / `Comma` are stable.
      if (e.code !== 'Period' && e.code !== 'Comma') return
      e.preventDefault()
      cycle(e.code === 'Period' ? 1 : -1)
    })
  }
}
