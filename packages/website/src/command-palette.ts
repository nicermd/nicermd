// Unified command panel (2026-08-01 — the standalone mode picker
// merged in). Opens on Cmd+K / Cmd+/ / the strip control. Centred
// modal with an auto-focused input over two zones:
//
//   MODES     Read / Live / Write / Split / Code with descriptions —
//             the round-trip preselection preserved from the old
//             picker: from Read the remembered edit flavour opens
//             selected (Enter drops straight in); from any edit mode
//             Read is selected (Enter goes home). The current mode
//             is marked with an accent icon.
//   COMMANDS  everything else, as before.
//
// The input keeps keyboard focus the whole time; selection is a
// visual cursor. Arrows move it linearly through everything visible,
// Enter activates, any character filters (first keystroke re-ranks
// to best match — a mode never steals Enter from a typed query),
// backspace-to-empty restores the resting preselection, Escape
// clears the query first and closes when empty.
//
// Each command can be filtered out via an optional `available()`
// predicate — used to scope format actions to mode 3 and zoom /
// reload to Tauri.

import type { Harness } from './main'
import { toggleFullscreen } from './main'
import { openFile, saveFile, newFile, getCurrentSourceUrl, getContentKind } from './doc-source'
import { openUrlPrompt } from './url-open'
import { openThemePicker } from './theme-picker'
import { toggleRecentTheme, showThemeToast, showToast } from './themes'
import { openFontPicker } from './font-picker'
import { isTauri as isZoomTauri, zoomIn, zoomOut, zoomReset } from './zoom'
import { IS_MAC } from './platform'
import {
  EDIT_FLAVOURS,
  READ_ENTRY,
  isEditMode,
  readEditFlavour,
} from './edit-mode'
import type { EditFlavour } from './edit-mode'

