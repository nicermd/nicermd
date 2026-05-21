// Right-click context menu for in-doc links (Tauri only).
//
// Default WKWebView behaviour on macOS treats "Open Link in New Window"
// as "open in Safari", which sends the user out of the app — fine for
// arbitrary links, frustrating for markdown URLs the reader could
// render. We intercept right-click on loader-eligible anchors and
// offer an "Open Link in New Window" entry that spawns another
// Nicer.md window pointed at the same URL.
//
// Scope: only intercepts when the right-click hits an anchor whose
// href is something `parseGithubUrl` accepts (raw/blob+.md/tree/repo/
// gist). Everything else falls through to the system context menu so
// users can still copy / save-link-as / open-in-browser as usual.

import { resolveLinkTarget } from './url-open'
import { openUrlInNewWindow } from './tauri-bridge'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let menuEl: HTMLDivElement | null = null

export function setupLinkContextMenu(): void {
  if (!isTauri()) return

  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof Element)) return
    const anchor = e.target.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const target = resolveLinkTarget(anchor)
    if (!target) return
    e.preventDefault()
    showMenu(e.clientX, e.clientY, target)
  })

  // Click anywhere else, scroll, resize, or Escape dismisses the menu.
  // Capture phase so the dismiss runs before any in-menu click handler
  // — except we also stop propagation inside the menu so the outside-
  // click listener still fires on the doc and dismisses cleanly.
  document.addEventListener('mousedown', (e) => {
    if (!menuEl) return
    if (e.target instanceof Node && menuEl.contains(e.target)) return
    dismissMenu()
  }, true)
  document.addEventListener('keydown', (e) => {
    if (menuEl && e.key === 'Escape') {
      e.preventDefault()
      dismissMenu()
    }
  })
  window.addEventListener('scroll', dismissMenu, { capture: true, passive: true })
  window.addEventListener('resize', dismissMenu)
}

function showMenu(x: number, y: number, href: string): void {
  dismissMenu()
  const el = document.createElement('div')
  el.className = 'link-context-menu'
  el.setAttribute('role', 'menu')
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'link-context-menu__item'
  btn.textContent = 'Open Link in New Window'
  btn.setAttribute('role', 'menuitem')
  btn.addEventListener('click', () => {
    void openUrlInNewWindow(href)
    dismissMenu()
  })
  el.appendChild(btn)
  // Position offscreen first so measurement doesn't flash a flicker.
  el.style.visibility = 'hidden'
  document.body.appendChild(el)
  const rect = el.getBoundingClientRect()
  const margin = 4
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.visibility = ''
  menuEl = el
  btn.focus()
}

function dismissMenu(): void {
  if (menuEl) {
    menuEl.remove()
    menuEl = null
  }
}
