// Horizontal touch swipe → cycle modes. Attaches to the mode-host so
// the gesture is scoped to the doc surface (top chrome and bottom
// format bar keep their own behaviour).
//
// Two filters keep the gesture out of the way:
//   1. Edge deadzone on left/right (24px) — iOS Safari uses edge
//      swipes for back/forward navigation, so any gesture starting
//      that close to the screen edge is left for the browser.
//   2. Threshold + vertical cap + time cap — the gesture has to be
//      clearly horizontal AND fast (≤500ms) to register. Slow drags
//      (text selection in Tiptap / CodeMirror), vertical scrolls,
//      and accidental brushes all fail the check and pass through to
//      default behaviour. iOS doesn't start text selection from a
//      quick flick anyway, so a fast horizontal swipe inside an
//      editor surface fires the mode switch without conflicting
//      with the native selection gesture (which needs a longer hold
//      or a slower drag).

import type { Harness } from './main'

const SWIPE_THRESHOLD_PX = 60
const MAX_VERTICAL_PX = 40
const MAX_DURATION_MS = 500
const EDGE_DEADZONE_PX = 24

export function setupTouchSwipe(harness: Harness, host: HTMLElement): void {
  let startX: number | null = null
  let startY = 0
  let startTime = 0

  host.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        startX = null
        return
      }
      const t = e.touches[0]!
      // Edge deadzone — iOS uses these regions for native back/forward.
      if (
        t.clientX < EDGE_DEADZONE_PX ||
        t.clientX > window.innerWidth - EDGE_DEADZONE_PX
      ) {
        startX = null
        return
      }
      startX = t.clientX
      startY = t.clientY
      startTime = performance.now()
    },
    { passive: true },
  )

  host.addEventListener(
    'touchend',
    (e) => {
      if (startX === null) return
      const t = e.changedTouches[0]
      const sx = startX
      startX = null
      if (!t) return
      const dx = t.clientX - sx
      const dy = t.clientY - startY
      const dt = performance.now() - startTime
      if (dt > MAX_DURATION_MS) return
      if (Math.abs(dy) > MAX_VERTICAL_PX) return
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
      // Clean horizontal swipe. Left = next mode, right = previous —
      // matches the typical carousel / tab-bar convention. The 'slide'
      // style is gesture-only: the directional animation mirrors the
      // swipe and feels causal. Keyboard / icon-click paths default
      // to the lighter 'fade' style.
      if (dx < 0) harness.cycle('slide')
      else harness.cyclePrevious('slide')
    },
    { passive: true },
  )

  // touchcancel resets state so a rejected gesture (multi-touch added
  // mid-drag, OS interruption) doesn't fire a stale swipe on the next
  // touchend.
  host.addEventListener(
    'touchcancel',
    () => {
      startX = null
    },
    { passive: true },
  )
}
