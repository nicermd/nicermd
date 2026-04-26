// Drag-and-drop file open. Web-API based so it works identically in the
// browser and inside Tauri's WebView. Acceptable extensions: .md, .markdown,
// .mdx — anything else is ignored. On drop, reads the file as text and
// hands it to the harness via replaceDoc, which remounts the active mode
// with the new content.
//
// Visual feedback: a full-window overlay appears on the first dragenter
// that includes Files in dataTransfer.types and disappears on drop or
// when the drag exits the window. Depth counter handles nested
// dragenter/leave events from child elements correctly.

import type { Harness } from './main'
import { setDocState } from './doc-source'

const ACCEPTED_EXT = /\.(md|markdown|mdx)$/i

export function setupFileDrop(harness: Harness): void {
  const overlay = document.createElement('div')
  overlay.className = 'file-drop-overlay'
  const text = document.createElement('div')
  text.className = 'file-drop-overlay__text'
  text.textContent = 'Drop a markdown file'
  overlay.appendChild(text)
  document.body.appendChild(overlay)

  let depth = 0
  const show = (): void => {
    overlay.classList.add('file-drop-overlay--active')
  }
  const hide = (): void => {
    overlay.classList.remove('file-drop-overlay--active')
  }

  const eventCarriesFiles = (event: DragEvent): boolean => {
    const types = event.dataTransfer?.types
    if (!types) return false
    for (const tt of Array.from(types)) {
      if (tt === 'Files') return true
    }
    return false
  }

  window.addEventListener('dragenter', (event) => {
    if (!eventCarriesFiles(event)) return
    event.preventDefault()
    depth += 1
    show()
  })

  window.addEventListener('dragover', (event) => {
    if (!eventCarriesFiles(event)) return
    // preventDefault is required for the browser to fire `drop`.
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  })

  window.addEventListener('dragleave', (event) => {
    if (!eventCarriesFiles(event)) return
    depth -= 1
    if (depth <= 0) {
      depth = 0
      hide()
    }
  })

  window.addEventListener('drop', (event) => {
    if (!eventCarriesFiles(event)) return
    event.preventDefault()
    depth = 0
    hide()
    void handleDrop(event, harness)
  })
}

async function handleDrop(event: DragEvent, harness: Harness): Promise<void> {
  const file = event.dataTransfer?.files[0]
  if (!file) return
  if (!ACCEPTED_EXT.test(file.name)) {
    console.warn('[file-drop] ignored non-markdown file:', file.name)
    return
  }
  try {
    const text = await file.text()
    // Drag-drop is anonymous — the browser doesn't give us a path or
    // writable handle. Record the name (for display) but leave source
    // null so a subsequent Cmd+S falls through to Save As rather than
    // overwriting the wrong file.
    setDocState(text, file.name, null)
    harness.replaceDoc(text)
  } catch (err) {
    console.error('[file-drop] read failed:', err)
  }
}
