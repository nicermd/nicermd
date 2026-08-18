// Trackpad two-finger swipe → cycle modes, both shells — the
// pointer-world sibling of touch-swipe.ts (touch already swipes to
// cycle; a trackpad swipe is the same gesture arriving as wheel
// events with horizontal delta). On web, browsers use the gesture
// for history back/forward — main.css sets overscroll-behavior-x:
// none (the Figma/Maps pattern) so the page reclaims it before this
// detector ever sees the wheel train.
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
// Axis lock: a gesture declares itself in its first few pixels —
// real swipes start horizontal immediately, scrolls start vertical.
// A vertical-locked gesture can never fire, however it drifts
// (2026-08-06: total-based dominance let long scrolls that curved
// sideways mis-fire mode switches).
const AXIS_LOCK_PX = 12
// Momentum deltas only ever decay; a delta that jumps well past the
// previous one is fresh fingers — a NEW swipe starting inside the
// old gesture's tail. Without this, the tail keeps the gesture
// window alive and swallows quick successive swipes ("gets stuck").
const IMPULSE_RATIO = 2
const IMPULSE_MIN_PX = 15

export function setupTrackpadSwipe(harness: Harness, host: HTMLElement): void {
  let accX = 0
  let accY = 0
  let axis: 'h' | 'v' | null = null
  let done = false // fired OR yielded — swallow the rest of the gesture
  let endTimer: number | null = null
  let coolUntil = 0
  let prevMag = 0

  const reset = (): void => {
    accX = 0
    accY = 0
    axis = null
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
      // prevMag tracks the event's TOTAL magnitude — during a
      // vertical scroll deltaX is ~0, and comparing horizontal-only
      // made any sideways drift look like fresh fingers, reopening
      // a vertical-locked gesture (the drift misfire, 2026-08-06).
      const dxMag = Math.abs(e.deltaX)
      const evMag = dxMag + Math.abs(e.deltaY)
      if (
        done &&
        now >= coolUntil &&
        dxMag > IMPULSE_MIN_PX &&
        evMag > prevMag * IMPULSE_RATIO
      ) {
        accX = 0
        accY = 0
        axis = null
        done = false
      }
      prevMag = evMag
      if (done || now < coolUntil) return
      accX += e.deltaX
      accY += e.deltaY
      if (axis === null && Math.abs(accX) + Math.abs(accY) >= AXIS_LOCK_PX) {
        axis = Math.abs(accX) > Math.abs(accY) ? 'h' : 'v'
        if (axis === 'v') {
          done = true
          return
        }
      }
      if (axis !== 'h') return
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
