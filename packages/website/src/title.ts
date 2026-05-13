// Filename + dirty indicator. Two surfaces:
//
//   - In-window strip: a `<div class="window-title">` rendered into
//     the top 28px of the window in both web and Tauri shells. CSS
//     [data-tauri="1"] (set unconditionally in main.ts) gates display.
//   - `document.title` always updates so the browser tab reflects the
//     active doc and dirty state regardless of strip visibility.
//
// In Tauri, the same 28px area also acts as a native title bar:
// drag-to-move (mousedown + threshold-crossed → `startDragging`) and
// double-click to toggle maximise. Those interactions live on a
// separate, always-present `.title-drag-zone` element rather than on
// the visual `.window-title` itself — so when scroll-hide translates
// the visual strip off-screen, the drag/dblclick surface stays put.

import type { Harness } from './main'
import { isDirty, getCurrentName, getCurrentSourceUrl } from './doc-source'
import { APP_NAME } from './version'

let titleBarEl: HTMLElement | null = null
let titleTextEl: HTMLElement | null = null
let harnessRef: Harness | null = null

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function setupTitle(harness: Harness, root: HTMLElement): void {
  harnessRef = harness

  titleBarEl = document.createElement('div')
  titleBarEl.className = 'window-title'
  // Text in a child span so text-overflow:ellipsis fires reliably:
  // text-overflow needs an element with overflow:hidden + nowrap of
  // its own, and a centred flex container doesn't qualify (the text
  // node is laid out as an anonymous flex item). The child carries
  // the truncation rules; the parent stays a clean flex centre.
  titleTextEl = document.createElement('span')
  titleTextEl.className = 'window-title__text'
  titleBarEl.appendChild(titleTextEl)
  root.appendChild(titleBarEl)

  if (isTauri()) {
    const dragZone = document.createElement('div')
    dragZone.className = 'title-drag-zone'
    root.appendChild(dragZone)
    wireTitleBarInteractions(dragZone)
  }

  harness.onLocalChange(() => refreshTitle())
  document.addEventListener('nicermd:source-changed', () => refreshTitle())
  // Re-fit middle truncation when the viewport changes — the constraint
  // is purely width-based, so the kept-chars count can grow on a phone
  // rotated to landscape and shrink back on portrait. rAF batching
  // avoids running the binary search on every resize event during a
  // smooth-resize gesture.
  let resizeRaf: number | null = null
  window.addEventListener('resize', () => {
    if (resizeRaf !== null) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null
      refreshTitle()
    })
  })
  refreshTitle()
}

// Middle-truncate `fullText` so it fits in `el`'s clientWidth without
// overflowing. Keeps an equal number of characters from both ends and
// inserts an ellipsis in the middle, e.g.
//   architecture-decision-record-04.md  →  archit…rd-04.md
// The end-side bias means the file extension (the most identifying
// suffix, usually) survives even hard truncation. Binary search runs
// O(log n) layout queries — a handful for any realistic filename.
function fitMiddle(el: HTMLElement, fullText: string): void {
  el.textContent = fullText
  if (el.scrollWidth <= el.clientWidth) return
  // The longest possible 'keep' is half the string minus one char for
  // the ellipsis; we then search downward for the largest value that
  // still fits.
  let lo = 1
  let hi = Math.floor((fullText.length - 1) / 2)
  let best = 0
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    el.textContent =
      fullText.slice(0, mid) + '…' + fullText.slice(fullText.length - mid)
    if (el.scrollWidth <= el.clientWidth) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (best === 0) {
    // Even '<first>…<last>' doesn't fit — fall back to the CSS ellipsis
    // path. Visible result will be the leading characters of fullText
    // with a single '…' on the right, courtesy of text-overflow.
    el.textContent = fullText
  } else {
    el.textContent =
      fullText.slice(0, best) + '…' + fullText.slice(fullText.length - best)
  }
}

function wireTitleBarInteractions(el: HTMLElement): void {
  // Drag arms on mousedown but only fires `startDragging` once the
  // mouse has moved past a small threshold. Calling it on every
  // mousedown caused the OS to grab input on the first click of a
  // double-click, suppressing the dblclick event.
  const DRAG_THRESHOLD_PX = 5
  let dragStart: { x: number; y: number } | null = null

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    dragStart = { x: e.clientX, y: e.clientY }
  })

  el.addEventListener('mousemove', (e) => {
    if (!dragStart) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
    dragStart = null
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().startDragging()
    })()
  })

  window.addEventListener('mouseup', () => {
    dragStart = null
  })

  el.addEventListener('dblclick', () => {
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().toggleMaximize()
    })()
  })
}

export function refreshTitle(): void {
  if (!harnessRef) return
  const rawName = getCurrentName()
  const dirty = isDirty()
  const isLanding = rawName === null && !dirty
  // Landing: tab + strip both show the bare app name. Working state
  // (file loaded or any keystroke): tab becomes '<display> — Nicer.md',
  // strip shows '<display>'. Alpha is signaled exclusively by the
  // corner badge + landing strap so the title stays uncluttered.
  const display = isLanding ? APP_NAME : (dirty ? '• ' : '') + (rawName ?? 'Untitled')
  document.title = isLanding ? APP_NAME : `${display} — ${APP_NAME}`
  if (titleBarEl && titleTextEl) {
    fitMiddle(titleTextEl, display)
    // Native browser tooltip shows the source URL on hover for files
    // loaded via Open-URL. Removed cleanly when the next doc is loaded
    // from disk / drag-drop / new — getCurrentSourceUrl() returns null
    // and the attribute clears.
    const sourceUrl = getCurrentSourceUrl()
    if (sourceUrl) {
      titleBarEl.setAttribute('title', sourceUrl)
    } else {
      titleBarEl.removeAttribute('title')
    }
  }
}
