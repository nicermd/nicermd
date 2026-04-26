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
  | { kind: 'tauri-path'; path: string; name: string }
  | { kind: 'fsa'; handle: FileSystemFileHandle; name: string }

let currentSource: DocSource | null = null

export function clearSource(): void {
  currentSource = null
}

export function getSourceName(): string | null {
  return currentSource?.name ?? null
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

async function openViaTauri(harness: Harness): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const result = await open({
    multiple: false,
    directory: false,
    filters: TAURI_FILE_FILTERS,
  })
  if (typeof result !== 'string') return
  const text = await readTextFile(result)
  currentSource = { kind: 'tauri-path', path: result, name: basename(result) }
  harness.replaceDoc(text)
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
  currentSource = { kind: 'fsa', handle, name: file.name }
  harness.replaceDoc(text)
}

async function openViaInputFallback(harness: Harness): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.md,.markdown,.mdx,text/markdown'
  input.style.display = 'none'
  document.body.appendChild(input)
  await new Promise<void>((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (file) {
        const text = await file.text()
        currentSource = null // anonymous — no write-back path
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
  if (options?.saveAs || !currentSource) {
    await saveAsFile(harness, text)
    return
  }
  if (currentSource.kind === 'tauri-path') {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(currentSource.path, text)
    return
  }
  if (currentSource.kind === 'fsa') {
    const writable = await currentSource.handle.createWritable()
    await writable.write(text)
    await writable.close()
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
    defaultPath: currentSource && currentSource.kind === 'tauri-path' ? currentSource.path : 'untitled.md',
    filters: TAURI_FILE_FILTERS,
  })
  if (typeof path !== 'string') return
  await writeTextFile(path, text)
  currentSource = { kind: 'tauri-path', path, name: basename(path) }
}

async function saveAsViaFsa(
  text: string,
  show: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>,
): Promise<void> {
  let handle: FileSystemFileHandle
  try {
    handle = await show({
      suggestedName: currentSource?.name ?? 'untitled.md',
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
  currentSource = { kind: 'fsa', handle, name: file.name }
}

function saveAsViaDownload(text: string): void {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentSource?.name ?? 'untitled.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
