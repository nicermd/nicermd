// Mode pill for the title strip — single-icon design (2026-07-31,
// evolved from the segmented A/B round; the pill won and collapsed
// to one control). Top-right of the window:
//
//   [ <current-mode icon> ]
//
// The pill shows the icon of the mode you're IN; clicking it opens
// the mode picker (Read / Live / Write / Split / Code — see
// edit-mode.ts). It hides on scroll-down and returns on scroll-up
// exactly like the bottom ⌘K pill, via the same data-strip-hidden
// flag. Keyboard: Cmd+1..5 direct jumps, Cmd+Return Read↔edit
// toggle, Cmd+Alt+E opens this same picker.
//
// Icons are Lucide originals (MIT) inlined as SVG paths — same
// approach as format-bar.ts; avoids pulling the whole lucide package.

import type { Harness } from './main'
import { getContentKind } from './doc-source'
import { getFlavour, openEditPicker, READ_ENTRY } from './edit-mode'
import { IS_MAC } from './platform'

function svg(paths: string): string {
  return (
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${paths}</svg>`
  )
}

export function setupModeIcons(harness: Harness, root: HTMLElement): void {
  const wrap = document.createElement('div')
  wrap.className = 'mode-icons'
  root.appendChild(wrap)

  // Transient shortcut hint — flashes beside the pill when the strip
  // (re)appears, on the same cadence as the ⌘K pill's settle pulse
  // (see main.css: both animations restart when data-strip-hidden
  // flips off). Teaches the picker shortcut without permanent chrome.
  const hint = document.createElement('span')
  hint.className = 'mode-pill-hint'
  hint.setAttribute('aria-hidden', 'true')
  hint.textContent = IS_MAC ? '⌘⌥E' : 'Ctrl+Alt+E'
  wrap.appendChild(hint)

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'mode-icon mode-icon--pill-toggle'
  pill.setAttribute('aria-haspopup', 'listbox')
  pill.addEventListener('click', () => openEditPicker(harness))
  wrap.appendChild(pill)

  const update = (key: number): void => {
    const entry = key === 1 ? READ_ENTRY : getFlavour(key)
    pill.innerHTML = svg(entry ? entry.paths : READ_ENTRY.paths)
    const name = entry?.name ?? 'Read'
    pill.setAttribute('aria-label', `Mode: ${name} — choose mode`)
    pill.title = `${name} — click or Cmd+Alt+E to change mode`
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
