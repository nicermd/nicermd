// Chrome visibility — one controller for every floating surface
// (title strip, mode pill, Menu pill, Write top toolbar). All of them
// hide and show off the single `data-strip-hidden` flag on <html>;
// this module owns when that flag flips.
//
// The grammar: chrome answers INTENT (2026-08-01, supersedes the
// scroll-only grammar):
//
//   reach  — pointer moves (mouse)            → show, arm idle timer
//   read   — sustained scroll down            → hide immediately
//   write  — typing in an editing surface     → hide immediately
//   engage — clicking into the page           → hide immediately
//   still  — ~2.5s without reach              → hide
//   pin    — pointer resting on chrome        → never counts as idle
//   shift  — mode change / boot (showStrip)   → show, arm idle timer
//
// Scroll-UP deliberately does NOT reveal for mouse users — reaching
// is the reveal gesture, and up-scroll reveal was the main source of
// accidental chrome flashing during reading. Touch keeps the old
// scroll grammar (scroll-up reveals, near-top always shows) because
// there is no pointer to reach with; the two paths are distinguished
// per-interaction via pointerType/touch events, never by device
// sniffing, so hybrids (touch laptops, iPad + trackpad) do the right
// thing for whichever input the hand is on.

const IDLE_MS = 2500
const LEAVE_MS = 600
// Reach must clear a small threshold from the last anchor point so
// desk vibration / mouse twitch doesn't wake the chrome. The anchor
// only moves when the threshold is crossed, so slow deliberate drift
// still accumulates into a reveal.
const REACH_PX = 4
const HIDE_AT_DELTA = 5
const TOUCH_ALWAYS_SHOW_BELOW = 50
// How long after the last touch contact a scroll is still considered
// touch-driven (momentum scrolling outlives the finger).
const TOUCH_RECENT_MS = 900

let idleTimer: number | null = null
let pinned = false

function html(): DOMStringMap {
  return document.documentElement.dataset
}

function hide(): void {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer)
    idleTimer = null
  }
  html().stripHidden = '1'
}

function armIdle(ms: number = IDLE_MS): void {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = null
  if (pinned) return
  idleTimer = window.setTimeout(() => {
    idleTimer = null
    hide()
  }, ms)
}

// Show the chrome and arm the idle fade. Exported for context shifts
// (mode change, boot) where the user benefits from re-seeing the
// filename, active mode and shortcut flashes.
export function showStrip(): void {
  delete html().stripHidden
  armIdle()
}

export function setupChromeVisibility(): void {
  // --- reach (mouse only) -------------------------------------------
  let anchorX = -1
  let anchorY = -1
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return
      // A held button means dragging (text selection, checkbox sweep)
      // — that's engaging with content, not reaching for chrome.
      if (e.buttons !== 0) return
      // Pin while the pointer rests on a chrome surface — hovering a
      // control must never count as idle.
      const t = e.target
      pinned =
        t instanceof Element &&
        t.closest('.mode-icons, .top-toolbar, .menu-pill') !== null
      if (anchorX >= 0) {
        const dx = e.clientX - anchorX
        const dy = e.clientY - anchorY
        if (dx * dx + dy * dy < REACH_PX * REACH_PX) return
      }
      anchorX = e.clientX
      anchorY = e.clientY
      showStrip()
    },
    { passive: true },
  )

  // --- engage ---------------------------------------------------------
  // Clicking into the document hides the chrome — the user is placing
  // a caret, selecting, following a link. Chrome and overlay clicks
  // are exempt (the panel, pickers and controls live outside
  // .mode-host). Re-anchor at the click point so the click's own
  // micro-jitter doesn't immediately count as a fresh reach.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'mouse') return
      const t = e.target
      if (!(t instanceof Element) || !t.closest('.mode-host')) return
      anchorX = e.clientX
      anchorY = e.clientY
      pinned = false
      hide()
    },
    { passive: true },
  )

  // Pointer leaving the window: fade sooner than the idle timer — the
  // user has moved on to another window / screen edge.
  document.documentElement.addEventListener('mouseleave', () => {
    pinned = false
    armIdle(LEAVE_MS)
  })

  // --- write --------------------------------------------------------
  // Typing in an editing surface hides the chrome immediately: hands
  // are on the keyboard, the surface should be just the document.
  // Shortcut chords are ignored (they're commands, not writing), and
  // the reach anchor resets so the next real mouse move reveals again.
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Enter') return
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    const editing =
      t.isContentEditable || t.closest('.cm-editor, textarea') !== null
    if (!editing) return
    anchorX = -1
    anchorY = -1
    hide()
  })

  // --- read / touch -------------------------------------------------
  // Track recent touch contact so scroll direction handling can tell
  // finger-driven scrolls (incl. momentum) from wheel/trackpad ones.
  let lastTouchTs = -Infinity
  window.addEventListener(
    'touchstart',
    () => {
      lastTouchTs = performance.now()
    },
    { passive: true },
  )
  window.addEventListener(
    'touchmove',
    () => {
      lastTouchTs = performance.now()
    },
    { passive: true },
  )

  let lastY = 0
  let ticking = false
  const update = (): void => {
    const y = window.scrollY
    const delta = y - lastY
    lastY = y
    ticking = false
    const touchDriven = performance.now() - lastTouchTs < TOUCH_RECENT_MS
    if (delta > HIDE_AT_DELTA) {
      // Sustained downward scroll = reading, on every input type.
      hide()
      return
    }
    // Upward scroll / near-top reveal is touch grammar only — there
    // is no pointer to reach with. Mouse users reveal by reaching.
    if (touchDriven && (delta < 0 || y < TOUCH_ALWAYS_SHOW_BELOW)) {
      showStrip()
    }
  }
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        requestAnimationFrame(update)
        ticking = true
      }
    },
    { passive: true },
  )

  // Boot: chrome starts visible (shortcut hints flash via the pills'
  // observers), then settles away if the user does nothing.
  showStrip()
}
