// Hide-on-scroll behaviour for the window title strip + mode icons.
// Scrolling down past a threshold translates the strip out of view;
// scrolling up by any amount brings it back. Near the top of the
// document (< 50px) the strip is always visible.
//
// Asymmetric thresholds: hide needs sustained downward velocity (> 5px
// per frame) so momentum jitter doesn't toggle it, but show fires on
// any upward delta — otherwise reading-pace scroll-up (1–2px per
// frame) can't bring it back, and the strip stays stuck off-screen.
//
// Listens to `window` scroll, so naturally inert in mode 3 (split):
// that mode scrolls inside its panes, not the document.

const HIDE_AT_DELTA = 5
const ALWAYS_SHOW_BELOW = 50

// Manual override — clear `data-strip-hidden` so the strip slides
// back into view. Useful on mode change / other context shifts where
// the user benefits from re-seeing the filename and active mode.
// Subsequent scrolls re-engage the auto-hide as normal.
export function showStrip(): void {
  delete document.documentElement.dataset.stripHidden
}

export function setupScrollStrip(): void {
  let lastY = 0
  let ticking = false

  const update = (): void => {
    const y = window.scrollY
    const html = document.documentElement
    const delta = y - lastY
    if (y < ALWAYS_SHOW_BELOW || delta < 0) {
      delete html.dataset.stripHidden
    } else if (delta > HIDE_AT_DELTA) {
      html.dataset.stripHidden = '1'
    }
    lastY = y
    ticking = false
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        requestAnimationFrame(update)
        ticking = true
      }
    },
    { passive: true }
  )
}
