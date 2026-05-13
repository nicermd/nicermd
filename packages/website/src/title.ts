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
  // Left-anchored brand mark. The filename is centred via the parent's
  // flex layout; the logo lives in its own absolutely-positioned child
  // so it doesn't shift the centring as the filename grows or shrinks.
  const logo = document.createElement('img')
  logo.className = 'window-title__logo'
  logo.src = '/favicon-256.png'
  logo.alt = ''
  logo.setAttribute('aria-hidden', 'true')
  titleBarEl.appendChild(logo)
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
  refreshTitle()
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
    titleTextEl.textContent = display
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
