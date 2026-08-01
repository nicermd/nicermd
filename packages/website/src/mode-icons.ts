// Mode pill for the title strip — single-icon design (2026-07-31).
// Top-right of the window:
//
//   [ <current-mode icon> ]
//
// The pill shows the icon of the mode you're IN; clicking it opens
// the mode picker (Read / Live / Write / Split / Code — see
// edit-mode.ts). It hides on scroll-down and returns on scroll-up
// exactly like the bottom ⌘K pill, via the same data-strip-hidden
// flag.
//
// Shortcut teaching: the pill's CONTENT swaps to the shortcut text
// (⌘⌥E) on mouse-over, and briefly whenever the pill returns from
// hide-on-scroll; the icon comes back once the pointer leaves /
// after a short idle. Text metrics match the ⌘K pill's resting
// label (see .mode-icon--hint in main.css).
//
// Icons are Lucide originals (MIT) inlined as SVG paths — same
// approach as format-bar.ts; avoids pulling the whole lucide package.

import type { Harness } from './main'
import { getContentKind } from './doc-source'
import { getFlavour, openEditPicker, READ_ENTRY } from './edit-mode'
import { IS_MAC } from './platform'

const HINT_LABEL = IS_MAC ? '⌘E' : 'Ctrl+E'
// How long the hint lingers after the pill (re)appears before the
// icon returns. Mirrors the ⌘K settle pulse's ~2s presence.
const HINT_LINGER_MS = 2000

function svg(paths: string): string {
  return (
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${paths}</svg>`
  )
}

export function setupModeIcons(harness: Harness, root: HTMLElement): void {
  const wrap = document.createElement('div')
  wrap.className = 'mode-icons'
  root.appendChild(wrap)

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'mode-icon mode-icon--pill-toggle'
  pill.setAttribute('aria-haspopup', 'listbox')
  pill.addEventListener('click', () => openEditPicker(harness))
  wrap.appendChild(pill)

  // --- content state: icon vs shortcut hint -----------------------------
  let iconPaths = READ_ENTRY.paths
  let showingHint = false
  let hovered = false
  let lingerTimer: number | null = null

  const render = (): void => {
    if (showingHint) {
      pill.classList.add('mode-icon--hint')
      pill.textContent = HINT_LABEL
    } else {
      pill.classList.remove('mode-icon--hint')
      pill.innerHTML = svg(iconPaths)
    }
  }

  const showHint = (): void => {
    if (showingHint) return
    showingHint = true
    render()
  }
  const showIcon = (): void => {
    if (!showingHint || hovered) return
    showingHint = false
    render()
  }
  // Hint flash on (re)appearance: show the shortcut, then bring the
  // icon back after a short idle — unless the pointer is on the pill.
  const flashHint = (): void => {
    showHint()
    if (lingerTimer !== null) window.clearTimeout(lingerTimer)
    lingerTimer = window.setTimeout(() => {
      lingerTimer = null
      showIcon()
    }, HINT_LINGER_MS)
  }

  pill.addEventListener('mouseenter', () => {
    hovered = true
    showHint()
  })
  pill.addEventListener('mouseleave', () => {
    hovered = false
    showIcon()
  })

  // Re-flash whenever the strip returns from hide-on-scroll. The
  // chrome-visibility module flips data-strip-hidden on <html>; observe the
  // attribute rather than re-deriving scroll state here.
  const stripObserver = new MutationObserver(() => {
    if (document.documentElement.dataset.stripHidden !== '1') flashHint()
  })
  stripObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-strip-hidden'],
  })

  const update = (key: number): void => {
    const entry = key === 1 ? READ_ENTRY : getFlavour(key)
    iconPaths = entry?.paths ?? READ_ENTRY.paths
    const name = entry?.name ?? 'Read'
    pill.setAttribute('aria-label', `Mode: ${name} — choose mode`)
    pill.title = `${name} — click or ${IS_MAC ? 'Cmd+E' : 'Ctrl+E'} to change mode`
    render()
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

  // First-paint flash — same teaching moment as the ⌘K settle pulse.
  flashHint()
}
