// Mode switcher for the title strip — Read-primary shape. Top-right
// of the window; three controls instead of the old four flat tabs:
//
//   [Read]  [Edit]  [▾]
//
// Read is the resting state. Edit enters the remembered edit flavour
// (Write / Split / Code — picker on first-ever use); while editing,
// the Edit button shows the ACTIVE flavour's icon so you can see which
// editor you're in at a glance. The chevron opens the flavour picker.
// Cmd+1..4 direct jumps still exist as the power layer (see main.ts).
//
// Icons are Lucide originals (MIT) inlined as SVG paths — book-open
// for Read, pen-line for Edit at rest, and the flavour's own icon
// while active. Inlining avoids pulling the whole lucide package.

import type { Harness } from './main'
import { getContentKind } from './doc-source'
import { getFlavour, isEditMode, toggleEdit, openEditPicker } from './edit-mode'

const READ_PATHS =
  '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
  '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'

// pen-line — the Edit button's resting icon (no flavour active).
const EDIT_PATHS =
  '<path d="M12 20h9"/>' +
  '<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>'

const CHEVRON_PATHS = '<path d="m6 9 6 6 6-6"/>'

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
  wrap.setAttribute('role', 'tablist')
  root.appendChild(wrap)

  const readBtn = document.createElement('button')
  readBtn.type = 'button'
  readBtn.className = 'mode-icon'
  readBtn.setAttribute('role', 'tab')
  readBtn.setAttribute('aria-label', 'Read')
  readBtn.title = 'Read — Cmd+1'
  readBtn.innerHTML = svg(READ_PATHS)
  readBtn.addEventListener('click', () => harness.switchTo(1))
  wrap.appendChild(readBtn)

  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'mode-icon'
  editBtn.setAttribute('role', 'tab')
  editBtn.setAttribute('aria-label', 'Edit')
  editBtn.innerHTML = svg(EDIT_PATHS)
  editBtn.addEventListener('click', () => {
    // From Read: enter the remembered flavour. While editing: clicking
    // Edit again is a no-op (you're already editing) rather than an
    // exit — exit lives on the Read button and Cmd+Return, so a stray
    // second click can't bounce you out of your editor.
    if (!isEditMode(harness.getCurrentMode().key)) toggleEdit(harness)
  })
  wrap.appendChild(editBtn)

  const pickBtn = document.createElement('button')
  pickBtn.type = 'button'
  pickBtn.className = 'mode-icon mode-icon--chevron'
  pickBtn.setAttribute('aria-label', 'Choose edit mode')
  pickBtn.title = 'Choose edit mode — Cmd+Alt+E'
  pickBtn.innerHTML = svg(CHEVRON_PATHS)
  pickBtn.addEventListener('click', () => openEditPicker(harness))
  wrap.appendChild(pickBtn)

  const update = (key: number): void => {
    const editing = isEditMode(key)
    readBtn.classList.toggle('mode-icon--active', key === 1)
    readBtn.setAttribute('aria-selected', key === 1 ? 'true' : 'false')
    editBtn.classList.toggle('mode-icon--active', editing)
    editBtn.setAttribute('aria-selected', editing ? 'true' : 'false')
    // Reflect the active flavour on the Edit button; revert to the
    // pen at rest. Tooltip names the flavour so hover answers "which
    // editor am I in?" precisely.
    const flavour = editing ? getFlavour(key) : null
    editBtn.innerHTML = svg(flavour ? flavour.paths : EDIT_PATHS)
    editBtn.title = flavour
      ? `Editing: ${flavour.name} — Cmd+Return returns to Read`
      : 'Edit — Cmd+Return'
  }

  // Write (2), Split (3) and Live (5) are markdown-only; harness.switchTo
  // enforces that and edit-mode routes non-markdown docs straight to
  // Code, so the buttons themselves stay visible for every content
  // kind. Only correction needed here: if a non-markdown doc loads
  // while a markdown-only mode is active, kick back to Read.
  const onSourceChanged = (): void => {
    const isMarkdown = getContentKind().kind === 'markdown'
    if (!isMarkdown) {
      const current = harness.getCurrentMode().key
      if (current === 2 || current === 3 || current === 5) harness.switchTo(1)
    }
  }

  update(harness.getCurrentMode().key)
  onSourceChanged()
  harness.onModeChange((key) => update(key))
  document.addEventListener('nicermd:source-changed', onSourceChanged)
}
