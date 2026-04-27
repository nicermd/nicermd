// Filename + dirty indicator. Two surfaces:
//
//   - In-window strip: a `<div class="window-title">` rendered into
//     the top 28px of the window in both web and Tauri shells. CSS
//     [data-tauri="1"] (set unconditionally in main.ts) gates display.
//   - `document.title` always updates so the browser tab reflects the
//     active doc and dirty state regardless of strip visibility.

import type { Harness } from './main'
import { isDirty, getCurrentName } from './doc-source'

const APP_NAME = 'Nicer.md'

let titleBarEl: HTMLElement | null = null
let harnessRef: Harness | null = null

export function setupTitle(harness: Harness, root: HTMLElement): void {
  harnessRef = harness

  titleBarEl = document.createElement('div')
  titleBarEl.className = 'window-title'
  root.appendChild(titleBarEl)

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
