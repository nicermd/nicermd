// Write-mode top toolbar — 2026-08-01 iteration round (?option=1|2).
//
// Moves the WYSIWYG format buttons from the bottom proximity pill to a
// persistent theme-tinted bar across the top of the window, where
// edit-mode users expect them. The bar's surface doubles as the
// "theme-inspired top bar": its tint is mixed from the active theme's
// accent, so it re-colours with every theme switch.
//
//   option=0  baseline — no top bar, bottom pill expands as shipped
//   option=1  flat accent tint
//   option=2  soft sheen — subtle vertical gradient + highlight line
//
// Scoped to mode 3 (Write) only: Live/Split/Code are raw-markdown
// surfaces where format toggles don't apply, and Read has nothing to
// format. Visibility is CSS-driven off [data-active-mode="3"] +
// [data-option] on <html>; hide-on-scroll piggybacks on the same
// data-strip-hidden flag as the rest of the chrome.
//
// The trailing "Menu" button keeps the palette one click away at the
// top (dogfooding Menu-at-top) and follows the chrome grammar: rest =
// what it is ("Menu"), hover/flash = how to key it (⌘K).

import type { Harness } from './main'
import type { FormatAction } from './wysiwyg-engine'
import { FORMAT_BUTTONS } from './format-bar'
import { openPalette } from './command-palette'
import { getOption } from './option-flag'
import { IS_MAC } from './platform'

const CMD_K_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K'
const CMD_K_TITLE = IS_MAC ? 'Command palette — ⌘K' : 'Command palette — Ctrl+K'
const HINT_LINGER_MS = 2000

export function setupTopToolbar(harness: Harness, root: HTMLElement): void {
  if (getOption() < 1) return

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
  menu.textContent = 'Menu'
  menu.addEventListener('mousedown', (e) => e.preventDefault())
  menu.addEventListener('click', () => {
    openPalette()
  })
  group.appendChild(menu)

  // Menu label swap — rest = "Menu", hover/flash = "⌘K". Mirrors the
  // two pills so the whole chrome speaks one grammar.
  let hovered = false
  let showingShortcut = false
  let lingerTimer: number | null = null
  const showShortcut = (): void => {
    showingShortcut = true
    menu.textContent = CMD_K_LABEL
  }
  const showRest = (): void => {
    if (hovered) return
    showingShortcut = false
    menu.textContent = 'Menu'
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
