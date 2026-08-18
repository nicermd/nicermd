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

  // Desktop (2026-08-04 round): the nav row made this control
  // redundant in Read/Live, and Write's bar carries the ⌕ ⌘K — so on
  // those modes the control hides entirely (CSS, keyed off
  // data-active-mode). It survives only in Split/Code — the modes
  // whose users chose a keyboard posture — as ⌕ + ⌘K at full strip
  // ink: the SAME face as the rows' trailing button, because it's
  // the same action (mode signal comes from the document itself —
  // two panes / raw mono are unmistakable). All changes ride mode
  // switches, never hover. Web (2026-08-04 port): same hide rule in
  // 1/2/3, but Split/Code keep icon + caret — a shortcut label means
  // nothing to a finger, so the chip stays the touch-friendly face.
  const keyLabel = document.createElement('span')
  keyLabel.className = 'strip-control__key'
  keyLabel.textContent = IS_MAC ? '⌘K' : 'Ctrl+K'
  keyLabel.hidden = true
  control.appendChild(keyLabel)

  const update = (key: number): void => {
    const entry = key === 1 ? READ_ENTRY : getFlavour(key)
    const name = entry?.name ?? 'Read'
    // Bare key, no glyph (2026-08-04 verdict): Split/Code users are
    // keyboard people or will figure it out — the key alone is enough.
    const keyOnly =
      document.documentElement.dataset.shell === 'tauri' &&
      (key === 4 || key === 5)
    icon.innerHTML = svg(entry?.paths ?? READ_ENTRY.paths)
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
