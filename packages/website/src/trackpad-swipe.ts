// Trackpad two-finger swipe → cycle modes. Desktop only — the
// pointer-world sibling of touch-swipe.ts (touch already swipes to
// cycle; a trackpad swipe is the same gesture arriving as wheel
// events with horizontal delta). In browsers two-finger horizontal
// is history back/forward, so this never runs on web.
//
// Guards, in order:
//   1. Horizontal-scroll yield — if anything under the pointer can
//      scroll horizontally (wide tables in Read, long lines in
//      Code), the gesture belongs to it and we stand down for the
//      rest of the gesture.
//   2. Dominance + threshold — the accumulated delta must be
//      clearly horizontal (2× the vertical) and substantial, so
//      diagonal document scrolls never fire it.
//   3. One fire per gesture + cooldown — trackpad momentum keeps
//      emitting wheel events long after the fingers stop; the fired
//      flag holds until the wheel train goes quiet and the cooldown
//      stops a fresh gesture from machine-gunning through modes.
//
// Direction matches touch: fingers moving left (natural-scroll
// deltaX > 0, content pushed left) → next mode; right → previous.
// 'slide' animation mirrors the gesture, same as touch.

import type { Harness } from './main'

const FIRE_THRESHOLD_PX = 100
const DOMINANCE = 2
const GESTURE_END_MS = 180
const COOLDOWN_MS = 300
// Momentum deltas only ever decay; a delta that jumps well past the
// previous one is fresh fingers — a NEW swipe starting inside the
// old gesture's tail. Without this, the tail keeps the gesture
// window alive and swallows quick successive swipes ("gets stuck").
const IMPULSE_RATIO = 2
const IMPULSE_MIN_PX = 15

export function setupTrackpadSwipe(harness: Harness, host: HTMLElement): void {
  if (document.documentElement.dataset.shell !== 'tauri') return

  let accX = 0
  let accY = 0
  let done = false // fired OR yielded — swallow the rest of the gesture
  let endTimer: number | null = null
  let coolUntil = 0
  let prevMag = 0

  const reset = (): void => {
    accX = 0
    accY = 0
    done = false
    prevMag = 0
  }

  const horizontallyScrollable = (from: Element | null): boolean => {
    for (let el = from; el && el !== host.parentElement; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const o = getComputedStyle(el).overflowX
        if (o === 'auto' || o === 'scroll') return true
      }
    }
    return false
  }

  host.addEventListener(
    'wheel',
    (e) => {
      const now = performance.now()
      // Every event extends the "gesture still running" window.
      if (endTimer !== null) window.clearTimeout(endTimer)
      endTimer = window.setTimeout(reset, GESTURE_END_MS)
      // Rising edge inside a spent gesture's momentum tail = new
      // swipe: reopen immediately instead of waiting for quiet.
      const mag = Math.abs(e.deltaX)
      if (
        done &&
        now >= coolUntil &&
        mag > IMPULSE_MIN_PX &&
        mag > prevMag * IMPULSE_RATIO
      ) {
        accX = 0
        accY = 0
        done = false
      }
      prevMag = mag
      if (done || now < coolUntil) return
      accX += e.deltaX
      accY += e.deltaY
      if (Math.abs(accX) < FIRE_THRESHOLD_PX) return
      if (Math.abs(accX) < DOMINANCE * Math.abs(accY)) return
      if (e.target instanceof Element && horizontallyScrollable(e.target)) {
        done = true
        return
      }
      done = true
      coolUntil = now + COOLDOWN_MS
      if (accX > 0) harness.cycle('slide')
      else harness.cyclePrevious('slide')
    },
    { passive: true },
  )
}
