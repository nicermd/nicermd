// Chrome finish — the material story for the top chrome, toggleable
// at runtime while the island-vs-graphite round dogfoods (2026-08-01;
// second use of this pattern — the first round retired frosted-glass
// surfaces under the controls, this one tests glass around them).
//
//   graphite (default) — H3: opaque neutral strip + accent sheen
//                        tool row (the locked 2026-08-01 baseline)
//   island             — H1: frosted-glass band with the buttons on
//                        an opaque graphite plate, so controls hold
//                        contrast whatever scrolls beneath
//
// Pure CSS swap via data-finish on <html> — no reload. Persisted in
// localStorage. Reachable from the tool-row toggle button and the
// command palette; once a winner emerges this collapses to a single
// finish and the toggle goes away.

const STORAGE_KEY = 'nicermd:chrome-finish'

export type ChromeFinish = 'graphite' | 'island'

export function getFinish(): ChromeFinish {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'island'
      ? 'island'
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
  const next: ChromeFinish = getFinish() === 'island' ? 'graphite' : 'island'
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode — session-only toggle still works */
  }
  apply(next)
  return next
}
