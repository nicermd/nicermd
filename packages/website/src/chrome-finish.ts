// Chrome finish — the material story for the top chrome, toggleable
// at runtime while the graphite-vs-glass question dogfoods (2026-08-01
// round; the ?option flags retired in favour of this because the
// desktop shell has no URL bar to type them into).
//
//   graphite (default) — opaque: neutral ink-gradient window strip,
//                        accent sheen tool row
//   glass              — frosted: translucent strip + tool row with
//                        backdrop blur, content ghosts through
//
// Pure CSS swap via data-finish on <html> — no reload. Persisted in
// localStorage. Reachable from the tool-row toggle button and the
// command palette; once a winner emerges this collapses to a single
// finish and the toggle goes away.

const STORAGE_KEY = 'nicermd:chrome-finish'

export type ChromeFinish = 'graphite' | 'glass'

export function getFinish(): ChromeFinish {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'glass'
      ? 'glass'
      : 'graphite'
  } catch {
    return 'graphite'
  }
}

function apply(finish: ChromeFinish): void {
  document.documentElement.dataset.finish = finish
}

export function initFinish(): void {
  apply(getFinish())
}

export function toggleFinish(): ChromeFinish {
  const next: ChromeFinish = getFinish() === 'glass' ? 'graphite' : 'glass'
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode — session-only toggle still works */
  }
  apply(next)
  return next
}
