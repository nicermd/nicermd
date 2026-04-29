// Faint bottom-right version badge. Always visible, low-emphasis —
// signals early-product status without competing with the content.
// Rendered in both web and Tauri shells; auto-hides in fullscreen
// alongside other chrome.

import { APP_VERSION } from './version'

export function setupVersionBadge(root: HTMLElement): void {
  const el = document.createElement('div')
  el.className = 'version-badge'
  el.textContent = APP_VERSION
  root.appendChild(el)
}
