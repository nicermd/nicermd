// Format bar for mode 2 (WYSIWYG). Sits at the bottom-middle of the
// window as a tiny "•••" pill at rest; expands to a full toolbar when
// the mouse moves into the bottom proximity zone. Mode-gated via
// `data-active-mode` on <html> so it only shows when the editor is
// actually mounted.
//
// Click on a button → harness.toggleFormat(action). Active state on
// each button is driven by harness.onFormatUpdate, which the WYSIWYG
// engine fires on selection / content updates.
//
// Icons are Lucide originals (MIT) inlined as SVG paths. Same approach
// as mode-icons.ts — avoids pulling the whole lucide package for a
// handful of glyphs.

import type { Harness } from './main'
import type { FormatAction } from './wysiwyg-engine'

interface FormatButtonDef {
  action: FormatAction
  label: string
  shortcut?: string
  paths: string
}

// 24×24 viewBox, stroke="currentColor", stroke-width=2, line-cap/join=round.
const BUTTONS: FormatButtonDef[] = [
  {
    action: 'bold',
    label: 'Bold',
    shortcut: 'Cmd+B',
    paths:
      '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1z"/>' +
      '<path d="M6 4h7a4 4 0 0 1 0 8H6z"/>',
  },
  {
    action: 'italic',
    label: 'Italic',
    shortcut: 'Cmd+I',
    paths:
      '<line x1="19" x2="10" y1="4" y2="4"/>' +
      '<line x1="14" x2="5" y1="20" y2="20"/>' +
      '<line x1="15" x2="9" y1="4" y2="20"/>',
  },
  {
    action: 'strike',
    label: 'Strikethrough',
    paths:
      '<path d="M16 4H9a3 3 0 0 0-2.83 4"/>' +
      '<path d="M14 12a4 4 0 0 1 0 8H6"/>' +
      '<line x1="4" x2="20" y1="12" y2="12"/>',
  },
  {
    action: 'h1',
    label: 'Heading 1',
    paths:
      '<path d="M4 12h8"/>' +
      '<path d="M4 18V6"/>' +
      '<path d="M12 18V6"/>' +
      '<path d="m17 12 3-2v8"/>',
  },
  {
    action: 'h2',
    label: 'Heading 2',
    paths:
      '<path d="M4 12h8"/>' +
      '<path d="M4 18V6"/>' +
      '<path d="M12 18V6"/>' +
      '<path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  },
  {
    action: 'bulletList',
    label: 'Bullet list',
    paths:
      '<line x1="8" x2="21" y1="6" y2="6"/>' +
      '<line x1="8" x2="21" y1="12" y2="12"/>' +
      '<line x1="8" x2="21" y1="18" y2="18"/>' +
      '<line x1="3" x2="3.01" y1="6" y2="6"/>' +
      '<line x1="3" x2="3.01" y1="12" y2="12"/>' +
      '<line x1="3" x2="3.01" y1="18" y2="18"/>',
  },
  {
    action: 'orderedList',
    label: 'Numbered list',
    paths:
      '<line x1="10" x2="21" y1="6" y2="6"/>' +
      '<line x1="10" x2="21" y1="12" y2="12"/>' +
      '<line x1="10" x2="21" y1="18" y2="18"/>' +
      '<path d="M4 6h1v4"/>' +
      '<path d="M4 10h2"/>' +
      '<path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  },
  {
    action: 'blockquote',
    label: 'Quote',
    paths:
      '<path d="M16 3a2 2 0 0 0-2 2v6h6V5a2 2 0 0 0-2-2zM4 3a2 2 0 0 0-2 2v6h6V5a2 2 0 0 0-2-2z"/>' +
      '<path d="M14 11v4a4 4 0 0 0 4 4"/>' +
      '<path d="M2 11v4a4 4 0 0 0 4 4"/>',
  },
  {
    action: 'code',
    label: 'Inline code',
    paths:
      '<path d="m18 16 4-4-4-4"/>' +
      '<path d="m6 8-4 4 4 4"/>' +
      '<path d="m14.5 4-5 16"/>',
  },
  {
    action: 'link',
    label: 'Link',
    paths:
      '<path d="M9 17H7A5 5 0 0 1 7 7h2"/>' +
      '<path d="M15 7h2a5 5 0 1 1 0 10h-2"/>' +
      '<line x1="8" x2="16" y1="12" y2="12"/>',
  },
]

const PROXIMITY_PX = 120

export function setupFormatBar(harness: Harness, root: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'format-bar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Formatting')
  root.appendChild(bar)

  // Three-dots placeholder shown at rest. Hidden when the toolbar is
  // expanded (CSS via .format-bar--open).
  const dots = document.createElement('span')
  dots.className = 'format-bar__dots'
  dots.textContent = '•••'
  bar.appendChild(dots)

  const buttonsWrap = document.createElement('div')
  buttonsWrap.className = 'format-bar__buttons'
  bar.appendChild(buttonsWrap)

  const buttonsByAction = new Map<FormatAction, HTMLButtonElement>()

  for (const def of BUTTONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'format-bar__button'
    btn.setAttribute('aria-label', def.label)
    btn.title = def.shortcut ? `${def.label} — ${def.shortcut}` : def.label
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      `stroke-linejoin="round">${def.paths}</svg>`
    btn.addEventListener('mousedown', (e) => {
      // Prevent the toolbar from stealing focus from the editor — the
      // toggle has to fire while the editor still owns the selection.
      e.preventDefault()
    })
    btn.addEventListener('click', () => {
      harness.toggleFormat(def.action)
    })
    buttonsWrap.appendChild(btn)
    buttonsByAction.set(def.action, btn)
  }

  const refreshActiveStates = (): void => {
    for (const [action, btn] of buttonsByAction) {
      btn.classList.toggle(
        'format-bar__button--active',
        harness.isFormatActive(action),
      )
    }
  }

  // Re-subscribe to format-update events on every mode change. The
  // wysiwyg handle is destroyed on mode-out and recreated on mode-in,
  // so the subscription has to follow.
  let detach: (() => void) | null = null
  const subscribe = (): void => {
    detach?.()
    detach = harness.onFormatUpdate(refreshActiveStates)
    refreshActiveStates()
  }

  const applyMode = (key: number): void => {
    document.documentElement.dataset.activeMode = String(key)
    if (key === 2) {
      subscribe()
    } else {
      detach?.()
      detach = null
    }
  }

  applyMode(harness.getCurrentMode().key)
  harness.onModeChange((key) => applyMode(key))

  // Proximity reveal: mouse within PROXIMITY_PX of the bottom edge
  // expands the toolbar. Outside the zone collapses it back to dots.
  // Mode-gated by CSS, so this listener fires harmlessly in modes 1/3/4.
  let isOpen = false
  window.addEventListener('mousemove', (e) => {
    const open = window.innerHeight - e.clientY <= PROXIMITY_PX
    if (open === isOpen) return
    isOpen = open
    bar.classList.toggle('format-bar--open', open)
  })
}
