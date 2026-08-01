// Menu / command pill at the bottom-middle of the window. Always
// visible at low opacity; clicking it opens the command palette.
// Resting label is the pill's PURPOSE ("Menu"); the ⌘K shortcut shows
// on hover and flashes on (re)appearance, mirroring the mode pill's
// grammar (rest = what it is, hover/flash = how to key it).
//
// The Write-mode format buttons used to expand out of this pill on
// bottom-edge proximity; they moved to the top toolbar
// (top-toolbar.ts) in the 2026-08-01 round, so this is now a plain
// Menu pill in every mode.
//
// Hide-on-scroll piggybacks on the same `data-strip-hidden` flag the
// title strip uses (see scroll-strip.ts) — scrolling down slides the
// pill out, scrolling up brings it back, mode change resurfaces it.

import type { Harness } from './main'
import { openPalette } from './command-palette'
import { IS_MAC } from './platform'

// macOS uses the ⌘ glyph; Windows / Linux read more naturally as
// "Ctrl+K". Detection lives in platform.ts so the same query-param
// override (`?platform=win`) flips every label site-wide.
const CMD_K_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K'

export function setupFormatBar(harness: Harness, root: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'format-bar'
  bar.setAttribute('role', 'button')
  bar.setAttribute('aria-label', 'Command palette')
  root.appendChild(bar)

  const dots = document.createElement('span')
  dots.className = 'format-bar__dots'
  bar.appendChild(dots)

  let hovered = false
  let showingShortcut = false
  let lingerTimer: number | null = null

  const renderDots = (): void => {
    dots.textContent = showingShortcut ? CMD_K_LABEL : 'Menu'
  }
  const showShortcut = (): void => {
    if (showingShortcut) return
    showingShortcut = true
    renderDots()
  }
  const showRest = (): void => {
    if (!showingShortcut || hovered) return
    showingShortcut = false
    renderDots()
  }
  // Flash the shortcut on (re)appearance, then settle back to "Menu"
  // after the same ~2s linger the mode pill uses — the two pills flash
  // their shortcuts together when the chrome returns.
  const flashShortcut = (): void => {
    showShortcut()
    if (lingerTimer !== null) window.clearTimeout(lingerTimer)
    lingerTimer = window.setTimeout(() => {
      lingerTimer = null
      showRest()
    }, 2000)
  }
  renderDots()

  bar.addEventListener('click', () => {
    openPalette()
  })

  // The active-mode attribute drives per-mode chrome CSS (top toolbar
  // visibility, content clearance) — kept here so it updates even if
  // no other chrome module is listening.
  const applyMode = (key: number): void => {
    document.documentElement.dataset.activeMode = String(key)
  }
  applyMode(harness.getCurrentMode().key)
  harness.onModeChange((key) => applyMode(key))

  // Hover reveals the shortcut (rest = purpose, hover = key) — same
  // grammar as the mode pill.
  bar.addEventListener('mouseenter', () => {
    hovered = true
    showShortcut()
  })
  bar.addEventListener('mouseleave', () => {
    hovered = false
    showRest()
  })

  // Re-flash the shortcut whenever the chrome returns from
  // hide-on-scroll — synced with the mode pill via the same
  // data-strip-hidden attribute.
  const stripObserver = new MutationObserver(() => {
    if (document.documentElement.dataset.stripHidden !== '1') flashShortcut()
  })
  stripObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-strip-hidden'],
  })
  flashShortcut()
}
