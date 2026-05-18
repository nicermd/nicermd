// Open + Save abstraction across three runtimes:
//
//   - Tauri:        @tauri-apps/plugin-dialog + @tauri-apps/plugin-fs
//                   gives a path; reads/writes via fs API.
//   - Chromium web: window.showOpenFilePicker / showSaveFilePicker
//                   (File System Access API) gives a FileSystemFileHandle
//                   that supports in-place writes.
//   - Other web:    <input type=file> for open, <a download> for save.
//                   Save-back is impossible in this branch — every save
//                   becomes a download.
//
// "Save writes back to wherever the file came from" — from the save-policy
// memory. Tracked here as `currentSource`. Drag-drop opens leave it null
// (anonymous), so a subsequent Save falls through to Save-As.

import type { Harness } from './main'

type DocSource =
  | { kind: 'tauri-path'; path: string }
  | { kind: 'fsa'; handle: FileSystemFileHandle }
  // Loaded by URL — informational only. saveFile treats this the same
  // as a null source (falls through to Save-As); the URL is exposed
  // via getCurrentSourceUrl() so the title strip can show it on hover.
  | { kind: 'url'; url: string }

// State tracked here:
//   - currentSource: where to write back on Cmd+S (null = anonymous)
//   - currentName:   what to display in the title (null = "Untitled")
//   - dirty:         user-typed-since-last-save flag
//
// We track dirty as a boolean (set true only on real user edits via
// markDirty) rather than comparing current text to a baseline string.
// Reasons: Tiptap (mode 2) normalises whitespace and marker style on
// parse, so the editor's serialised output of an unedited file doesn't
// match the raw on-disk bytes — a text-comparison approach would mark
// such files dirty the moment they were opened in mode 2 or after any
// mode switch through mode 2. Boolean state avoids that false positive.
// Cost: typing then reverting keeps dirty on until next save (most
// editors behave the same way).
let currentSource: DocSource | null = null
let currentName: string | null = null
let dirty = false

const SOURCE_CHANGED = 'nicermd:source-changed'

function notifySourceChanged(): void {
  document.dispatchEvent(new CustomEvent(SOURCE_CHANGED))
}

// Identity setter — used by boot, open, save, drag-drop, new. Clears
// the dirty flag (we just loaded or saved, so by definition the editor
// is in sync with the source). Updates display name + source; always
// fires the source-changed event so the title manager can refresh.
export function setDocState(_text: string, name: string | null, source: DocSource | null): void {
  dirty = false
  currentName = name
  currentSource = source
  notifySourceChanged()
}

// Called by main.ts on every harness onLocalChange (real user edit).
export function markDirty(): void {
  if (dirty) return
  dirty = true
  notifySourceChanged()
}

export function isDirty(): boolean {
  return dirty
}

export function getCurrentName(): string | null {
  return currentName
}

// URL the current doc was fetched from, if any. Returns null for files
// loaded from disk / drag-drop / untitled — only the URL-open path
// produces a populated value.
export function getCurrentSourceUrl(): string | null {
  return currentSource?.kind === 'url' ? currentSource.url : null
}

const ACCEPT_FILTERS = {
  description: 'Markdown',
  accept: { 'text/markdown': ['.md', '.markdown', '.mdx'] },
} as const

const TAURI_FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
]

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx >= 0 ? path.slice(idx + 1) : path
}

// --- Open ---------------------------------------------------------------

export async function openFile(harness: Harness): Promise<void> {
  if (isTauri()) {
    await openViaTauri(harness)
    return
  }
  const win = window as unknown as {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
  if (typeof win.showOpenFilePicker === 'function') {
    await openViaFsa(harness, win.showOpenFilePicker)
    return
  }
  await openViaInputFallback(harness)
}

// Open a file from an explicit path (no dialog). Used by Tauri's
// 'Open With…' / double-click flow — macOS fires RunEvent::Opened
// with the chosen file's URL, which lib.rs forwards as a string path.
export async function openFromTauriPath(harness: Harness, path: string): Promise<void> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const text = await readTextFile(path)
  setDocState(text, basename(path), { kind: 'tauri-path', path })
  harness.replaceDoc(text)
}

