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
import { classifyPath, SOURCE_EXT_TO_LANG, type ContentKind } from './url-open'
import { persistSource as persistSourceLs } from './per-window-state'

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
// What the loaded doc IS — drives the renderer and the mode-toggle
// visibility (Write/WYSIWYG is hidden for non-markdown so Tiptap
// doesn't round-trip plain text or source files through its markdown
// serialiser). Defaults to markdown; the URL-open path overrides it.
let currentContentKind: ContentKind = { kind: 'markdown' }
let dirty = false

const SOURCE_CHANGED = 'nicermd:source-changed'

function notifySourceChanged(): void {
  document.dispatchEvent(new CustomEvent(SOURCE_CHANGED))
  // Sync the dirty flag to Rust so the warm-state RunEvent::Opened
  // handler can route OS-level Open-With files smartly: clean focused
  // window → replace in-place; dirty focused window → spawn a new
  // window so unsaved edits stay put. No-op outside Tauri.
  syncDirtyToTauri()
}

function syncDirtyToTauri(): void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return
  }
  const isDirtyNow = dirty
  // Fire-and-forget. The IPC is cheap and even if a race orders one
  // invocation behind another by a frame, the dirty flag only flips
  // a small number of times per session (load → edit → save loop),
  // so the worst case is one stale value being briefly cached on
  // the Rust side — corrected by the next setDocState or markDirty.
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_window_dirty', { dirty: isDirtyNow })
    } catch {
      // Bridge not ready yet (very early boot) or command missing
      // on older Tauri builds — silently ignore.
    }
  })()
}

// Identity setter — used by boot, open, save, drag-drop, new. Clears
// the dirty flag (we just loaded or saved, so by definition the editor
// is in sync with the source). Updates display name + source + content
// kind; fires the source-changed event so the title manager and the
// mode-toggle UI both refresh.
export function setDocState(
  _text: string,
  name: string | null,
  source: DocSource | null,
  contentKind: ContentKind = { kind: 'markdown' },
): void {
  dirty = false
  currentName = name
  currentSource = source
  currentContentKind = contentKind
  // Persist source for next-launch restore. FSA handles can't round-
  // trip through localStorage (the handle table doesn't survive a
  // page reload), so they fall through to null along with scratch
  // docs — those windows boot fresh next time.
  if (source?.kind === 'tauri-path') {
    persistSourceLs({
      kind: 'tauri-path',
      value: source.path,
      name,
      contentKind,
    })
  } else if (source?.kind === 'url') {
    persistSourceLs({
      kind: 'url',
      value: source.url,
      name,
      contentKind,
    })
  } else {
    persistSourceLs(null)
  }
  notifySourceChanged()
}

// What kind of content is loaded right now. Defaults to markdown for
// every entry point except url-open (which classifies the URL path).
export function getContentKind(): ContentKind {
  return currentContentKind
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

// JSON-safe snapshot of the current doc's identity for cross-window
// duplication. FSA handles aren't transferable across windows (the
// receiving JS realm can't reach into the originator's handle table)
// and Tiptap-normalised text isn't a faithful re-serialisation, so the
// snapshot returns only the source pointer (path / url) — the new
// window re-reads from disk or re-fetches from the URL on boot. Files
// opened via FSA (Chromium web shell) or scratch drop to source=null;
// the new window opens with whatever content the caller provides
// (typically the current text, treated as scratch).
export interface DuplicateSnapshot {
  // Where to re-load the doc from in the new window. Null = open
  // with `text` as scratch content (caller-provided).
  sourceKind: 'tauri-path' | 'url' | null
  sourceValue: string | null
  // Display name to keep title strip continuity.
  name: string | null
  // Current text content. Used when sourceKind is null (scratch open).
  // For path / url sources the new window re-reads; this is kept as
  // a fallback if the re-read fails (deleted file, offline).
  text: string
  // Content kind so the new window classifies correctly even for
  // scratch source. Pass-through; JS-side shape only.
  contentKind: ContentKind
}

export function getDuplicateSnapshot(text: string): DuplicateSnapshot {
  const src = currentSource
  let sourceKind: 'tauri-path' | 'url' | null = null
  let sourceValue: string | null = null
  if (src?.kind === 'tauri-path') {
    sourceKind = 'tauri-path'
    sourceValue = src.path
  } else if (src?.kind === 'url') {
    sourceKind = 'url'
    sourceValue = src.url
  }
  return {
    sourceKind,
    sourceValue,
    name: currentName,
    text,
    contentKind: currentContentKind,
  }
}

// Reverse lookup language → primary extension. Lazy because
// doc-source ↔ url-open is a cycle (url-open imports Harness from
// main, main imports doc-source); evaluating SOURCE_EXT_TO_LANG at
// module-init time hits the cycle before the binding is ready and
// throws under Vitest's strict ESM eval. Computing on first use lets
// both modules finish loading before we touch the table.
let _langToPrimaryExt: Record<string, string> | null = null
function langToPrimaryExt(): Record<string, string> {
  if (_langToPrimaryExt) return _langToPrimaryExt
  const out: Record<string, string> = {}
  for (const [ext, lang] of Object.entries(SOURCE_EXT_TO_LANG)) {
    if (!(lang in out)) out[lang] = ext
  }
  _langToPrimaryExt = out
  return out
}

const MARKDOWN_EXTS = ['md', 'markdown', 'mdx']
const PLAIN_EXTS = ['txt']

// FSA picker accept entries. The picker shows each entry as a row in the
// "Save as type" dropdown — narrower entries first so the active kind is
// selected by default. For save we surface ONLY the current kind so the
// chosen extension matches; for open we surface ALL supported types so
// the user can pick any file we know how to render.
type FsaAccept = { description: string; accept: Record<string, string[]> }

function fsaAcceptForKind(kind: ContentKind): FsaAccept {
  if (kind.kind === 'markdown') {
    return { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdx'] } }
  }
  if (kind.kind === 'plain') {
    return { description: 'Plain text', accept: { 'text/plain': ['.txt'] } }
  }
  const ext = langToPrimaryExt()[kind.language] ?? 'txt'
  return { description: `${kind.language} source`, accept: { 'text/plain': [`.${ext}`] } }
}

function fsaAcceptOpen(): FsaAccept[] {
  const allSourceExts = Object.keys(SOURCE_EXT_TO_LANG).map((e) => `.${e}`)
  return [
    { description: 'Markdown', accept: { 'text/markdown': MARKDOWN_EXTS.map((e) => `.${e}`) } },
    { description: 'Plain text', accept: { 'text/plain': PLAIN_EXTS.map((e) => `.${e}`) } },
    { description: 'Source code', accept: { 'text/plain': allSourceExts } },
  ]
}

type TauriFilter = { name: string; extensions: string[] }

function tauriFilterForKind(kind: ContentKind): TauriFilter[] {
  if (kind.kind === 'markdown') return [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] }]
  if (kind.kind === 'plain') return [{ name: 'Plain text', extensions: ['txt'] }]
  const ext = langToPrimaryExt()[kind.language] ?? 'txt'
  return [{ name: `${kind.language} source`, extensions: [ext] }]
}

