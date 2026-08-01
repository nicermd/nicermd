// Top-centre menu pill — the big, findable mouse target for the
// unified panel (2026-08-01, P2 "search-field" style from the pill
// round). A milky-glass capsule centred under the strip:
//
//   ⌕  Commands                                   [⌘K]
//
// Content is STATIC — the word, the glyph and the key chip are all
// always visible, sized for the longest platform label (Ctrl+K), so
// nothing ever swaps or shifts under the pointer.
//
// It rides the pointer-reveal flag like all chrome, and is hidden in
// Write mode entirely — the tool row's Menu button covers the job
// there and two menu affordances on screen would compete.

import { openPalette } from './command-palette'
import { IS_MAC } from './platform'

export function setupMenuPill(root: HTMLElement): void {
  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'menu-pill'
  pill.setAttribute('aria-label', 'Commands and modes')
  pill.title = 'Modes, commands and search'
  pill.innerHTML =
    '<span class="menu-pill__glyph">⌕</span>' +
    '<span class="menu-pill__label">Commands</span>' +
    `<span class="menu-pill__kbd">${IS_MAC ? '⌘K' : 'Ctrl+K'}</span>`
  pill.addEventListener('click', () => {
    openPalette()
  })
  root.appendChild(pill)
}
