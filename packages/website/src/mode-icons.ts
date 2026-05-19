// Mode-switcher icons for the title strip. Top-right of the window;
// 4 buttons, one per mode. Active mode in accent colour at full
// opacity; inactive muted at 50%. Click dispatches to harness.
//
// Icons are Lucide originals (MIT) inlined as SVG paths — book-open /
// pen-line / columns-2 / code. Inlining avoids pulling the whole
// lucide package for 4 icons (~1KB total here vs ~tens of KB for the
// package).

import type { Harness } from './main'
import { getContentKind } from './doc-source'

interface ModeIconDef {
  key: number
  name: string
  shortcut: string
  paths: string
}

// 24×24 viewBox, stroke="currentColor", stroke-width=2, line-cap/join=round.
// Paths copied from lucide.dev (MIT) and reduced to just the inner shapes.
const ICONS: ModeIconDef[] = [
  {
    key: 1,
    name: 'Read',
    shortcut: 'Cmd+1',
    paths:
      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
      '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  },
  {
    key: 2,
    name: 'Write',
    shortcut: 'Cmd+2',
    paths:
      '<path d="M12 20h9"/>' +
      '<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  },
  {
    key: 3,
    name: 'Split',
    shortcut: 'Cmd+3',
    paths:
      '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
      '<path d="M12 3v18"/>',
  },
  {
    key: 4,
    name: 'Code',
    shortcut: 'Cmd+4',
    paths:
      '<polyline points="16 18 22 12 16 6"/>' +
      '<polyline points="8 6 2 12 8 18"/>',
  },
]

export function setupModeIcons(harness: Harness, root: HTMLElement): void {
  const wrap = document.createElement('div')
  wrap.className = 'mode-icons'
  wrap.setAttribute('role', 'tablist')
  root.appendChild(wrap)

  const buttons: Map<number, HTMLButtonElement> = new Map()

  for (const def of ICONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mode-icon'
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-label', def.name)
    btn.title = `${def.name} — ${def.shortcut}`
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      `stroke-linejoin="round">${def.paths}</svg>`
    btn.addEventListener('click', () => harness.switchTo(def.key))
    wrap.appendChild(btn)
    buttons.set(def.key, btn)
  }

  const updateActive = (key: number): void => {
    for (const [k, btn] of buttons.entries()) {
      const active = k === key
      btn.classList.toggle('mode-icon--active', active)
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
    }
  }

  // Modes 2 (Write/Tiptap) and 3 (Split: editor + live preview) are
  // markdown-only. Write because Tiptap's markdown serialiser would
  // mangle non-markdown text on save. Split because the preview side
  // is the same hljs render as Read mode — for code, editor + preview
  // are essentially the same content twice, adding friction without
  // adding signal. Read + Code stay available for every kind. If the
  // user happens to be in a hidden mode when a non-markdown doc loads,
  // kick them back to Read.
  const updateVisibility = (): void => {
    const isMarkdown = getContentKind().kind === 'markdown'
    const writeBtn = buttons.get(2)
    const splitBtn = buttons.get(3)
    if (writeBtn) writeBtn.hidden = !isMarkdown
    if (splitBtn) splitBtn.hidden = !isMarkdown
    if (!isMarkdown) {
      const current = harness.getCurrentMode().key
      if (current === 2 || current === 3) harness.switchTo(1)
    }
  }

  updateActive(harness.getCurrentMode().key)
  updateVisibility()
  harness.onModeChange((key) => updateActive(key))
  document.addEventListener('nicermd:source-changed', updateVisibility)
}