interface Command {
  id: string
  label: string
  hint?: string
  shortcut?: string
  action: () => void | Promise<void>
  available?: () => boolean
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function buildCommands(harness: Harness): Command[] {
  const inMode = (k: number) => () => harness.getCurrentMode().key === k
  const inWysiwyg = inMode(3)

  return [
    // Modes live in the panel's pinned mode section, not here — the
    // old "Switch to Read" / "Edit in X" / "Choose mode…" commands
    // were redundant with it. Cycle survives as the one mode action
    // with no row of its own.
    { id: 'mode.cycle', label: 'Cycle modes', shortcut: 'Cmd+Shift+M', action: () => harness.cycle() },

    // File
    { id: 'file.new', label: 'New file', hint: 'Discards unsaved changes', shortcut: 'Cmd+N', action: () => void newFile(harness) },
    { id: 'file.open', label: 'Open file…', shortcut: 'Cmd+O', action: () => void openFile(harness) },
    { id: 'file.openUrl', label: 'Open URL…', hint: 'GitHub markdown files', shortcut: 'Cmd+Alt+O', action: () => openUrlPrompt(harness) },
    {
      id: 'file.shareLink',
      label: 'Copy share link',
      hint: 'Reopens this doc on this site',
      // Only available when the current doc was loaded from a URL —
      // there's nothing meaningful to share for files-on-disk or
      // untitled drafts. Predicate runs at palette open time, so the
      // command appears / disappears as the active doc changes.
      available: () => getCurrentSourceUrl() !== null,
      action: async () => {
        const sourceUrl = getCurrentSourceUrl()
        if (!sourceUrl) return
        // Use the current origin so dev-server users get a localhost
        // link they can actually visit; in production this becomes
        // nicer.md/?url=… (the recipient still sees the phishing
        // gate before any fetch happens — share links are not auto-
        // -trust, they just bootstrap the prompt).
        const shareUrl = `${window.location.origin}/?url=${encodeURIComponent(sourceUrl)}`
        try {
          await navigator.clipboard.writeText(shareUrl)
          showToast('Share link copied')
        } catch {
          showToast('Couldn’t copy link')
        }
      },
    },
    { id: 'file.save', label: 'Save', shortcut: 'Cmd+S', action: () => void saveFile(harness) },
    { id: 'file.saveAs', label: 'Save As…', shortcut: 'Cmd+Shift+S', action: () => void saveFile(harness, { saveAs: true }) },

    // View / window
    { id: 'view.fullscreen', label: 'Toggle fullscreen', shortcut: 'Cmd+Shift+F', action: () => void toggleFullscreen() },
    { id: 'view.reload', label: 'Reload', shortcut: 'Cmd+R', action: () => window.location.reload(), available: isTauri },
    { id: 'view.zoomIn', label: 'Zoom in', shortcut: 'Cmd+=', action: () => void zoomIn(), available: isZoomTauri },
    { id: 'view.zoomOut', label: 'Zoom out', shortcut: 'Cmd+-', action: () => void zoomOut(), available: isZoomTauri },
    { id: 'view.zoomReset', label: 'Reset zoom', shortcut: 'Cmd+0', action: () => void zoomReset(), available: isZoomTauri },

    // Theme
    { id: 'theme.picker', label: 'Theme…', shortcut: 'Cmd+Alt+T', action: () => openThemePicker() },
    {
      id: 'theme.toggleRecent',
      label: 'Switch to previous theme',
      hint: 'Cycles between the two most recent',
      shortcut: 'Cmd+\\',
      action: () => {
        const swapped = toggleRecentTheme()
        if (swapped) showThemeToast(swapped)
      },
    },

    // Fonts
    { id: 'font.picker', label: 'Fonts…', shortcut: 'Cmd+Alt+F', action: () => openFontPicker() },

    // Format — mode 2 only
    { id: 'format.bold', label: 'Bold', shortcut: 'Cmd+B', action: () => harness.toggleFormat('bold'), available: inWysiwyg },
    { id: 'format.italic', label: 'Italic', shortcut: 'Cmd+I', action: () => harness.toggleFormat('italic'), available: inWysiwyg },
    { id: 'format.strike', label: 'Strikethrough', action: () => harness.toggleFormat('strike'), available: inWysiwyg },
    { id: 'format.code', label: 'Inline code', shortcut: 'Cmd+E', action: () => harness.toggleFormat('code'), available: inWysiwyg },
    { id: 'format.h1', label: 'Heading 1', shortcut: 'Cmd+Alt+1', action: () => harness.toggleFormat('h1'), available: inWysiwyg },
    { id: 'format.h2', label: 'Heading 2', shortcut: 'Cmd+Alt+2', action: () => harness.toggleFormat('h2'), available: inWysiwyg },
    { id: 'format.bulletList', label: 'Bullet list', shortcut: 'Cmd+Shift+8', action: () => harness.toggleFormat('bulletList'), available: inWysiwyg },
    { id: 'format.orderedList', label: 'Numbered list', shortcut: 'Cmd+Shift+7', action: () => harness.toggleFormat('orderedList'), available: inWysiwyg },
    { id: 'format.blockquote', label: 'Blockquote', shortcut: 'Cmd+Shift+B', action: () => harness.toggleFormat('blockquote'), available: inWysiwyg },
    { id: 'format.link', label: 'Link…', action: () => harness.toggleFormat('link'), available: inWysiwyg },
  ]
}

// Tiny fuzzy scorer. Empty query → 1 (everything matches). Exact match
// > prefix > substring > char-skip-with-consecutive-bonus. Returns 0
// when not all query chars appear in target order.
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 10000
  if (t.startsWith(q)) return 5000 - (t.length - q.length)
  if (t.includes(q)) return 2000 - t.indexOf(q)
  let qi = 0
  let lastMatch = -2
  let score = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t.charCodeAt(ti) === q.charCodeAt(qi)) {
      score += lastMatch === ti - 1 ? 6 : 2
      lastMatch = ti
      qi++
    }
  }
  return qi === q.length ? score : 0
}

let isOpen = false
let registeredHarness: Harness | null = null

// Programmatic open — used by the strip control, the Write tool row's
// Menu button and edit-mode's first-use fallback, without having to
// dispatch a synthetic Cmd+K. Returns false silently if the panel has
// not been wired yet (setupCommandPalette not called) or is already
// open.
export function openPalette(): boolean {
  if (isOpen || !registeredHarness) return false
  openPaletteImpl(registeredHarness)
  return true
}

export function setupCommandPalette(harness: Harness): void {
  registeredHarness = harness
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return
    if (e.shiftKey || e.altKey) return
    // Cmd+K and Cmd+/ both open the palette. Cmd+/ would otherwise be
    // a no-op in the browser; Cmd+K is the de-facto command-palette
    // shortcut across modern apps.
    if (e.code !== 'KeyK' && e.code !== 'Slash') return
    e.preventDefault()
    if (!isOpen) openPaletteImpl(harness)
  })
}

// A row in the unified list — either a mode or a command. Kept as one
// flat array so selection/arrow logic stays a single index.
type PanelItem =
  | { kind: 'mode'; flavour: EditFlavour }
  | { kind: 'command'; cmd: Command }

