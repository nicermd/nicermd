import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core'
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

  root.innerHTML = `<article class="nicer-doc app-pane" id="nicer-pane"></article>`
  const container = root.querySelector<HTMLElement>('#nicer-pane')!

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container)
      ctx.set(defaultValueCtx, INITIAL)
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { spellcheck: 'false' },
      }))
    })
    .use(commonmark)
    .use(gfm)
    .create()

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
