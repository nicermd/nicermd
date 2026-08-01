// Iteration A/B flag. Reads `?option=N` from the URL on first call;
// falls back to localStorage so the choice survives refreshes (and
// works inside Tauri where pinned tabs aren't a thing). Browser users
// pin separate URLs; Tauri users cycle via the keyboard shortcut wired
// in main.ts. 0 = baseline (current build).

const STORAGE_KEY = 'nicermd:option'
// Active round (2026-08-01 pm, strip finish): 0 = D1 baseline (shared
// sheen band, Write only), 1 = F1 graphite strip in all modes,
// 2 = F4 frosted-glass strip in all modes. Cycle in-app with
// Cmd+Shift+Alt+O. (Earlier: two-tier D beat B's traffic-light
// reposition; soft sheen beat flat tint + bottom proximity pill;
// accent window frame shipped.)
const MAX_OPTION = 2 // bump as new variants land

let cached: number | null = null

function read(): number {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('option')
    if (fromUrl !== null) {
      const n = Number.parseInt(fromUrl, 10)
      if (Number.isFinite(n) && n >= 0) {
        // Mirror to storage so reload-without-query still honours the
        // last explicit choice (Tauri build target).
        try {
          window.localStorage.setItem(STORAGE_KEY, String(n))
        } catch {
          /* private mode — ignore */
        }
        return n
      }
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const n = Number.parseInt(stored, 10)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    /* SSR or storage blocked — fall through */
  }
  return 0
}

export function getOption(): number {
  if (cached === null) cached = read()
  return cached
}

export function cycleOption(): void {
  const next = (getOption() + 1) % (MAX_OPTION + 1)
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    /* ignore */
  }
  // Strip ?option=N from the URL before reload so the new value (in
  // localStorage) wins over a stale query param. Preserve other params.
  try {
    const u = new URL(window.location.href)
    u.searchParams.delete('option')
    window.history.replaceState(null, '', u.toString())
  } catch {
    /* ignore */
  }
  window.location.reload()
}