function tauriFilterOpen(): TauriFilter[] {
  return [
    { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
    { name: 'Plain text', extensions: ['txt'] },
    { name: 'Source code', extensions: Object.keys(SOURCE_EXT_TO_LANG) },
  ]
}

// MIME type for the download-fallback Blob. Browsers use this to hint
// the OS file association on save; the extension on the download name
// is the stronger signal, so we keep MIME conservative (text/plain for
// everything non-markdown) rather than mapping every language to its
// IANA media type.
function mimeForKind(kind: ContentKind): string {
  return kind.kind === 'markdown' ? 'text/markdown' : 'text/plain'
}

// Suggested filename for a Save-As when we don't already have one. The
// extension reflects the active content kind so a python file edited
// from a URL with no name lands as `untitled.py`, not `untitled.md`.
function defaultSaveName(kind: ContentKind): string {
  if (kind.kind === 'markdown') return 'untitled.md'
  if (kind.kind === 'plain') return 'untitled.txt'
  const ext = langToPrimaryExt()[kind.language] ?? 'txt'
  return `untitled.${ext}`
}

// Classify a local filename through the same path-classifier the URL
// loader uses. Falls back to markdown for shapes the classifier returns
// null on (e.g. an extensionless basename that isn't a known plain-text
// doc) — that lets weird names still open as editable markdown rather
// than failing the open entirely. The save filter will then suggest
// `.md` for those, which is a reasonable default given we couldn't
// identify them.
export function kindForFilename(name: string): ContentKind {
  return classifyPath(name) ?? { kind: 'markdown' }
}

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
  const name = basename(path)
  setDocState(text, name, { kind: 'tauri-path', path }, kindForFilename(name))
  harness.replaceDoc(text)
}

async function openViaTauri(harness: Harness): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: false,
    directory: false,
    filters: tauriFilterOpen(),
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
    const handles = await show({ multiple: false, types: fsaAcceptOpen() })
    handle = handles[0]!
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return
    throw err
  }
  const file = await handle.getFile()
  const text = await file.text()
  setDocState(text, file.name, { kind: 'fsa', handle }, kindForFilename(file.name))
  harness.replaceDoc(text)
}

async function openViaInputFallback(harness: Harness): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  // Widened to every extension the renderer understands. The
  // fsaAcceptOpen() / tauriFilterOpen() tables are the authoritative
  // list; we just flatten them to a comma-separated accept string here.
  const allExts = [
    ...MARKDOWN_EXTS,
    ...PLAIN_EXTS,
    ...Object.keys(SOURCE_EXT_TO_LANG),
  ]
  input.name = 'file-open'
  input.accept = [...allExts.map((e) => `.${e}`), 'text/markdown', 'text/plain'].join(',')
  input.style.display = 'none'
  document.body.appendChild(input)
  await new Promise<void>((resolve) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (file) {
        const text = await file.text()
        // No save-back path in this fallback — record name only.
        setDocState(text, file.name, null, kindForFilename(file.name))
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
  const kind = currentContentKind
  const path = await save({
    defaultPath: currentSource && currentSource.kind === 'tauri-path'
      ? currentSource.path
      : (currentName ?? defaultSaveName(kind)),
    filters: tauriFilterForKind(kind),
  })
  if (typeof path !== 'string') return
  await writeTextFile(path, text)
  const name = basename(path)
  setDocState(text, name, { kind: 'tauri-path', path }, kindForFilename(name))
}

async function saveAsViaFsa(
  text: string,
  show: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>,
): Promise<void> {
  const kind = currentContentKind
  let handle: FileSystemFileHandle
  try {
    handle = await show({
      suggestedName: currentName ?? defaultSaveName(kind),
      types: [fsaAcceptForKind(kind)],
    })
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return
    throw err
  }
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
  const file = await handle.getFile()
  setDocState(text, file.name, { kind: 'fsa', handle }, kindForFilename(file.name))
}

function saveAsViaDownload(text: string): void {
  const kind = currentContentKind
  const blob = new Blob([text], { type: mimeForKind(kind) })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = currentName ?? defaultSaveName(kind)
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
