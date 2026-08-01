// Read-primary edit architecture.
//
// Read is THE resting state; editing is something you enter. The modes
// 2..4 (Write / Split / Code) become "edit flavours" behind a single
// Edit action:
//
//   • Cmd+Return from Read enters the REMEMBERED flavour — the one
//     you last edited in. First-ever use (nothing remembered yet)
//     opens the unified ⌘K panel instead, and your choice is
//     remembered from then on.
//   • Cmd+Return from any edit flavour returns to Read. Symmetric
//     enter/exit on one key.
//   • Mode CHOOSING lives in the unified command panel (⌘K / the
//     strip control) — command-palette.ts renders the mode section
//     from the EDIT_FLAVOURS / READ_ENTRY data below and applies the
//     same round-trip preselection.
//   • Cmd+1..5 direct jumps stay untouched as the power layer.
//
// The preference is GLOBAL (plain localStorage key, not per-window
// label like per-window-state's mode slot) — "which editor do I like"
// is a user preference, not a window state. It updates on every entry
// into an edit flavour regardless of path (picker, Cmd+2..4, palette,
// cycle), so "last used" is literally that.
//
// Non-markdown docs: Write and Split are markdown-only (see
// harness.switchTo), so Edit routes straight to Code and the picker
// shows only Code with a discreet note — the boundary is surfaced,
// not silently failed.

import type { Harness } from './main'
import { getContentKind } from './doc-source'

const FLAVOUR_KEY = 'nicermd:edit-flavour'

export interface EditFlavour {
  key: number
  name: string
  hint: string
  shortcut: string
  // Lucide icon paths, same inlining convention as mode-icons.ts.
  paths: string
  markdownOnly: boolean
}

// Ordered (and numbered) by closeness to Read — rendered-ness
// descending, each step reveals more raw source. This is also the
// expected popularity order: live-preview editing dominates in
// comparable tools (Obsidian, Typora), raw source is the power tail.
export const EDIT_FLAVOURS: EditFlavour[] = [
  {
    key: 2,
    name: 'Live',
    hint: 'Rendered, reveals source at cursor',
    shortcut: 'Cmd+2',
    paths:
      '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/>' +
      '<path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    markdownOnly: true,
  },
  {
    key: 3,
    name: 'Write',
    hint: 'Rich text, markers hidden',
    shortcut: 'Cmd+3',
    paths:
      '<path d="M12 20h9"/>' +
      '<path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    markdownOnly: true,
  },
  {
    key: 4,
    name: 'Split',
    hint: 'Source beside live preview',
    shortcut: 'Cmd+4',
    paths:
      '<rect width="18" height="18" x="3" y="3" rx="2"/>' +
      '<path d="M12 3v18"/>',
    markdownOnly: true,
  },
  {
    key: 5,
    name: 'Code',
    hint: 'Raw source, bytes preserved',
    shortcut: 'Cmd+5',
    paths:
      '<polyline points="16 18 22 12 16 6"/>' +
      '<polyline points="8 6 2 12 8 18"/>',
    markdownOnly: false,
  },
]

// Read as a picker row — the mode picker (single-pill design) lists
// every mode, not just edit flavours. Kept outside EDIT_FLAVOURS so
// the edit-toggle logic (enterEdit / remembered preference) still
// operates on edit flavours only.
export const READ_ENTRY: EditFlavour = {
  key: 1,
  name: 'Read',
  hint: 'Just the document',
  shortcut: 'Cmd+1',
  paths:
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
    '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  markdownOnly: false,
}

export function isEditMode(key: number): boolean {
  return EDIT_FLAVOURS.some((f) => f.key === key)
}

export function getFlavour(key: number): EditFlavour | null {
  return EDIT_FLAVOURS.find((f) => f.key === key) ?? null
}

// --- Preference -----------------------------------------------------------

export function readEditFlavour(): number | null {
  try {
    const raw = localStorage.getItem(FLAVOUR_KEY)
    if (!raw) return null
    const n = parseInt(raw, 10)
    return isEditMode(n) ? n : null
  } catch {
    return null
  }
}

export function rememberEditFlavour(key: number): void {
  if (!isEditMode(key)) return
  try {
    localStorage.setItem(FLAVOUR_KEY, String(key))
  } catch {
    // localStorage unavailable — silent, preference just won't stick.
  }
}

// --- Actions --------------------------------------------------------------

// Enter editing from wherever we are. Remembered flavour wins; first
// use opens the unified panel so the user picks (and the choice is
// remembered from then on). Non-markdown docs skip both and go
// straight to Code — the only flavour that can hold them.
export function enterEdit(harness: Harness): void {
  if (getContentKind().kind !== 'markdown') {
    harness.switchTo(5)
    return
  }
  const remembered = readEditFlavour()
  if (remembered !== null) {
    harness.switchTo(remembered)
    return
  }
  // Dynamic import: a static edge would drag command-palette's whole
  // import chain (main.ts, nicermd-core) into anything that imports
  // this module — including the unit tests, where DOMPurify can't
  // initialise. The chunk is already loaded in any real session.
  queueMicrotask(() => {
    void import('./command-palette').then((m) => m.openPalette())
  })
}

// One-key toggle: Read → enter edit; any edit flavour → Read.
export function toggleEdit(harness: Harness): void {
  if (isEditMode(harness.getCurrentMode().key)) {
    harness.switchTo(1)
    return
  }
  enterEdit(harness)
}

// Records "last used flavour" on every entry into an edit mode, no
// matter which affordance triggered the switch. Call once at boot.
export function setupEditMode(harness: Harness): void {
  harness.onModeChange((key) => {
    if (isEditMode(key)) rememberEditFlavour(key)
  })
}

// (The standalone mode picker lived here until 2026-08-01 — it merged
// into the unified command panel; command-palette.ts owns all mode-
// choosing UI now, built from the data exported above.)
