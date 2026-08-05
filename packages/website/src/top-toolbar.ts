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
// The trailing "Commands ⌘K" button keeps the palette one click away
// at the top. It is one static composed piece — word for the mouse
// user, key in quieter ink for the learner — and never mutates
// (2026-08-03: the old Menu↔⌘K hover swap was rejected; "Commands" is
// the vocabulary every other surface uses).
//
// 2026-08-03 nav-row round: Read (1) and Live (2) get their own
// second tier on desktop — the same 32px band, holding Read's
// vocabulary instead of Write's: modes (current accented) · Open ·
// Theme · Commands ⌘K. Two-stage quiet: the revealed row is ghost-
// faint, pointer over the row firms every label, the hovered button
// gets full presence — material never changes, only the ink.
// Split (4) and Code (5) deliberately get no row: choosing them
// declares keyboard comfort, so they get a ⌘K whisper in the strip
// instead (see mode-icons.ts).

import type { Harness } from './main'
import type { FormatAction } from './wysiwyg-engine'
import { openPalette } from './command-palette'
import { EDIT_FLAVOURS, READ_ENTRY } from './edit-mode'
import { getContentKind, openFile } from './doc-source'
import { openThemePicker } from './theme-picker'
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

function svg(paths: string, size: number): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${paths}</svg>`
  )
}

// Lucide "search" — the palette is a search box, so the trailing
// glyph says what it does (Spotlight idiom; the web pill already
// used ⌕). Burger and ⋯ both read "menu stuff" and felt off in
// dogfood (2026-08-04). The quiet key beside it keeps teaching.
const SEARCH_PATHS =
  '<circle cx="11" cy="11" r="8"/>' + '<path d="m21 21-4.3-4.3"/>'

// Lucide "folder" / "palette" — the nav row's grammar is
// icon + word on every button, matching the mode buttons.
const FOLDER_PATHS =
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1' +
  '-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
const PALETTE_PATHS =
  '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>' +
  '<circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>' +
  '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>' +
  '<circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>' +
  '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 ' +
  '1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 ' +
  '1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 ' +
  '6.012 17.461 2 12 2z"/>'

// Static composed trailing button, shared by both bars.
function makeCommandsButton(): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'top-toolbar__menu'
  btn.setAttribute('aria-label', 'Command palette')
  btn.title = CMD_K_TITLE
  btn.innerHTML =
    svg(SEARCH_PATHS, 13) +
    `<span class="top-toolbar__menu-key">${CMD_K_LABEL}</span>`
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  btn.addEventListener('click', () => {
    openPalette()
  })
  return btn
}

// Nav row — Read/Live's answer to reach. Mode buttons render from the
// same EDIT_FLAVOURS data as the panel and right-click menu.
function setupNavToolbar(harness: Harness, root: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'top-toolbar top-toolbar--nav'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Navigation')
  root.appendChild(bar)

  const group = document.createElement('div')
  group.className = 'top-toolbar__group'
  bar.appendChild(group)

  const modeButtons: { key: number; markdownOnly: boolean; el: HTMLButtonElement }[] = []
  for (const f of [READ_ENTRY, ...EDIT_FLAVOURS]) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'top-toolbar__tb'
    btn.title = `${f.name} — ${IS_MAC ? f.shortcut : f.shortcut.replace(/\bCmd\b/g, 'Ctrl')}`
    btn.innerHTML = svg(f.paths, 13) + `<span>${f.name}</span>`
    btn.addEventListener('click', () => {
      harness.switchTo(f.key)
    })
    group.appendChild(btn)
    modeButtons.push({ key: f.key, markdownOnly: Boolean(f.markdownOnly), el: btn })
  }

  const sep = document.createElement('span')
  sep.className = 'top-toolbar__sep'
  group.appendChild(sep)

  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = 'top-toolbar__tb'
  openBtn.title = IS_MAC ? 'Open file — ⌘O' : 'Open file — Ctrl+O'
  openBtn.innerHTML = svg(FOLDER_PATHS, 13) + '<span>Open</span>'
  openBtn.addEventListener('click', () => void openFile(harness))
  group.appendChild(openBtn)

  const themeBtn = document.createElement('button')
  themeBtn.type = 'button'
  themeBtn.className = 'top-toolbar__tb'
  themeBtn.title = IS_MAC ? 'Theme — ⌘⌥T' : 'Theme — Ctrl+Alt+T'
  themeBtn.innerHTML = svg(PALETTE_PATHS, 13) + '<span>Theme</span>'
  themeBtn.addEventListener('click', () => openThemePicker())
  group.appendChild(themeBtn)

  group.appendChild(makeCommandsButton())

  const refresh = (): void => {
    const current = harness.getCurrentMode().key
    const isMarkdown = getContentKind().kind === 'markdown'
    for (const b of modeButtons) {
      b.el.classList.toggle('top-toolbar__tb--current', b.key === current)
      b.el.hidden = b.markdownOnly && !isMarkdown
    }
  }
  refresh()
  harness.onModeChange(refresh)
  document.addEventListener('nicermd:source-changed', refresh)
}

export function setupTopToolbar(harness: Harness, root: HTMLElement): void {
  setupNavToolbar(harness, root)

  const bar = document.createElement('div')
  bar.className = 'top-toolbar top-toolbar--fmt'
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
    btn.innerHTML = svg(def.paths, 16)
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

  group.appendChild(makeCommandsButton())

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
