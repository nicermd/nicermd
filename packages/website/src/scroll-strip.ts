// Hide-on-scroll behaviour for the window title strip + mode icons.
// Scrolling down translates the strip out of view; scrolling up brings
// it back. Near the top of the document (< 50px) the strip is always
// visible. CSS handles the actual transform so the bottom-icons
// variant slides down instead of up.
//
// Listens to `window` scroll, so naturally inert in mode 3 (split):
// that mode scrolls inside its panes, not the document.

const HIDE_AT_DELTA = 5
const ALWAYS_SHOW_BELOW = 50

export function setupScrollStrip(): void {
  let lastY = 0
  let ticking = false

  const update = (): void => {
    const y = window.scrollY
    const html = document.documentElement
    if (y < ALWAYS_SHOW_BELOW) {
      delete html.dataset.stripHidden
    } else {
      const delta = y - lastY
      if (delta > HIDE_AT_DELTA) {
        html.dataset.stripHidden = '1'
      } else if (delta < -HIDE_AT_DELTA) {
        delete html.dataset.stripHidden
      }
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