async function openViaTauri(harness: Harness): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: false,
    directory: false,
    filters: TAURI_FILE_FILTERS,
  })
  if (typeof result !== 'string') return
  await openFromTauriPath(harness, result)
}

async function openViaFsa(
  harness: Harness,
  show: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>,
): Promise<void> {
  let handle: FileSystemFileHandle
  try {
    const handles = await show({ multiple: false, types: [ACCEPT_FILTERS] })
    handle = handles[0]!
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return
    throw err
  }
  const file = await handle.getFile()
  const text = await file.text()
  setDocState(text, file.name, { kind: 'fsa', handle })
  harness.replaceDoc(text)
}

async function openViaInputFallback(harness: Harness): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  input.name = 'file-open'
  input.accept = '.md,.markdown,.mdx,text/markdown'
  input.style.display = 'none'
  document.body.appendChild(input)
  await new Promise<void>((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (file) {
        const text = await file.text()
        // No save-back path in this fallback — record name only.
        setDocState(text, file.name, null)
        harness.replaceDoc(text)
      }
      input.remove()
      resolve()
    }, { once: true })
    input.click()
  })
}

// --- Save ---------------------------------------------------------------

export async function saveFile(harness: Harness, options?: { saveAs?: boolean }): Promise<void> {
  const text = harness.getMarkdown()
  // 'url' sources have no save-back path (we can't write to GitHub from
  // the browser), so they fall through to Save-As just like null does.
  if (options?.saveAs || !currentSource || currentSource.kind === 'url') {
    await saveAsFile(harness, text)
    return
  }
  if (currentSource.kind === 'tauri-path') {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(currentSource.path, text)
    setDocState(text, currentName, currentSource)
    return
  }
  if (currentSource.kind === 'fsa') {
    const writable = await currentSource.handle.createWritable()
    await writable.write(text)
    await writable.close()
    setDocState(text, currentName, currentSource)
    return
  }
}

async function saveAsFile(harness: Harness, text: string): Promise<void> {
  if (isTauri()) {
    await saveAsViaTauri(text)
    return
  }
  const win = window as unknown as {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
  if (typeof win.showSaveFilePicker === 'function') {
    await saveAsViaFsa(text, win.showSaveFilePicker)
    return
  }
  saveAsViaDownload(text)
}

async function saveAsViaTauri(text: string): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({
    defaultPath: currentSource && currentSource.kind === 'tauri-path' ? currentSource.path : (currentName ?? 'untitled.md'),
    filters: TAURI_FILE_FILTERS,
  })
  if (typeof path !== 'string') return
  await writeTextFile(path, text)
  setDocState(text, basename(path), { kind: 'tauri-path', path })
}

async function saveAsViaFsa(
  text: string,
  show: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>,
): Promise<void> {
  let handle: FileSystemFileHandle
  try {
    handle = await show({
      suggestedName: currentName ?? 'untitled.md',
      types: [ACCEPT_FILTERS],
    })
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return
    throw err
  }
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
  const file = await handle.getFile()
  setDocState(text, file.name, { kind: 'fsa', handle })
}

function saveAsViaDownload(text: string): void {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentName ?? 'untitled.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  // Note: download fallback can't track that the user actually saved
  // so we don't update loadedText here — dirty state stays as-is.
}

// --- New ----------------------------------------------------------------

export async function newFile(harness: Harness, defaultText: string = ''): Promise<void> {
  if (isDirty()) {
    const confirmed = await confirmDiscard()
    if (!confirmed) return
  }
  setDocState(defaultText, null, null)
  harness.replaceDoc(defaultText)
}

export async function confirmDiscard(): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask('Discard unsaved changes?', { title: 'Nicer.md', kind: 'warning' })
  }
  return window.confirm('Discard unsaved changes?')
}

// --- File System Access API minimal types -------------------------------
// Not in the standard lib.dom yet; declare just enough for the calls we make.

interface OpenFilePickerOptions {
  multiple?: boolean
  types?: ReadonlyArray<{ description?: string; accept: Record<string, ReadonlyArray<string>> }>
}
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: ReadonlyArray<{ description?: string; accept: Record<string, ReadonlyArray<string>> }>
}
