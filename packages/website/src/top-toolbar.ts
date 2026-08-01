// Write-mode top toolbar. The WYSIWYG format buttons live in a
// persistent theme-tinted bar across the top of the window, where
// edit-mode users expect them. The bar's surface doubles as the
// "theme-inspired top bar": a soft sheen mixed from the active
// theme's accent, so it re-colours with every theme switch. (Won the
// 2026-08-01 A/B round over a flat tint and the shipped bottom
// proximity pill.)
//
// Scoped to mode 3 (Write) only: Live/Split/Code are raw-markdown
// surfaces where format toggles don't apply, and Read has nothing to
// format. Visibility is CSS-driven off [data-active-mode="3"] on
// <html>; hide-on-scroll piggybacks on the same data-strip-hidden
// flag as the rest of the chrome.
//
// The trailing "Menu" button keeps the palette one click away at the
// top and follows the chrome grammar: rest = what it is ("Menu"),
// hover/flash = how to key it (⌘K). Both labels render stacked in
// one grid cell with the inactive one invisible, so the button —
// and therefore the whole bar — never changes width on hover.

import type { Harness } from './main'
import type { FormatAction } from './wysiwyg-engine'
import { openPalette } from './command-palette'
import { IS_MAC } from './platform'

interface FormatButtonDef {
  action: FormatAction
  label: string
  shortcut?: string
  paths: string
}

// 24×24 viewBox, stroke="currentColor", stroke-width=2, line-cap/join=round.
// Icons are Lucide originals (MIT) inlined as SVG paths — avoids
// pulling the whole lucide package for a handful of glyphs.
const FORMAT_BUTTONS: FormatButtonDef[] = [
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

const CMD_K_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K'
const CMD_K_TITLE = IS_MAC ? 'Command palette — ⌘K' : 'Command palette — Ctrl+K'
const HINT_LINGER_MS = 2000

export function setupTopToolbar(harness: Harness, root: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'top-toolbar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Formatting')
  root.appendChild(bar)

  const group = document.createElement('div')
  group.className = 'top-toolbar__group'
  bar.appendChild(group)

  const buttonsByAction = new Map<FormatAction, HTMLButtonElement>()

  for (const def of FORMAT_BUTTONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'top-toolbar__button'
    btn.setAttribute('aria-label', def.label)
    btn.title = def.shortcut ? `${def.label} — ${def.shortcut}` : def.label
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      `stroke-linejoin="round">${def.paths}</svg>`
    // Prevent the toolbar from stealing focus from the editor — the
    // toggle has to fire while the editor still owns the selection.
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => {
      harness.toggleFormat(def.action)
    })
    group.appendChild(btn)
    buttonsByAction.set(def.action, btn)
  }

  const sep = document.createElement('span')
  sep.className = 'top-toolbar__sep'
  group.appendChild(sep)

  const menu = document.createElement('button')
  menu.type = 'button'
  menu.className = 'top-toolbar__menu'
  menu.setAttribute('aria-label', 'Command palette')
  menu.title = CMD_K_TITLE
  // Both labels occupy the same grid cell; CSS keeps the inactive one
  // invisible-but-sized so the button width never changes on swap.
  menu.innerHTML =
    '<span class="top-toolbar__menu-label top-toolbar__menu-label--rest">Menu</span>' +
    `<span class="top-toolbar__menu-label top-toolbar__menu-label--key">${CMD_K_LABEL}</span>`
  menu.addEventListener('mousedown', (e) => e.preventDefault())
  menu.addEventListener('click', () => {
    openPalette()
  })
  group.appendChild(menu)

  // Temporary dogfood toggle for the graphite-vs-glass finish round —
  // a visible flick is friendlier than URL flags, especially in the
  // desktop shell. Removed once a winner is picked.
  const finishBtn = document.createElement('button')
  finishBtn.type = 'button'
  finishBtn.className = 'top-toolbar__button top-toolbar__finish'
  finishBtn.setAttribute('aria-label', 'Toggle chrome finish')
  finishBtn.title = 'Chrome finish — graphite / glass'
  finishBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>' +
    '<path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>'
  finishBtn.addEventListener('mousedown', (e) => e.preventDefault())
  finishBtn.addEventListener('click', () => {
    void import('./chrome-finish').then((m) => m.toggleFinish())
  })
  group.appendChild(finishBtn)

  // Menu label swap — rest = "Menu", hover/flash = "⌘K". Mirrors the
  // two pills so the whole chrome speaks one grammar.
  let hovered = false
  let showingShortcut = false
  let lingerTimer: number | null = null
  const showShortcut = (): void => {
    showingShortcut = true
    menu.classList.add('top-toolbar__menu--key')
  }
  const showRest = (): void => {
    if (hovered) return
    showingShortcut = false
    menu.classList.remove('top-toolbar__menu--key')
  }
  const flashShortcut = (): void => {
    showShortcut()
    if (lingerTimer !== null) window.clearTimeout(lingerTimer)
    lingerTimer = window.setTimeout(() => {
      lingerTimer = null
      showRest()
    }, HINT_LINGER_MS)
  }
  menu.addEventListener('mouseenter', () => {
    hovered = true
    showShortcut()
  })
  menu.addEventListener('mouseleave', () => {
    hovered = false
    if (lingerTimer === null && showingShortcut) showRest()
  })
  const stripObserver = new MutationObserver(() => {
    if (document.documentElement.dataset.stripHidden !== '1') flashShortcut()
  })
  stripObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-strip-hidden'],
  })
  flashShortcut()

  const refreshActiveStates = (): void => {
    for (const [action, btn] of buttonsByAction) {
      btn.classList.toggle(
        'top-toolbar__button--active',
        harness.isFormatActive(action),
      )
    }
  }

  // The wysiwyg handle is destroyed on mode-out and recreated on
  // mode-in, so the format-update subscription has to follow.
  let detach: (() => void) | null = null
  const applyMode = (key: number): void => {
    if (key === 3) {
      detach?.()
      detach = harness.onFormatUpdate(refreshActiveStates)
      refreshActiveStates()
    } else {
      detach?.()
      detach = null
    }
  }
  applyMode(harness.getCurrentMode().key)
  harness.onModeChange((key) => applyMode(key))
}
