// Filename + dirty indicator. Two surfaces:
//
//   - Tauri:   a custom `<div class="window-title">` rendered into the
//              28px traffic-light strip. CSS hides it in fullscreen.
//   - Browser: `document.title` updates (so the browser tab reflects
//              the active doc and dirty state).
//
// Refreshes whenever the harness fires a local-change event (user
// typing) or doc-source emits its custom `nicermd:source-changed` event
// (open / save / drag-drop / new).

import type { Harness } from './main'
import { isDirty, getCurrentName } from './doc-source'

const APP_NAME = 'Nicer.md'

let titleBarEl: HTMLElement | null = null
let harnessRef: Harness | null = null

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function setupTitle(harness: Harness, root: HTMLElement): void {
  harnessRef = harness

  if (isTauri()) {
    titleBarEl = document.createElement('div')
    titleBarEl.className = 'window-title'
    root.appendChild(titleBarEl)
  }

  harness.onLocalChange(() => refreshTitle())
  document.addEventListener('nicermd:source-changed', () => refreshTitle())
  refreshTitle()
}

export function refreshTitle(): void {
  if (!harnessRef) return
  const name = getCurrentName() ?? 'Untitled'
  const display = (isDirty() ? '• ' : '') + name
  document.title = `${display} — ${APP_NAME}`
  if (titleBarEl) titleBarEl.textContent = display
}
