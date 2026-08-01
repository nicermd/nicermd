// Chrome finish — milky glass is THE material (2026-08-01 verdict;
// graphite removed after the milky recipe fixed glass's legibility).
// The remaining open question, toggleable at runtime while it
// dogfoods: does the button group earn an opaque graphite plate
// ("island") on the glass, or sit plate-less on the frost?
//
//   glass (default) — buttons directly on the milky band
//   island          — buttons on a graphite plate floating in it
//
// Pure CSS swap via data-finish on <html> — no reload. Persisted in
// localStorage (older stored values from the retired graphite round
// fall back to 'glass'). Reachable from the tool-row toggle button
// and the command palette; collapses to one state when the verdict
// lands.

const STORAGE_KEY = 'nicermd:chrome-finish'

export type ChromeFinish = 'glass' | 'island'

export function getFinish(): ChromeFinish {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'island'
      ? 'island'
      : 'glass'
  } catch {
    return 'glass'
  }
}

function apply(finish: ChromeFinish): void {
  document.documentElement.dataset.finish = finish
}

export function initFinish(): void {
  apply(getFinish())
}

export function toggleFinish(): ChromeFinish {
  const next: ChromeFinish = getFinish() === 'island' ? 'glass' : 'island'
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode — session-only toggle still works */
  }
  apply(next)
  return next
}