function openPaletteImpl(harness: Harness): void {
  if (isOpen) return
  isOpen = true

  const all = buildCommands(harness).filter((cmd) => !cmd.available || cmd.available())

  // Mode rows — full list Read-first, trimmed to Code for non-markdown
  // docs (the markdown-only boundary surfaced by absence, matching
  // harness.switchTo's enforcement).
  const isMarkdown = getContentKind().kind === 'markdown'
  const modes: EditFlavour[] = [READ_ENTRY, ...EDIT_FLAVOURS].filter(
    (f) => isMarkdown || !f.markdownOnly,
  )
  const current = harness.getCurrentMode().key

  // Round-trip preselection: from an edit mode → Read; from Read →
  // the remembered flavour (first-ever use falls back to the first
  // edit flavour so Enter still does something sensible).
  const preferredKey = isEditMode(current)
    ? 1
    : (readEditFlavour() ?? modes.find((f) => f.key !== 1)?.key ?? 1)

  const backdrop = document.createElement('div')
  backdrop.className = 'cmdp__backdrop'

  const panel = document.createElement('div')
  panel.className = 'cmdp__panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'Modes and commands')

  const input = document.createElement('input')
  input.className = 'cmdp__input'
  input.type = 'text'
  input.name = 'cmdp-search'
  input.placeholder = 'Type to search…'
  input.setAttribute('aria-label', 'Search modes and commands')
  input.autocomplete = 'off'
  input.spellcheck = false
  // Stop Chrome / 1Password / LastPass from attaching autofill UI that
  // silently swallows the first Escape press. `autocomplete="off"`
  // alone isn't enough — Chrome ignores it on plain text inputs.
  input.setAttribute('data-form-type', 'other')
  input.setAttribute('data-1p-ignore', 'true')
  input.setAttribute('data-lpignore', 'true')
  panel.appendChild(input)

  const list = document.createElement('ul')
  list.className = 'cmdp__list'
  list.setAttribute('role', 'listbox')
  panel.appendChild(list)

  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)

  let filtered: PanelItem[] = []
  let selectedIdx = 0

  const close = (): void => {
    if (!isOpen) return
    isOpen = false
    window.removeEventListener('keydown', onKeydown, true)
    backdrop.remove()
  }

  const execute = (item: PanelItem): void => {
    close()
    // Run after the modal is gone so commands like "Open file…" that
    // hand off to a system dialog don't fight the closing backdrop.
    // rememberEditFlavour fires via the onModeChange hook on actual
    // entry, so mode rows just switch.
    if (item.kind === 'mode') {
      const key = item.flavour.key
      queueMicrotask(() => harness.switchTo(key))
      return
    }
    const cmd = item.cmd
    queueMicrotask(() => void cmd.action())
  }

  const shortcutLabel = (shortcut: string): string =>
    IS_MAC ? shortcut : shortcut.replace(/\bCmd\b/g, 'Ctrl')

  const render = (): void => {
    list.textContent = ''
    if (filtered.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'cmdp__empty'
      empty.textContent = 'No matches'
      list.appendChild(empty)
      return
    }
    filtered.forEach((item, idx) => {
      // Divider between the mode zone and the commands beneath it —
      // rendered as inert list furniture, never selectable.
      if (
        idx > 0 &&
        item.kind === 'command' &&
        filtered[idx - 1]?.kind === 'mode'
      ) {
        const div = document.createElement('li')
        div.className = 'cmdp__divider'
        div.setAttribute('aria-hidden', 'true')
        div.textContent = 'Commands'
        list.appendChild(div)
      }

      const row = document.createElement('li')
      row.className = 'cmdp__row'
      if (idx === selectedIdx) {
        row.classList.add('cmdp__row--selected')
      }
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', idx === selectedIdx ? 'true' : 'false')

      if (item.kind === 'mode') {
        row.classList.add('cmdp__row--mode')
        // Accent icon marks the mode you're IN (distinct from the
        // arrow-key selection) so the list answers "where am I".
        if (item.flavour.key === current) row.classList.add('cmdp__row--current')

        const icon = document.createElement('span')
        icon.className = 'cmdp__icon'
        icon.innerHTML =
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
          `stroke-linejoin="round">${item.flavour.paths}</svg>`
        row.appendChild(icon)

        const label = document.createElement('span')
        label.className = 'cmdp__label'
        label.textContent = item.flavour.name
        row.appendChild(label)

        const hint = document.createElement('span')
        hint.className = 'cmdp__hint'
        hint.textContent = item.flavour.hint
        row.appendChild(hint)

        const sc = document.createElement('span')
        sc.className = 'cmdp__shortcut'
        sc.textContent = shortcutLabel(item.flavour.shortcut)
        row.appendChild(sc)
      } else {
        const cmd = item.cmd
        const label = document.createElement('span')
        label.className = 'cmdp__label'
        label.textContent = cmd.label
        row.appendChild(label)

        if (cmd.hint) {
          const hint = document.createElement('span')
          hint.className = 'cmdp__hint'
          hint.textContent = cmd.hint
          row.appendChild(hint)
        }

        if (cmd.shortcut) {
          const sc = document.createElement('span')
          sc.className = 'cmdp__shortcut'
          // Shortcuts are authored Mac-side ('Cmd+K'); rewrite at
          // render time for non-Mac readers.
          sc.textContent = shortcutLabel(cmd.shortcut)
          row.appendChild(sc)
        }
      }

      row.addEventListener('mousemove', () => {
        if (selectedIdx === idx) return
        selectedIdx = idx
        render()
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        execute(item)
      })

      list.appendChild(row)
    })
    // Keep the selected row visible during arrow-key nav. `nearest` is
    // a no-op when the row is already on-screen (so mouse hover doesn't
    // cause spurious scrolling) and only scrolls the minimum needed
    // when the selection moves out of the viewport.
    list
      .querySelector<HTMLLIElement>('.cmdp__row--selected')
      ?.scrollIntoView({ block: 'nearest' })
  }

  const filter = (): void => {
    const q = input.value.trim()
    if (!q) {
      // Resting state: full list, selection back on the round-trip
      // mode — backspacing to empty restores it rather than stranding
      // the cursor wherever the last query left it.
      filtered = [
        ...modes.map((flavour): PanelItem => ({ kind: 'mode', flavour })),
        ...all.map((cmd): PanelItem => ({ kind: 'command', cmd })),
      ]
      selectedIdx = Math.max(
        0,
        filtered.findIndex(
          (i) => i.kind === 'mode' && i.flavour.key === preferredKey,
        ),
      )
      render()
      return
    }
    // Typed query: matching modes stay pinned above matching commands,
    // each zone ranked by score; selection jumps to the best match so
    // a mode never steals Enter from a typed command query.
    // Modes match on name, description AND invisible keywords —
    // "edit" must surface the edit flavours even though the row
    // names stay clean. Name matches outrank the weaker channels.
    const modeScore = (f: EditFlavour): number =>
      Math.max(
        fuzzyScore(q, f.name),
        Math.round(fuzzyScore(q, f.hint) * 0.4),
        Math.round(fuzzyScore(q, f.keywords) * 0.8),
      )
    const modeScored = modes
      .map((flavour) => ({ flavour, score: modeScore(flavour) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
    const cmdScored = all
      .map((cmd) => ({ cmd, score: fuzzyScore(q, cmd.label) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
    filtered = [
      ...modeScored.map((e): PanelItem => ({ kind: 'mode', flavour: e.flavour })),
      ...cmdScored.map((e): PanelItem => ({ kind: 'command', cmd: e.cmd })),
    ]
    // Best match wins the cursor: a stronger command score outranks a
    // weak mode name match even though modes render first.
    const bestMode = modeScored[0]?.score ?? 0
    const bestCmd = cmdScored[0]?.score ?? 0
    selectedIdx = bestCmd > bestMode ? modeScored.length : 0
    render()
  }

  input.addEventListener('input', filter)

  // Modal hotkeys at the window level — Chrome intercepts Escape on
  // focused inputs in some configurations before it bubbles to a
  // panel-level listener, so binding here is more robust. Capture
  // phase so we win over any deeper handler (e.g. Tiptap's editor
  // shortcuts, which would otherwise eat Cmd+B inside the palette).
  // Escape is two-stage: clear a typed query first, close when empty —
  // two taps from deep in a search, one from rest.
  const onEscape = (): void => {
    if (input.value) {
      input.value = ''
      filter()
      return
    }
    close()
  }

  const onKeydown = (e: KeyboardEvent): void => {
    if (!isOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onEscape()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIdx = (selectedIdx + 1) % filtered.length
      render()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length === 0) return
      selectedIdx = (selectedIdx - 1 + filtered.length) % filtered.length
      render()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[selectedIdx]
      if (item) execute(item)
      return
    }
  }
  window.addEventListener('keydown', onKeydown, true)
  // Also bind directly on the input as a safety net — if Chrome's
  // autofill machinery intercepts the first Escape before the window
  // listener sees it, this one runs in the input's own capture phase
  // and is guaranteed to fire before any browser-level handling.
  input.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onEscape()
    },
    true,
  )

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close()
  })

  // Initial state runs through filter() with the empty query — builds
  // the resting list and places selection on the round-trip mode.
  filter()
  // Defer focus to the next tick so the keydown that opened the
  // palette finishes processing first — otherwise some browsers fire
  // the same keystroke at the input and prefill it.
  setTimeout(() => input.focus(), 0)
}
