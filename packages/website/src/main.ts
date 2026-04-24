import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { getMarkdown, replaceAll } from '@milkdown/utils'
import { getTheme } from 'nicermd-core'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdown', '.mkd']

function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function downloadMarkdown(markdown: string, filename: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import '@milkdown/prose/view/style/prosemirror.css'
import '@milkdown/prose/tables/style/tables.css'
import '@milkdown/prose/gapcursor/style/gapcursor.css'

import showcase from './samples/showcase.md?raw'

const INITIAL = showcase

// File System Access API — standardized but not yet in TypeScript's lib.dom.
declare global {
  interface DataTransferItem {
    getAsFileSystemHandle(): Promise<FileSystemHandle | null>
  }
}

const LAYOUT_CSS = `
html, body, #app { height: 100%; }
body { margin: 0; }

.app-pane {
  min-height: 100vh;
  box-sizing: border-box;
}

/* Edit-mode visual cues — orange caret in the editor, orange mode indicator badge. */
body.is-editing .ProseMirror {
  caret-color: #ea580c;
}

/* Top-left mode indicator: N-in-a-rounded-box.
   - Fades out 1s after any state change (load / mode toggle).
   - Hover or an open panel keeps it fully visible.
   - Mode coloring: blue (read) / orange (edit) — both stroke and fill match.
   - App-logo state (initial load, before any mode change): blue fill + orange stroke. */
.mode-indicator {
  position: fixed;
  top: 0.875rem;
  /* Content-aligned: icon's left edge sits at the right edge of the 720px reading column,
     floating in the gutter outside content. Falls back to the viewport corner on narrow screens.
     If --nicer-max-width changes, update the 360 constant here (half of 720). */
  right: max(0.875rem, calc(50vw - 360px - 84px));
  /* 84 x 84 hit area (3x the visible icon) — generous surround without hijacking the full right edge. */
  width: 84px;
  height: 84px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  background: none;
  border: none;
  -webkit-appearance: none;
  appearance: none;
  font: inherit;
  color: #2563eb;
  cursor: pointer;
  opacity: 0;
  transition: opacity 400ms ease, color 120ms ease;
  z-index: 10;
}
.mode-indicator.is-visible,
.mode-indicator.is-panel-open,
.mode-indicator:hover { opacity: 1; }
.mode-indicator:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 6px; }
body.is-editing .mode-indicator { color: #ea580c; }
/* Hover scale lives on the SVG so the tall column doesn't try to scale itself. */
.mode-indicator svg {
  width: 28px;
  height: 28px;
  display: block;
  transition: transform 120ms ease;
}
.mode-indicator:hover svg { transform: scale(1.08); }

/* App-logo state: blue letter + orange border (two-colour branding).
   Removed after the first mode change, after which the logo follows the mode colour. */
.mode-indicator.is-app-logo rect { stroke: #ea580c; }
.mode-indicator.is-app-logo text { fill: #2563eb; }

/* Command palette — centred over the reading column, ~15% from the top.
   Raycast / VS Code pattern. Width matches the reading column (720px) capped
   to the viewport on narrow screens. */
.command-palette {
  position: fixed;
  top: 15vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 2rem));
  max-height: 70vh;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.command-palette[hidden] { display: none; }

.command-palette-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.875rem 1.125rem;
  border: none;
  border-bottom: 1px solid #e4e4e7;
  outline: none;
  font: inherit;
  font-size: 1rem;
  background: transparent;
  color: inherit;
}
.command-palette-input::placeholder { color: #a1a1aa; }

/* Command grid — flex-wrap of pill buttons. Filter shrinks the visible set;
   tablet users tap directly, keyboard users type + use Up/Down + Enter. */
.command-palette-list {
  list-style: none;
  margin: 0;
  padding: 0.75rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-content: flex-start;
}

.command-pill {
  padding: 0.5rem 0.875rem;
  border: 1px solid #e4e4e7;
  border-radius: 999px;
  background: #ffffff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9rem;
  color: #18181b;
  cursor: pointer;
  min-height: 2.25rem;
  line-height: 1.2;
  white-space: nowrap;
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
  transition: background 100ms ease, border-color 100ms ease;
}
.command-pill:hover,
.command-pill.is-active {
  background: #f4f4f5;
  border-color: #d4d4d8;
}
.command-pill:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.command-palette-empty {
  width: 100%;
  padding: 1rem;
  text-align: center;
  color: #a1a1aa;
  font-size: 0.9rem;
  list-style: none;
}

/* Strip ProseMirror's default chrome so .nicer-doc drives the look. */
.app-pane .ProseMirror {
  outline: none;
  padding: 0;
  min-height: calc(100vh - 4rem);
  white-space: pre-wrap;
  word-wrap: break-word;
}
.app-pane .ProseMirror:focus-visible {
  outline: none;
}

/* First child gets no top margin (nicer-doc already accounts for h1 margin-top: 0, but ensure it for any leading node). */
.app-pane .ProseMirror > :first-child {
  margin-top: 0;
}
`

async function mount(root: HTMLElement): Promise<void> {
  const theme = getTheme('default')

  // Constructable stylesheets — no inline <style>, strict-CSP friendly.
  const themeSheet = new CSSStyleSheet()
  themeSheet.replaceSync(theme.css)
  const layoutSheet = new CSSStyleSheet()
  layoutSheet.replaceSync(LAYOUT_CSS)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet, layoutSheet]

  root.innerHTML = `
    <button class="mode-indicator is-app-logo" id="mode-indicator" type="button" aria-label="Open menu" title="Menu (Cmd/Ctrl+/)">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2" y="2" width="28" height="28" rx="6" fill="#ffffff" stroke="currentColor" stroke-width="2.5"/>
        <text x="16" y="22" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" fill="currentColor">N</text>
      </svg>
    </button>
    <div class="command-palette" id="command-palette" hidden role="dialog" aria-label="Command palette">
      <input
        class="command-palette-input"
        id="command-palette-input"
        type="text"
        placeholder="Type a command…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Command"
      >
      <div class="command-palette-list" id="command-palette-list" role="listbox"></div>
    </div>
    <article class="nicer-doc app-pane" id="nicer-pane"></article>
  `
  const container = root.querySelector<HTMLElement>('#nicer-pane')!
  const modeIndicator = root.querySelector<HTMLButtonElement>('#mode-indicator')!
  const commandPalette = root.querySelector<HTMLDivElement>('#command-palette')!
  const paletteInput = root.querySelector<HTMLInputElement>('#command-palette-input')!
  const paletteList = root.querySelector<HTMLDivElement>('#command-palette-list')!

  // Read/edit mode. Defaults to read — Cmd/Ctrl+I enters edit, Escape or the
  // same shortcut exits. Edit mode is signalled by an orange caret, a 2px orange
  // top border on the pane, and "[edit] " prepended to the tab title.
  let editMode = false
  const baseTitle = document.title

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container)
      ctx.set(defaultValueCtx, INITIAL)
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { spellcheck: 'false' },
        editable: () => editMode,
      }))
    })
    .use(commonmark)
    .use(gfm)
    .create()

  // Flash the mode indicator visible, then fade it out after 1s.
  // Clears any pending fade so rapid state changes reset the timer cleanly.
  let fadeTimer: number | undefined
  function flashIndicator(): void {
    modeIndicator.classList.add('is-visible')
    if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    fadeTimer = window.setTimeout(() => {
      modeIndicator.classList.remove('is-visible')
      fadeTimer = undefined
    }, 1000)
  }

  function setEditMode(enabled: boolean): void {
    if (editMode === enabled) return
    editMode = enabled
    document.body.classList.toggle('is-editing', enabled)
    document.title = enabled ? `[edit] ${baseTitle}` : baseTitle
    // First mode change drops the two-colour app-logo state; from here the indicator follows the mode.
    modeIndicator.classList.remove('is-app-logo')
    flashIndicator()
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.setProps({ editable: () => enabled })
      if (enabled) view.focus()
    })
  }

  // Command palette. Clicking the indicator or pressing Cmd/Ctrl+/ opens it;
  // Cmd/Ctrl+I remains the dedicated edit-mode shortcut (the palette also has
  // a "Toggle edit mode" command for mouse/tablet users).
  type Command = {
    id: string
    aliases: string[]
    label: string
    run: () => void
  }
  const commands: Command[] = [
    {
      id: 'open-github',
      aliases: ['/git', '/github'],
      label: 'Open GitHub repo',
      run: () => {
        window.open('https://github.com/isherlock/nicermd', '_blank', 'noopener,noreferrer')
      },
    },
    {
      id: 'toggle-edit',
      aliases: ['/edit', '/e'],
      label: 'Toggle edit mode',
      run: () => setEditMode(!editMode),
    },
    {
      id: 'help',
      aliases: ['/h', '/help'],
      label: 'Open help page (placeholder)',
      run: () => window.alert('Help placeholder — real content coming later.'),
    },
  ]

  let filteredCommands: Command[] = commands.slice()
  let activeIdx = 0

  function filterCommands(query: string): Command[] {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice()
    return commands.filter((c) => {
      const haystack = `${c.aliases.join(' ')} ${c.label}`.toLowerCase()
      return haystack.includes(q)
    })
  }

  function renderPalette(): void {
    if (filteredCommands.length === 0) {
      paletteList.innerHTML = `<div class="command-palette-empty">No commands match.</div>`
      return
    }
    paletteList.innerHTML = filteredCommands
      .map((c, i) => {
        const activeCls = i === activeIdx ? ' is-active' : ''
        const primary = c.aliases[0] ?? ''
        return `<button type="button" class="command-pill${activeCls}" data-idx="${i}" role="option" aria-label="${c.label}" title="${c.label}">${primary}</button>`
      })
      .join('')
  }

  function executeActive(): void {
    const cmd = filteredCommands[activeIdx]
    if (!cmd) return
    setPanelOpen(false)
    cmd.run()
  }

  let panelOpen = false
  function setPanelOpen(open: boolean): void {
    if (panelOpen === open) return
    panelOpen = open
    commandPalette.hidden = !open
    modeIndicator.classList.toggle('is-panel-open', open)
    if (open) {
      paletteInput.value = ''
      filteredCommands = commands.slice()
      activeIdx = 0
      renderPalette()
      // rAF so the display update lands before we try to focus.
      requestAnimationFrame(() => paletteInput.focus())
    }
  }

  paletteInput.addEventListener('input', () => {
    filteredCommands = filterCommands(paletteInput.value)
    activeIdx = 0
    renderPalette()
  })

  paletteInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredCommands.length === 0) return
      activeIdx = Math.min(activeIdx + 1, filteredCommands.length - 1)
      renderPalette()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredCommands.length === 0) return
      activeIdx = Math.max(activeIdx - 1, 0)
      renderPalette()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      executeActive()
    }
  })

  paletteList.addEventListener('mousemove', (event) => {
    const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('.command-pill')
    if (!pill) return
    const idx = Number(pill.dataset.idx)
    if (!Number.isNaN(idx) && idx !== activeIdx) {
      activeIdx = idx
      renderPalette()
    }
  })

  paletteList.addEventListener('click', (event) => {
    const pill = (event.target as HTMLElement).closest<HTMLButtonElement>('.command-pill')
    if (!pill) return
    const idx = Number(pill.dataset.idx)
    if (!Number.isNaN(idx)) {
      activeIdx = idx
      executeActive()
    }
  })

  modeIndicator.addEventListener('click', (event) => {
    event.stopPropagation()
    setPanelOpen(!panelOpen)
  })
  document.addEventListener('click', (event) => {
    if (!panelOpen) return
    const target = event.target as Node
    if (!commandPalette.contains(target)) setPanelOpen(false)
  })

  // Show the logo briefly on first load.
  flashIndicator()

  // Scroll activity also flashes the indicator, resetting the fade timer on each event.
  // Passive listener — we only observe, never call preventDefault.
  window.addEventListener('scroll', () => flashIndicator(), { passive: true })

  // Toggle full-viewport fullscreen on Cmd/Ctrl+Shift+F. Escape is handled by the browser.
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyF') {
      event.preventDefault()
      if (document.fullscreenElement) {
        void document.exitFullscreen()
      } else {
        void document.documentElement.requestFullscreen()
      }
    }
  })

  // Enter/exit edit mode. Cmd/Ctrl+I toggles; Escape exits when active.
  // Cmd/Ctrl+/ toggles the menu panel (mirrors clicking the logo).
  window.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.code === 'KeyI'
    ) {
      event.preventDefault()
      setEditMode(!editMode)
    } else if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key === '/'
    ) {
      event.preventDefault()
      setPanelOpen(!panelOpen)
    } else if (event.code === 'Escape') {
      // Escape closes the menu panel first; otherwise exits edit mode.
      if (panelOpen) {
        event.preventDefault()
        setPanelOpen(false)
      } else if (editMode) {
        event.preventDefault()
        setEditMode(false)
      }
    }
  })

  // Tracks where the current document came from so save can write back to the right place.
  // Set when a file is dropped; stays null for the default showcase or pasted/typed content.
  let fileHandle: FileSystemFileHandle | null = null
  let currentFilename: string | null = null

  async function openDroppedItem(item: DataTransferItem, file: File): Promise<void> {
    let handle: FileSystemFileHandle | null = null
    try {
      // getAsFileSystemHandle is Chromium-only; Firefox/Safari will throw or return null.
      const h = await item.getAsFileSystemHandle()
      if (h?.kind === 'file') handle = h as FileSystemFileHandle
    } catch {
      // File System Access API unavailable — save will fall back to download.
    }
    const text = await file.text()
    editor.action(replaceAll(text))
    fileHandle = handle
    currentFilename = file.name
  }

  async function saveCurrent(): Promise<void> {
    const markdown = editor.action(getMarkdown())
    if (fileHandle) {
      try {
        const writable = await fileHandle.createWritable()
        await writable.write(markdown)
        await writable.close()
        return
      } catch {
        // Permission revoked or write failed — fall back to download.
      }
    }
    downloadMarkdown(markdown, currentFilename ?? 'document.md')
  }

  // Accept drag-and-drop of a markdown file — replaces the editor contents and, on Chromium,
  // captures a writable handle so subsequent saves update the file in place.
  // Only intercepts when the drag carries files; in-editor text drags still flow to ProseMirror.
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
    }
  })
  window.addEventListener('drop', (event) => {
    const items = event.dataTransfer?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (!file || !isMarkdownFile(file)) continue
      event.preventDefault()
      event.stopPropagation()
      void openDroppedItem(item, file)
      return
    }
  })

  // Save on Cmd/Ctrl+S — writes back via the captured handle, or falls back to download.
  window.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.code === 'KeyS'
    ) {
      event.preventDefault()
      void saveCurrent()
    }
  })
}

const appRoot = document.getElementById('app')
if (appRoot) void mount(appRoot)
