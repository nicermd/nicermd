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
  left: 0.875rem;
  width: 28px;
  height: 28px;
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
  transition: opacity 400ms ease, color 120ms ease, transform 120ms ease;
  z-index: 10;
}
.mode-indicator.is-visible,
.mode-indicator.is-panel-open,
.mode-indicator:hover { opacity: 1; }
.mode-indicator:hover { transform: scale(1.08); }
.mode-indicator:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 6px; }
body.is-editing .mode-indicator { color: #ea580c; }
.mode-indicator svg { width: 100%; height: 100%; display: block; }

/* App-logo state: blue letter + orange border (two-colour branding).
   Removed after the first mode change, after which the logo follows the mode colour. */
.mode-indicator.is-app-logo rect { stroke: #ea580c; }
.mode-indicator.is-app-logo text { fill: #2563eb; }

/* Placeholder panel anchored below the logo. Design later. */
.mode-panel {
  position: fixed;
  top: 3.25rem;
  left: 0.875rem;
  min-width: 220px;
  padding: 1rem;
  background: #ffffff;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  z-index: 10;
  font-size: 0.9rem;
  color: #52525b;
}
.mode-panel[hidden] { display: none; }
.mode-panel p { margin: 0; }

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
    <button class="mode-indicator is-app-logo" id="mode-indicator" type="button" aria-label="Open menu" title="Menu">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2" y="2" width="28" height="28" rx="6" fill="#ffffff" stroke="currentColor" stroke-width="2.5"/>
        <text x="16" y="22" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800" fill="currentColor">N</text>
      </svg>
    </button>
    <div class="mode-panel" id="mode-panel" hidden>
      <p>Menu placeholder — proper design coming later.</p>
    </div>
    <article class="nicer-doc app-pane" id="nicer-pane"></article>
  `
  const container = root.querySelector<HTMLElement>('#nicer-pane')!
  const modeIndicator = root.querySelector<HTMLButtonElement>('#mode-indicator')!
  const modePanel = root.querySelector<HTMLDivElement>('#mode-panel')!

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

  // Click opens a placeholder menu panel. Cmd/Ctrl+I remains the mode shortcut.
  let panelOpen = false
  function setPanelOpen(open: boolean): void {
    if (panelOpen === open) return
    panelOpen = open
    modePanel.hidden = !open
    modeIndicator.classList.toggle('is-panel-open', open)
  }
  modeIndicator.addEventListener('click', (event) => {
    event.stopPropagation()
    setPanelOpen(!panelOpen)
  })
  document.addEventListener('click', (event) => {
    if (!panelOpen) return
    const target = event.target as Node
    if (!modePanel.contains(target)) setPanelOpen(false)
  })

  // Show the logo briefly on first load.
  flashIndicator()

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
  window.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.code === 'KeyI'
    ) {
      event.preventDefault()
      setEditMode(!editMode)
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
