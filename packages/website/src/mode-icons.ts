// Strip control — the single mouse affordance for modes + commands
// (2026-08-01 unified-panel round; replaced the floating mode pill).
// A quiet control at the window strip's right end showing the
// current mode's icon and a caret; clicking opens the unified ⌘K
// panel (modes on top, commands beneath). On web — where there is no
// strip — the same control floats as a ghost chip in the top-right
// corner.
//
// It is strip furniture: it rides the strip's one show/hide
// transition via data-strip-hidden, with no independent animation and
// no hover label-swap — the tooltip carries the shortcut instead.
//
// Icons are Lucide originals (MIT) inlined as SVG paths — avoids
// pulling the whole lucide package for a handful of glyphs.

import type { Harness } from './main'
import { getContentKind } from './doc-source'
import { getFlavour, READ_ENTRY } from './edit-mode'
import { openPalette } from './command-palette'
import { IS_MAC } from './platform'

function svg(paths: string): string {
  return (
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${paths}</svg>`
  )
}

export function setupModeIcons(harness: Harness, root: HTMLElement): void {
  const wrap = document.createElement('div')
  wrap.className = 'mode-icons'
  root.appendChild(wrap)

  const control = document.createElement('button')
  control.type = 'button'
  control.className = 'strip-control'
  control.setAttribute('aria-haspopup', 'dialog')
  control.addEventListener('click', () => {
    openPalette()
  })
  wrap.appendChild(control)

  const icon = document.createElement('span')
  icon.className = 'strip-control__icon'
  control.appendChild(icon)

  const caret = document.createElement('span')
  caret.className = 'strip-control__caret'
  caret.textContent = '▾'
  control.appendChild(caret)

  // Split (4) / Code (5) on desktop: the key swaps in FOR the icons
  // (2026-08-03 refinement round). Choosing those modes declares
  // keyboard comfort — the control becomes the ⌘K reminder itself, at
  // full strip ink. The swap happens on mode change, never under the
  // mouse, so the no-geometry-shift rule holds. Read/Live/Write keep
  // icon + caret (their rows carry the burger + key).
  const keyLabel = document.createElement('span')
  keyLabel.className = 'strip-control__key'
  keyLabel.textContent = IS_MAC ? '⌘K' : 'Ctrl+K'
  keyLabel.hidden = true
  control.appendChild(keyLabel)

  const update = (key: number): void => {
    const entry = key === 1 ? READ_ENTRY : getFlavour(key)
    icon.innerHTML = svg(entry?.paths ?? READ_ENTRY.paths)
    const name = entry?.name ?? 'Read'
    const keyOnly =
      document.documentElement.dataset.shell === 'tauri' &&
      (key === 4 || key === 5)
    icon.hidden = keyOnly
    caret.hidden = keyOnly
    keyLabel.hidden = !keyOnly
    control.setAttribute('aria-label', `Mode: ${name} — modes and menu`)
    control.title = `${name} — modes and menu (${IS_MAC ? '⌘K' : 'Ctrl+K'})`
  }

  // Live (2), Write (3) and Split (4) are markdown-only; harness.switchTo
  // enforces that and edit-mode routes non-markdown docs straight to
  // Code. Correction handled here: if a non-markdown doc loads while a
  // markdown-only mode is active, kick back to Read.
  const onSourceChanged = (): void => {
    if (getContentKind().kind !== 'markdown') {
      const current = harness.getCurrentMode().key
      if (current === 2 || current === 3 || current === 4) harness.switchTo(1)
    }
  }

  update(harness.getCurrentMode().key)
  onSourceChanged()
  harness.onModeChange((key) => update(key))
  document.addEventListener('nicermd:source-changed', onSourceChanged)
}
