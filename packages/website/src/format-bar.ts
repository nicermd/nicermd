// Format / command pill at the bottom-middle of the window. Always
// visible at low opacity. In modes 1/3/4 the resting "⌘K" label is the
// click target — opens the command palette. In mode 2 (WYSIWYG) it
// expands to a format toolbar on mouse proximity to the bottom edge,
// with a trailing "⌘K" button at the end so the palette stays one
// click away even when formatting controls are showing.
//
// Hide-on-scroll piggybacks on the same `data-strip-hidden` flag the
// title strip uses (see scroll-strip.ts) — scrolling down slides the
// pill out, scrolling up brings it back, mode change resurfaces it.
//
// On first load the pill flashes at full opacity (BOOT_VISIBLE_MS) so
// users notice the affordance before it settles to its quiet resting
// state.
//
// Icons are Lucide originals (MIT) inlined as SVG paths. Same approach
// as mode-icons.ts — avoids pulling the whole lucide package for a
// handful of glyphs.

import type { Harness } from './main'
import type { FormatAction } from './wysiwyg-engine'
import { openPalette } from './command-palette'

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
const BOOT_VISIBLE_MS = 2000

// macOS uses the ⌘ glyph; Windows / Linux read more naturally as
// "Ctrl+K". userAgentData.platform is the modern surface but isn't
// universally populated (notably absent in older webviews and Tauri's
// macOS WKWebView in some cases), so fall back to navigator.platform
// — deprecated but still reliable for OS detection.
const isMac =
  typeof navigator !== 'undefined' &&
  /(Mac|iPad|iPhone)/i.test(
    (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
      navigator.platform ??
      '',
  )
const CMD_K_LABEL = isMac ? '⌘K' : 'Ctrl+K'
const CMD_K_TITLE = isMac ? 'Command palette — ⌘K' : 'Command palette — Ctrl+K'

export function setupFormatBar(harness: Harness, root: HTMLElement): void {
  const bar = document.createElement('div')
  bar.className = 'format-bar format-bar--boot'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Commands and formatting')
  root.appendChild(bar)

  // Resting label. In modes 1/3/4 it's just the cmdp glyph — clicking
  // opens the palette. In mode 2 it's a hybrid: a styled "B I" hints
  // at the format toolbar that proximity reveals, then a separator and
  // the cmdp glyph hint at the trailing palette button. Content is set
  // by setRestingLabel below, called whenever the active mode changes.
  const dots = document.createElement('span')
  dots.className = 'format-bar__dots'
  bar.appendChild(dots)

  const setRestingLabel = (key: number): void => {
    if (key === 2) {
      dots.innerHTML =
        '<b class="format-bar__hint-b">B</b>' +
        '<i class="format-bar__hint-i">I</i>' +
        '<span class="format-bar__hint-sep">·</span>' +
        '<span class="format-bar__hint-cmdp"></span>'
      const cmdp = dots.querySelector('.format-bar__hint-cmdp')
      if (cmdp) cmdp.textContent = CMD_K_LABEL
    } else {
      dots.textContent = CMD_K_LABEL
    }
  }

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

  // Trailing palette button — visible only when the format toolbar is
  // expanded (mode 2 + proximity). Gives mouse users a "⌘K" target
  // without having to leave the bottom strip first.
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'format-bar__more'
  more.setAttribute('aria-label', 'Command palette')
  more.title = CMD_K_TITLE
  more.textContent = CMD_K_LABEL
  more.addEventListener('mousedown', (e) => e.preventDefault())
  more.addEventListener('click', () => {
    openPalette()
  })
  buttonsWrap.appendChild(more)

  // Pill click in modes 1/3/4 opens the palette. In mode 2 the bar is
  // expanded into format buttons via proximity, so clicks fall through
  // to per-button handlers (and the trailing ⌘K button handles cmdp).
  bar.addEventListener('click', (e) => {
    if (harness.getCurrentMode().key === 2) return
    // Only the bar background or its resting label opens cmdp — don't
    // double-trigger when the user clicked a child control.
    if (e.target !== bar && e.target !== dots) return
    openPalette()
  })

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
    setRestingLabel(key)
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
  // expands the toolbar in mode 2. In other modes the format buttons
  // are meaningless, so the listener bails out and ensures the bar
  // stays in its resting (collapsed, ⌘K) state.
  let isOpen = false
  window.addEventListener('mousemove', (e) => {
    if (harness.getCurrentMode().key !== 2) {
      if (isOpen) {
        isOpen = false
        bar.classList.remove('format-bar--open')
      }
      return
    }
    const open = window.innerHeight - e.clientY <= PROXIMITY_PX
    if (open === isOpen) return
    isOpen = open
    bar.classList.toggle('format-bar--open', open)
  })

  // Boot-time attention. Drop the highlight class after a short window
  // so the pill fades to its resting opacity. Long enough to register
  // peripherally, short enough not to nag.
  setTimeout(() => bar.classList.remove('format-bar--boot'), BOOT_VISIBLE_MS)
}
