// Hybrid-engine harness with hot-swapped editors across four modes.
//
// Mode order (nicest → least nice):
//   1 Read              nicermd-core HTML, no editor
//   2 WYSIWYG           Tiptap (lazy-loaded on first enter)
//   3 Code + preview    CM source + nicermd-core preview, live-updating
//   4 Raw code          CM, syntax highlighting only
//
// Each mode is a function (parent, markdown) → ModeHandle. Switching:
// capture text via getMarkdown(), destroy(), mount the next mode with the
// captured text. Cmd/Ctrl + 1..4 jumps directly; Cmd/Ctrl+Shift+M cycles.
//
// Dev-only aids (cross-tab broadcast sync, mode label pill, ?freeze=1,
// stress.md as boot doc) live in ./dev-features. They're loaded lazily
// and only when `import.meta.env.DEV && ?dev=1` — production builds
// tree-shake the entire dev module out.

import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, drawSelection, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { render as renderMarkdown, renderPlain, renderSource } from 'nicermd-core'

import showcase from './samples/showcase.md?raw'
import { IS_MAC, PLATFORM } from './platform'
import { stripPlatformBlocks } from './platform-blocks'
import { setupTauriBridge } from './tauri-bridge'
import { setupLinkContextMenu } from './link-context-menu'
import { setupFileDrop } from './file-drop'
import { openFile, saveFile, newFile, setDocState, isDirty, markDirty, getCurrentSourceUrl, getContentKind } from './doc-source'
import { setupAutosave, checkRecovery } from './autosave'
import { setupModeIcons } from './mode-icons'
import { setupTitle } from './title'
import { setupVersionBadge } from './version-badge'
import { setupZoom, zoomIn, zoomOut, zoomReset, isTauri as isZoomTauri } from './zoom'
import { initTheme, toggleRecentTheme, showThemeToast } from './themes'
import { initFonts } from './fonts'
import { openFontPicker } from './font-picker'
import { openUrlPrompt, processBootUrlParam } from './url-open'
import { setupLinkChaining, showNoticeBanner } from './link-chain'
import { openThemePicker } from './theme-picker'
import { registerServiceWorker } from './sw-register'
import { setupScrollStrip, showStrip } from './scroll-strip'
import { setupFormatBar } from './format-bar'
import { setupCommandPalette } from './command-palette'
import { setupTouchSwipe } from './touch-swipe'
import { cycleOption } from './option-flag'
import type { FormatAction } from './wysiwyg-engine'
import type { FindAdapter } from './find/types'
import { createDomFindAdapter } from './find/dom-walker'
import { createCmFindAdapter } from './find/cm'
import { openFindBar, closeFindBar, isFindBarOpen } from './find-bar'
import {
  persistMode,
  readPersistedMode,
  readPersistedSource,
} from './per-window-state'
import './main.css'

const THEME_STORAGE_KEY = 'nicermd:theme'

interface ModeHandle {
  destroy(): void
  getMarkdown(): string
  // Optional — only modes that can re-render without disturbing user
  // editing state implement this. Used by dev-features for cross-tab
  // updates; production code paths don't currently call it.
  setMarkdown?: (markdown: string) => void
  // Optional — modes that support format commands (currently mode 2 /
  // WYSIWYG) implement these. The format bar is the only consumer.
  toggleFormat?: (action: FormatAction) => void
  isFormatActive?: (action: FormatAction) => boolean
  onFormatUpdate?: (cb: () => void) => () => void
  // Per-mode Cmd+F adapter. Returns null when the mode's underlying
  // surface isn't ready yet (Write mode while Tiptap is still
  // lazy-loading); the find bar will simply not open in that case
  // and the user can re-trigger Cmd+F a moment later.
  createFindAdapter?(): FindAdapter | null
}

type OnChange = (markdown: string) => void

interface ModeDef {
  key: number
  label: string
  mount: (parent: HTMLElement, markdown: string, onChange?: OnChange) => ModeHandle
}

// Markdown source highlight palette — colours come from CSS variables so
// the active theme drives them. Tokens: markers (#, **, *, _, `, ~~, list
// bullets, --- rules) → --cm-marker. Heading text, inline code, link text,
// URLs, quotes each get their own var. The theme system flips the data-
// attribute on <html>; CM picks up the change via the cascading vars.
const mdHighlight = HighlightStyle.define([
  { tag: t.processingInstruction, color: 'var(--cm-marker)' },
  { tag: t.contentSeparator, color: 'var(--cm-marker)' },
  { tag: t.heading1, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading2, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading3, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading4, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading5, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading6, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--cm-link)' },
  { tag: t.url, color: 'var(--cm-url)' },
  { tag: t.monospace, color: 'var(--cm-monospace)' },
  { tag: t.quote, color: 'var(--cm-quote)' },
  { tag: t.meta, color: 'var(--cm-marker)' },
])

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--cm-bg)',
    color: 'var(--cm-fg)',
    fontFamily: 'var(--font-code)',
    fontSize: '13px',
    lineHeight: '1.55',
  },
  '.cm-content': {
    // Pin colour explicitly rather than relying on inheritance from
    // `&` (.cm-editor). Why: WebKit's `-webkit-user-modify:
    // read-write-plaintext-only` (which CodeMirror's base styles
    // apply to .cm-content[contenteditable=true]) strips inherited
    // colour from the editable region. With a syntaxHighlighting
    // extension active (markdown mode), every visible token is
    // wrapped in its own span, so inheritance gets reasserted per-
    // token and the bug stays invisible. For non-markdown content
    // we removed the highlighter, exposing the bug. Explicit colour
    // here fixes both paths and survives future highlighter changes.
    color: 'var(--cm-fg)',
    caretColor: 'var(--cm-caret)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--cm-caret)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--cm-selection)',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--cm-gutter-bg)',
    border: 'none',
    color: 'var(--cm-gutter-fg)',
    fontFamily: 'inherit',
    fontSize: '12px',
    paddingRight: '12px',
  },
  '.cm-gutterElement': {
    padding: '0 4px 0 8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--cm-fg)',
  },
})

// Source-code highlight palette — reuses the same --cm-* vars the
// markdown highlighter uses so a theme tunes ONE palette and every
// language picks up the same per-token colours. Tag picks follow the
// hljs mapping in main.css (which Read mode already uses), so the
// editor side of mode 3 and mode 4 match the preview side's colouring:
//   keyword / bool / atom / null → --cm-marker  (structural accent)
//   string / regexp              → --cm-monospace (the "code" accent)
//   comment / docComment         → --cm-quote   (muted, italic)
//   number                       → --cm-url     (distinct accent)
//   function name / definition   → --cm-heading (prominent accent)
//   className / typeName         → --cm-marker  (treated like keywords)
//   variableName.special (self)  → --cm-link    (theme link colour)
const sourceHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cm-marker)' },
  { tag: t.atom, color: 'var(--cm-marker)' },
  { tag: t.bool, color: 'var(--cm-marker)' },
  { tag: t.null, color: 'var(--cm-marker)' },
  { tag: t.self, color: 'var(--cm-link)' },
  { tag: t.string, color: 'var(--cm-monospace)' },
  { tag: t.special(t.string), color: 'var(--cm-monospace)' },
  { tag: t.regexp, color: 'var(--cm-monospace)' },
  { tag: t.comment, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: t.docComment, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: t.number, color: 'var(--cm-url)' },
  { tag: t.function(t.variableName), color: 'var(--cm-heading)' },
  { tag: t.function(t.definition(t.variableName)), color: 'var(--cm-heading)' },
  { tag: t.definition(t.function(t.variableName)), color: 'var(--cm-heading)' },
  { tag: t.className, color: 'var(--cm-marker)' },
  { tag: t.typeName, color: 'var(--cm-marker)' },
  { tag: t.propertyName, color: 'var(--cm-link)' },
])

// Lazy language loader. Returns the dynamic-import promise for a given
// content kind, or null when no per-language extension is available
// (plain text, shell, or unknown). The caller injects the resolved
// extensions through the editor's language Compartment so the editor
// mounts immediately and upgrades to syntax-aware highlighting when
// the chunk lands. Code-split this way each lang pack only ships to
// users who open a file of that kind.
function loadLanguageExtensionsFor(kind: ContentKindLocal): Promise<Extension[]> | null {
  if (kind.kind !== 'source') return null
  const withHighlight = (ext: Extension): Extension[] => [ext, syntaxHighlighting(sourceHighlight)]
  // Each branch dynamically imports its lang pack so users only pay
  // the per-language download when they actually open a file of that
  // kind. lang-javascript handles JS/TS/JSX/TSX through dialect flags;
  // lang-html covers htm via the same parser; lang-xml covers svg.
  switch (kind.language) {
    case 'python':
      return import('@codemirror/lang-python').then(({ python }) => withHighlight(python()))
    case 'javascript':
      return import('@codemirror/lang-javascript').then(({ javascript }) => withHighlight(javascript()))
    case 'jsx':
      return import('@codemirror/lang-javascript').then(({ javascript }) => withHighlight(javascript({ jsx: true })))
    case 'typescript':
      return import('@codemirror/lang-javascript').then(({ javascript }) => withHighlight(javascript({ typescript: true })))
    case 'tsx':
      return import('@codemirror/lang-javascript').then(({ javascript }) => withHighlight(javascript({ typescript: true, jsx: true })))
    case 'json':
      return import('@codemirror/lang-json').then(({ json }) => withHighlight(json()))
    case 'css':
      return import('@codemirror/lang-css').then(({ css }) => withHighlight(css()))
    case 'html':
      return import('@codemirror/lang-html').then(({ html }) => withHighlight(html()))
    case 'xml':
    case 'svg':
      return import('@codemirror/lang-xml').then(({ xml }) => withHighlight(xml()))
    default:
      // bash/sh: no first-party CodeMirror lang pack. Falls through to
      // plain editing with the global token-colour CSS not applying.
      // Same path for any future language we don't have a pack for.
      return null
  }
}

// Local mirror — getContentKind()'s return type is ContentKind from
// url-open; redeclare narrowly here to avoid an extra import surface
// while still typing the helper above.
type ContentKindLocal =
  | { kind: 'markdown' }
  | { kind: 'plain' }
  | { kind: 'source'; language: string }

// Per-content-kind CodeMirror extensions. Markdown gets its language
// parser + the markdown highlight palette synchronously (it's needed
// by mode 2's hidden wrapper too). Source files start with an empty
// language slot via the Compartment; loadLanguageExtensionsFor() then
// reconfigures the slot with the per-language extension once its
// dynamic-import chunk arrives. Plain text stays in the empty slot.
function codeMirrorExtensions(languageCompartment: Compartment): Extension[] {
  const isMarkdown = getContentKind().kind === 'markdown'
  return [
    history(),
    drawSelection(),
    lineNumbers(),
    EditorView.lineWrapping,
    languageCompartment.of(
      isMarkdown
        ? [markdown({ extensions: [GFM] }), syntaxHighlighting(mdHighlight)]
        : [],
    ),
    editorTheme,
    // search() installs the search-query state field + the match
    // decoration view plugin (.cm-searchMatch). We deliberately
    // don't add searchKeymap so CM's built-in panel (Cmd+F opens
    // its own bar) doesn't compete with our app-level find bar
    // for the same shortcut.
    search(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ]
}

// After an editor view mounts with an empty language slot, kick off
// the per-language load and inject the result via the Compartment so
// the active view reconfigures live. Safe to call regardless of kind —
// non-source kinds resolve to null and we just leave the slot empty.
function applySourceLanguage(view: EditorView, languageCompartment: Compartment): void {
  const kind = getContentKind() as ContentKindLocal
  const loader = loadLanguageExtensionsFor(kind)
  if (!loader) return
  void loader
    .then((exts) => {
      // View may have been destroyed mid-load if the user switched
      // modes; dispatch on a dead view throws.
      if ((view as unknown as { destroyed?: boolean }).destroyed) return
      view.dispatch({ effects: languageCompartment.reconfigure(exts) })
    })
    .catch((err: unknown) => {
      console.warn('[cm] language load failed:', err)
    })
}

// Render the current document with the renderer matching its content
// kind. Markdown gets the full pipeline (parse → sanitise → relative-
// URL rewrite). Plain text and source files use the simpler dedicated
// renderers in nicermd-core. The baseUrl is only meaningful for
// markdown (relative <img src> resolution) so plain/source skip it.
function renderForCurrentKind(text: string): string {
  const kind = getContentKind()
  if (kind.kind === 'plain') return renderPlain(text)
  if (kind.kind === 'source') return renderSource(text, kind.language)
  return renderMarkdown(text, { baseUrl: getCurrentSourceUrl() ?? undefined })
}

function mountRead(parent: HTMLElement, markdown: string): ModeHandle {
  const div = document.createElement('div')
  div.className = 'mode-read'
  // Tag the read container with its content kind so main.css can
  // widen the column for `source` (long code lines breathe) while
  // keeping prose-shaped content — markdown AND plain text, both
  // typically wrapped at ~80 cols — at the reading-width default.
  div.dataset.contentKind = getContentKind().kind
  let current = markdown
  // baseUrl resolves relative href/src in URL-loaded docs (e.g. a README's
  // `images/logo.png`) against the source URL; null/undefined for local
  // and showcase docs leaves URLs untouched.
  const renderInto = (text: string): void => {
    div.innerHTML = renderForCurrentKind(text)
  }
  renderInto(current)
  parent.appendChild(div)
  return {
    destroy: () => div.remove(),
    getMarkdown: () => current,
    setMarkdown: (md) => {
      current = md
      renderInto(md)
    },
    createFindAdapter: () => createDomFindAdapter(div),
  }
}

// Cached after the first import so re-entering mode 2 is instant.
let wysiwygModule: Promise<typeof import('./wysiwyg-engine')> | null = null

function mountWysiwyg(
  parent: HTMLElement,
  initialMarkdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-wysiwyg'
  parent.appendChild(wrap)

  const surface = document.createElement('div')
  surface.className = 'mode-wysiwyg__surface'
  wrap.appendChild(surface)

  const status = document.createElement('div')
  status.className = 'mode-wysiwyg__status'
  status.textContent = 'Loading Write mode…'
  wrap.appendChild(status)

  // Mutable state so destroy() can short-circuit a still-loading mount, and
  // getMarkdown() can fall back to the original text before the engine is up.
  let destroyed = false
  let handle: import('./wysiwyg-engine').WysiwygHandle | null = null
  let latestMarkdown = initialMarkdown
  // Format-bar subscribers attach before the engine is loaded — buffer
  // them here and re-attach once `handle` is set. Same for one-shot
  // notification so the bar can refresh active states immediately.
  const pendingUpdateCallbacks = new Set<() => void>()
  const pendingDetachers = new Set<() => void>()

  if (!wysiwygModule) wysiwygModule = import('./wysiwyg-engine')
  // Warm-load the PM find module alongside the engine so Cmd+F in
  // Write mode is ready by the time the editor finishes mounting.
  // No-op if already loaded.
  if (!pmFindModule) {
    void import('./find/pm').then((m) => {
      pmFindModule = m
    })
  }

  void wysiwygModule
    .then((mod) => {
      if (destroyed) return
      status.remove()
      handle = mod.createWysiwyg(surface, latestMarkdown, onChange, {
        baseUrl: getCurrentSourceUrl() ?? undefined,
      })
      for (const cb of pendingUpdateCallbacks) {
        const detach = handle.onFormatUpdate(cb)
        pendingDetachers.add(detach)
        cb()
      }
      pendingUpdateCallbacks.clear()
    })
    .catch((err: unknown) => {
      if (destroyed) return
      status.textContent = `Write mode failed to load: ${String(err)}`
    })

  return {
    destroy: () => {
      destroyed = true
      for (const detach of pendingDetachers) detach()
      pendingDetachers.clear()
      pendingUpdateCallbacks.clear()
      if (handle) handle.destroy()
      wrap.remove()
    },
    getMarkdown: () => (handle ? handle.getMarkdown() : latestMarkdown),
    toggleFormat: (action) => handle?.toggleFormat(action),
    isFormatActive: (action) => handle?.isFormatActive(action) ?? false,
    onFormatUpdate: (cb) => {
      if (handle) {
        const detach = handle.onFormatUpdate(cb)
        pendingDetachers.add(detach)
        return () => {
          detach()
          pendingDetachers.delete(detach)
        }
      }
      pendingUpdateCallbacks.add(cb)
      return () => {
        pendingUpdateCallbacks.delete(cb)
      }
    },
    createFindAdapter: () => {
      // If the engine is still loading (or load failed) there's no
      // editor to attach the find plugin to. Return null so the find
      // bar opens with a no-op state rather than throwing; a moment
      // later the user can re-trigger Cmd+F.
      const editor = handle?.getEditor() ?? null
      if (!editor || !pmFindModule) return null
      return pmFindModule.createPmFindAdapter(editor)
    },
  }
}

// PM find module is preloaded the first time mountWysiwyg runs (see
// below). Cached at module scope so subsequent createFindAdapter
// calls don't re-import.
let pmFindModule: typeof import('./find/pm') | null = null

function mountCodePlusPreview(
  parent: HTMLElement,
  markdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-split'
  const editorPane = document.createElement('div')
  editorPane.className = 'mode-split__editor'
  const previewPane = document.createElement('div')
  previewPane.className = 'mode-split__preview'
  wrap.append(editorPane, previewPane)
  parent.appendChild(wrap)

  const renderTo = (text: string): void => {
    previewPane.innerHTML = renderForCurrentKind(text)
  }
  renderTo(markdown)

  const languageCompartment = new Compartment()
  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      extensions: [
        ...codeMirrorExtensions(languageCompartment),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const md = update.state.doc.toString()
          renderTo(md)
          onChange?.(md)
        }),
      ],
    }),
    parent: editorPane,
  })
  applySourceLanguage(view, languageCompartment)

  return {
    destroy: () => {
      view.destroy()
      wrap.remove()
    },
    getMarkdown: () => view.state.doc.toString(),
    // Split mode's find target is the editor pane: edits originate
    // there and the preview reflects them live, so finding in the
    // source is the more useful default. (A future iteration could
    // composite a DOM walker on the preview, but the dual-current-
    // match UX gets confusing fast — defer until asked.)
    createFindAdapter: () => createCmFindAdapter(view),
  }
}

function mountRawCode(
  parent: HTMLElement,
  markdown: string,
  onChange?: OnChange,
): ModeHandle {
  const wrap = document.createElement('div')
  wrap.className = 'mode-raw'
  parent.appendChild(wrap)
  const languageCompartment = new Compartment()
  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      extensions: [
        ...codeMirrorExtensions(languageCompartment),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString())
        }),
      ],
    }),
    parent: wrap,
  })
  applySourceLanguage(view, languageCompartment)
  return {
    destroy: () => {
      view.destroy()
      wrap.remove()
    },
    getMarkdown: () => view.state.doc.toString(),
    createFindAdapter: () => createCmFindAdapter(view),
  }
}

const MODES: ModeDef[] = [
  { key: 1, label: 'Read', mount: mountRead },
  { key: 2, label: 'Write', mount: mountWysiwyg },
  { key: 3, label: 'Split', mount: mountCodePlusPreview },
  { key: 4, label: 'Code', mount: mountRawCode },
]

// Mode-switching engine. Owns no UI chrome and no cross-tab sync — those
// are layered in via callbacks (onLocalChange, onModeChange) and the
// public setMarkdown hook so dev-features.ts (or future product chrome)
// can subscribe without the harness knowing they exist.
export class Harness {
  private currentMode = 1
  private currentHandle: ModeHandle | null = null
  private currentMarkdown: string
  private localChangeListeners = new Set<OnChange>()
  private modeChangeListeners = new Set<(key: number, label: string) => void>()

  constructor(
    private readonly host: HTMLElement,
    initialMarkdown: string,
  ) {
    this.currentMarkdown = initialMarkdown
  }

  onLocalChange(cb: OnChange): void {
    this.localChangeListeners.add(cb)
  }

  offLocalChange(cb: OnChange): void {
    this.localChangeListeners.delete(cb)
  }

  onModeChange(cb: (key: number, label: string) => void): void {
    this.modeChangeListeners.add(cb)
  }

  // External markdown injection — for dev-features cross-tab sync, and
  // any future feature that needs to push text into the current mode.
  // Only modes that expose setMarkdown actually update; editing modes
  // ignore the call to preserve cursor/selection state.
  setMarkdown(md: string): void {
    this.currentMarkdown = md
    this.currentHandle?.setMarkdown?.(md)
  }

  // Hard replace the document — destroys the active mode and remounts it
  // with the new markdown. Used by drag-drop and (future) Open File so
  // editing modes (which don't implement setMarkdown) can swap content.
  replaceDoc(md: string): void {
    this.currentMarkdown = md
    if (!this.currentHandle) return
    const key = this.currentMode
    this.currentHandle.destroy()
    this.currentHandle = null
    const next = MODES.find((m) => m.key === key)
    if (!next) return
    this.currentHandle = next.mount(this.host, this.currentMarkdown, this.handleLocalChange)
  }

  getCurrentMode(): { key: number; label: string } {
    const def = MODES.find((m) => m.key === this.currentMode)
    return { key: this.currentMode, label: def?.label ?? '' }
  }

  // Live current text — pulls from the active mode if mounted (so cursor
  // edits are included), otherwise falls back to the cached value.
  getMarkdown(): string {
    return this.currentHandle?.getMarkdown() ?? this.currentMarkdown
  }

  // Build a fresh find adapter against the current mode's surface.
  // Returns null when the mode doesn't implement find or its surface
  // isn't ready (Write mode mid-load). The caller is the find bar.
  createFindAdapter(): FindAdapter | null {
    return this.currentHandle?.createFindAdapter?.() ?? null
  }

  private readonly handleLocalChange = (md: string): void => {
    this.currentMarkdown = md
    this.localChangeListeners.forEach((cb) => cb(md))
  }

  // In-flight mode-switch animation timer. The transition splits into
  // a 150ms leave + 150ms enter; the timer fires at the midpoint to
  // swap content. If a second switch arrives during the first one's
  // leave phase, we cancel the pending swap and start fresh.
  private transitionTimer: number | null = null

  // Animate the .mode-host on every mode change so the swap reads as a
  // signal rather than an instant content jump (the Read↔Write pair
  // looks near-identical otherwise). Two styles:
  //
  //   - 'slide' (~300ms, directional) — only the touch-swipe handler
  //     triggers this. Matches the gesture: content slides 20px out in
  //     the direction your finger moved, then the new content slides
  //     in from the opposite side. Reads as causal because the user's
  //     own movement initiated it.
  //   - 'fade' (~120ms, default) — keyboard shortcuts, mode-icon
  //     clicks, and Cmd+Shift+M cycle. Discrete deliberate actions
  //     don't have a gesture direction to match, and a 300ms slide
  //     reads as delay rather than signal there. A quick opacity dip
  //     is short enough not to feel laggy but visible enough to
  //     confirm the swap, especially for Read↔Write.
  //
  // Direction (slide only) defaults to: target > current → 'forward'.
  // cycle / cyclePrevious override to handle the wrap edges.
  // prefers-reduced-motion users skip the animation entirely.
  switchTo(
    key: number,
    direction?: 'forward' | 'backward',
    style: 'fade' | 'slide' = 'fade',
  ): void {
    if (key === this.currentMode && this.currentHandle) return
    // Defence in depth — Write mode is hidden for non-markdown docs, but
    // also block the Cmd+2 shortcut, command palette, and direct clicks
    // from landing on it. Cycle paths route through nextAllowedMode so
    // they never reach this branch — meaning every caller that does is
    // a deliberate user action (Cmd+2, palette, click on hidden icon)
    // and deserves a discreet notice rather than a silent no-op.
    // Modes 2 (Write/Tiptap) and 3 (Split: editor + live preview) are
    // markdown-only. Tiptap's serialiser would mangle non-markdown text,
    // and the Split preview has nothing transformative to show for code
    // (it's the same hljs render as Read mode, just narrower) — the
    // editor and preview show effectively the same content, so the
    // split adds friction without adding value. Read (1) and Code (4)
    // stay available; the notice points the user at those.
    if ((key === 2 || key === 3) && getContentKind().kind !== 'markdown') {
      showNoticeBanner('Markdown-only mode. Use mode 1 to read or mode 4 to edit.')
      return
    }
    const dir = direction ?? (key > this.currentMode ? 'forward' : 'backward')
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    // First mount or reduced-motion: skip the animation entirely.
    if (!this.currentHandle || reducedMotion) {
      this.doSwitch(key)
      return
    }
    if (this.transitionTimer !== null) {
      window.clearTimeout(this.transitionTimer)
      this.transitionTimer = null
    }
    const allClasses = [
      'mode-host--leave-forward',
      'mode-host--leave-backward',
      'mode-host--enter-forward',
      'mode-host--enter-backward',
      'mode-host--fade-out',
      'mode-host--fade-in',
    ]
    this.host.classList.remove(...allClasses)
    const leaveClass =
      style === 'slide' ? `mode-host--leave-${dir}` : 'mode-host--fade-out'
    const enterClass =
      style === 'slide' ? `mode-host--enter-${dir}` : 'mode-host--fade-in'
    // Slide takes 150ms each half; fade is 60ms each half. Total visual
    // span is 300ms for slide, 120ms for fade.
    const halfDuration = style === 'slide' ? 150 : 60
    this.host.classList.add(leaveClass)
    this.transitionTimer = window.setTimeout(() => {
      this.transitionTimer = null
      this.doSwitch(key)
      this.host.classList.remove(leaveClass)
      this.host.classList.add(enterClass)
    }, halfDuration)
  }

  private doSwitch(key: number): void {
    if (this.currentHandle) {
      this.currentMarkdown = this.currentHandle.getMarkdown()
      this.currentHandle.destroy()
      this.currentHandle = null
    }
    const next = MODES.find((m) => m.key === key)
    if (!next) return
    this.currentMode = key
    this.currentHandle = next.mount(
      this.host,
      this.currentMarkdown,
      this.handleLocalChange,
    )
    this.modeChangeListeners.forEach((cb) => cb(key, next.label))
  }

  cycle(style: 'fade' | 'slide' = 'fade'): void {
    const next = this.nextAllowedMode(this.currentMode, 1)
    // Pass 'forward' explicitly so the 4 → 1 wrap reads as forward
    // (key comparison would infer 'backward' from target < current).
    this.switchTo(next, 'forward', style)
  }

  // Reverse cycle — touch swipe-right maps to this. Same wrap logic
  // as cycle() but stepping backward (1 → 4, 2 → 1, …). Passes
  // 'backward' to override the wrap-direction inference.
  cyclePrevious(style: 'fade' | 'slide' = 'fade'): void {
    const prev = this.nextAllowedMode(this.currentMode, -1)
    this.switchTo(prev, 'backward', style)
  }

  // Step forward/backward through modes, skipping ones that switchTo
  // would refuse (Write/key=2 and Split/key=3 when the doc isn't
  // markdown). Without the skip, cycling past those modes on a non-
  // markdown doc would stall on the current mode because switchTo
  // would silently no-op + show a notice the cycle didn't intend.
  private nextAllowedMode(from: number, step: 1 | -1): number {
    let candidate = from
    for (let i = 0; i < MODES.length; i++) {
      candidate = ((candidate - 1 + step + MODES.length) % MODES.length) + 1
      if ((candidate === 2 || candidate === 3) && getContentKind().kind !== 'markdown') continue
      return candidate
    }
    return from
  }

  // Format command surface — delegates to the active mode handle if it
  // implements the optional methods (currently mode 2 / WYSIWYG).
  // Returns no-ops elsewhere so the format bar can call without
  // checking the active mode itself.
  toggleFormat(action: FormatAction): void {
    this.currentHandle?.toggleFormat?.(action)
  }
  isFormatActive(action: FormatAction): boolean {
    return this.currentHandle?.isFormatActive?.(action) ?? false
  }
  onFormatUpdate(cb: () => void): () => void {
    return this.currentHandle?.onFormatUpdate?.(cb) ?? (() => {})
  }
}

async function boot(): Promise<void> {
  initTheme()
  initFonts()
  registerServiceWorker()

  // Auto-open the theme picker on first-ever visit so users see the
  // catalog up front. Detected by absence of the localStorage key.
  let openPickerOnFirstLoad = false
  try {
    openPickerOnFirstLoad = localStorage.getItem(THEME_STORAGE_KEY) === null
  } catch {
    // localStorage may be unavailable; skip the auto-open.
  }

  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('#app root missing')
  root.innerHTML = ''

  // Title strip + mode icons are baseline UI in both shells; pinned to
  // the top, icons top-right. CSS gates display on `data-tauri="1"`,
  // so set it unconditionally. `data-shell` distinguishes the real
  // Tauri runtime from the web shell — used by future shell-specific
  // CSS (e.g. extra reserve for macOS traffic lights).
  document.documentElement.dataset.tauri = '1'
  const inTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  document.documentElement.dataset.shell = inTauri ? 'tauri' : 'web'

  // Keep `data-fullscreen` in sync with Tauri's actual window state.
  // Without this it gets stuck if the user enters / exits fullscreen
  // via macOS native controls (green button, swipe up to Mission
  // Control) instead of our Cmd+Shift+F toggle, which only updates the
  // attribute when itself fires. A stuck `'1'` hides .window-title
  // forever via [data-shell="tauri"][data-fullscreen="1"]. The resize
  // event fires on fullscreen transitions in Tauri / WebKit.
  if (inTauri) {
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const sync = async (): Promise<void> => {
        const fs = await win.isFullscreen()
        document.documentElement.dataset.fullscreen = fs ? '1' : '0'
      }
      await sync()
      await win.onResized(() => void sync())
    })()
  }

  // PWA standalone-mode chrome detection. Chrome's PWA has a 'Hide
  // title bar' toggle that doesn't change display-mode but DOES
  // collapse the chrome strip — page viewport extends to the window
  // top and Chrome overlays its controls (traffic lights / menu) on
  // our content. We can't detect the toggle via CSS, but
  // outerHeight - innerHeight is roughly the chrome height (~32-44px
  // when shown, ~0 when hidden). main.css uses
  // [data-pwa-chrome-hidden="1"] to push the mode icons down past
  // the overlay row when chrome is hidden, and back to the
  // viewport-top when chrome is shown.
  if (!inTauri) {
    const isStandalonePwa = (): boolean =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    const syncPwaChrome = (): void => {
      if (!isStandalonePwa()) {
        document.documentElement.dataset.pwaChromeHidden = '0'
        return
      }
      const chromeHeight = window.outerHeight - window.innerHeight
      document.documentElement.dataset.pwaChromeHidden = chromeHeight < 8 ? '1' : '0'
    }
    window.addEventListener('resize', syncPwaChrome)
    syncPwaChrome()
  }

  // Hide title strip + mode icons on scroll-down, restore on scroll-up.
  // Inert in mode 3 (split scrolls inside panes, not the document).
  setupScrollStrip()

  // Snapshot the persisted per-window state IMMEDIATELY, before any
  // setDocState call (which the boot path makes a few lines down with
  // a null source — that would wipe the persistedSource slot we need
  // here). Mode is unaffected by setDocState but snapshot it together
  // for symmetry.
  const bootPersistedSource = readPersistedSource()
  const bootPersistedMode = readPersistedMode()
  // Detect extension-pickup arrival synchronously: the ext-pickup
  // param gets stripped from the URL bar a few lines later (by
  // processExtensionPickup, well before the pickup async actually
  // resolves), so we have to grab this BEFORE any of that runs.
  // When set, the persistedMode application at the end of boot()
  // is skipped — extension arrivals always render in Read mode so
  // the user sees the doc they came to render, not Code/Split.
  const bootHasExtPickup = new URLSearchParams(window.location.search).has(
    'ext-pickup',
  )

  const host = document.createElement('div')
  host.className = 'mode-host'
  root.appendChild(host)

  // Showcase has two layers of platform tailoring:
  //
  //   1. `<!-- :platform mac --> ... <!-- :end -->` blocks let sections
  //      (install CTA, "open in desktop" copy) target a subset of
  //      platforms. Stripped at boot before anything renders.
  //   2. Inline code spans containing 'Cmd+' get rewritten to 'Ctrl+'
  //      on non-Mac boots — covers the keyboard shortcuts.
  //
  // Both only touch the built-in landing doc; user-loaded markdown is
  // rendered as-authored regardless.
  let bootMarkdown: string = stripPlatformBlocks(showcase, PLATFORM)
  if (!IS_MAC) {
    bootMarkdown = bootMarkdown.replace(/`([^`]*)`/g, (_m, inner: string) => `\`${inner.replace(/\bCmd\+/g, 'Ctrl+')}\``)
  }
  let harness: Harness
  // Tree-shake gate: import.meta.env.DEV is a compile-time `false` in
  // `pnpm build`, so the entire branch (and ./dev-features) is dead-code-
  // eliminated from production bundles.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev')) {
    try {
      const dev = await import('./dev-features')
      bootMarkdown = dev.bootDoc
      harness = new Harness(host, bootMarkdown)
      dev.setupDev(harness, root)
    } catch (err) {
      console.error('Dev features failed to load:', err)
      harness = new Harness(host, bootMarkdown)
    }
  } else {
    harness = new Harness(host, bootMarkdown)
  }

  // Establish the dirty baseline. Boot doc has no name — shown as
  // "Untitled" in the title; not dirty until user edits.
  setDocState(bootMarkdown, null, null)
  // markDirty must be the first onLocalChange listener so the title
  // refresh listener (added by setupTitle) reads dirty=true on user
  // edits. Set iteration follows insertion order.
  harness.onLocalChange(() => markDirty())
  setupTitle(harness, root)
  setupModeIcons(harness, root)
  setupFormatBar(harness, root)
  setupCommandPalette(harness)
  setupVersionBadge(root)
  // Touch swipe on the doc surface cycles modes. Scoped to .mode-host
  // (which `host` IS) so top chrome and bottom format bar keep their
  // own behaviour; filters in the gesture handler exclude editor
  // surfaces so text selection in Write / Code modes still works.
  setupTouchSwipe(harness, host)

  // Resurface the strip on mode change — user benefits from re-seeing
  // filename + active mode whenever the editing context shifts.
  harness.onModeChange((key) => {
    showStrip()
    // Persist per-window so a restored window comes back in the same
    // mode the user left it. localStorage key includes the window
    // label so different windows don't clobber each other.
    persistMode(key)
    // If the find bar is open across a mode switch, refresh it with
    // the new mode's adapter so highlights re-apply against the now-
    // visible surface. The old adapter's close() runs inside
    // openFindBar via the activeAdapter swap.
    if (isFindBarOpen()) {
      const adapter = harness.createFindAdapter()
      if (adapter) openFindBar(adapter)
      else closeFindBar()
    }
  })
  setupAutosave(harness)
  // Link chaining: intercept clicks on markdown-targeting links in
  // rendered docs so they load inside the reader instead of navigating
  // to raw GitHub. Must run BEFORE processBootUrlParam so the chain-
  // state marker is on the initial history entry by the time the boot
  // handler reads it. See link-chain.ts.
  setupLinkChaining(harness, host)
  // Boot-time ?url=… handler. Sits between autosave wiring and recovery
  // banner so a link-driven open prompt sits on top of (and supersedes)
  // any recovery banner — if the user clicked a share link, that's
  // probably what they want to read, not their old draft. Cancelling
  // the gate falls through to the recovery banner naturally.
  processBootUrlParam(harness)
  // Per-window source restore for relaunched Tauri windows. Uses the
  // bootPersistedSource snapshot taken at the top of boot — by now
  // the boot's setDocState(bootMarkdown, null, null) has already
  // cleared the localStorage slot. An explicit ?url= / ?ext-pickup=
  // in the address bar still wins (processBootUrlParam handled it
  // above).
  const restoredFromPersist = await restorePersistedSource(harness, bootPersistedSource)
  // Recovery banner compares against the doc that's actually mounted.
  // If we restored a persisted source, autosave should compare against
  // THAT text (so unsaved-edits-since-last-load surfaces correctly);
  // otherwise compare against the showcase / boot doc.
  checkRecovery(harness, restoredFromPersist ? harness.getMarkdown() : bootMarkdown)
  setupCloseGuard(harness)

  finish(harness)

  // Restore last-active mode AFTER finish() — finish calls
  // harness.switchTo(1) for the initial Read mount, so applying the
  // persisted mode here means we go straight from showcase-read into
  // the previously-active mode without flashing back through Read.
  // No-op when persisted mode is Read or absent.
  //
  // Extension-pickup arrivals (ext-pickup snapshotted at boot top)
  // override persisted mode: the user asked to RENDER something —
  // a URL via toolbar / right-click, or a selection via render-
  // selection — so dropping them into Code mode would defeat the
  // feature even if Code was the last-used mode for this tab label.
  if (!bootHasExtPickup && bootPersistedMode && bootPersistedMode !== 1) {
    harness.switchTo(bootPersistedMode)
  }

  if (openPickerOnFirstLoad) {
    // Defer one tick so the harness paints first; otherwise the picker
    // overlay can sit on top of an empty document for a frame.
    setTimeout(() => openThemePicker(), 0)
  }
}

// Reload the doc that was loaded in this window when it last quit.
// Returns true when something restored, false when nothing was
// persisted or an explicit URL param takes priority. The caller is
// responsible for snapshotting `persisted` BEFORE the boot setDocState
// wipes the localStorage slot — see boot() for the snapshot.
async function restorePersistedSource(
  harness: Harness,
  persisted: ReturnType<typeof readPersistedSource>,
): Promise<boolean> {
  // Explicit URL params (share link, extension pickup) supersede the
  // "last time" fallback — processBootUrlParam already handled them.
  const params = new URLSearchParams(window.location.search)
  if (params.has('url') || params.has('ext-pickup')) return false
  if (!persisted) return false
  try {
    if (persisted.kind === 'tauri-path') {
      const { openFromTauriPath } = await import('./doc-source')
      await openFromTauriPath(harness, persisted.value)
      return true
    }
    if (persisted.kind === 'url') {
      const { loadFromUrl } = await import('./url-open')
      await loadFromUrl(harness, persisted.value)
      return true
    }
  } catch (err) {
    // Surface but don't block boot — the user lands on showcase as
    // they would without the persisted source. Most common cause is
    // a moved/deleted file or transient network blip on a URL.
    console.error('[per-window-state] failed to restore source:', err)
    showNoticeBanner(
      persisted.kind === 'tauri-path'
        ? `Couldn't reopen ${persisted.name ?? 'last file'} — it may have been moved or deleted.`
        : `Couldn't refetch ${persisted.name ?? 'last URL'} — check your connection.`,
    )
  }
  return false
}

function finish(harness: Harness): void {
  harness.switchTo(1)

  // No-op outside Tauri. Inside Tauri, wires native menu events to the
  // harness so File / View / Cycle menu items dispatch the right action.
  void setupTauriBridge(harness)
  setupLinkContextMenu()

  setupFileDrop(harness)
  void setupZoom()

  window.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) return

    // Cmd/Ctrl + Alt/Option + T — open the theme picker. Uses event.code
    // because macOS Alt produces special characters (e.g. "†"), but the
    // physical key code is stable. Alt over Shift because Chrome reserves
    // Cmd+Shift+T for "reopen closed tab" and preventDefault can't override.
    if (event.altKey && event.code === 'KeyT') {
      event.preventDefault()
      openThemePicker()
      return
    }
    // Cmd/Ctrl + Alt/Option + F — open the font picker. Same rationale
    // as the theme key: Alt-modified to dodge browser-claimed
    // Cmd+Shift / Cmd-only combos. Cmd+F (no alt) is now the find bar.
    if (event.altKey && event.code === 'KeyF') {
      event.preventDefault()
      openFontPicker()
      return
    }
    // Cmd/Ctrl + F — in-document find. Reclaims the shortcut from the
    // browser's native find-in-page (which can't see into CM / Tiptap
    // / mode-render DOM reliably) and routes through the harness's
    // per-mode adapter. Re-pressing Cmd+F while the bar is open
    // re-focuses + selects the input (same as browser behaviour).
    if (!event.altKey && !event.shiftKey && event.code === 'KeyF') {
      const adapter = harness.createFindAdapter()
      if (!adapter) return
      event.preventDefault()
      openFindBar(adapter)
      return
    }
    // Cmd+Shift+Alt+O — cycle the iteration A/B flag. Tauri-friendly
    // counterpart to `?option=N` URLs: reloads into the next variant
    // (option-flag.ts persists the choice via localStorage). Must
    // precede the plain Cmd+Alt+O handler because that branch doesn't
    // check shift and would otherwise swallow the shifted combo.
    if (event.altKey && event.shiftKey && event.code === 'KeyO') {
      event.preventDefault()
      cycleOption()
      return
    }
    // Cmd/Ctrl + Alt/Option + O — open URL prompt. Slots into the
    // Cmd+Alt+letter picker family. Cmd+Shift+O is Chrome's bookmark
    // manager and Cmd+U is View-Source on most browsers (and not always
    // overridable), so Alt is the safe modifier here.
    if (event.altKey && event.code === 'KeyO') {
      event.preventDefault()
      openUrlPrompt(harness)
      return
    }
    if (event.altKey) return

    if (event.shiftKey) {
      if (event.code === 'KeyM') {
        event.preventDefault()
        harness.cycle()
        return
      }
      if (event.code === 'KeyF') {
        event.preventDefault()
        void toggleFullscreen()
        return
      }
      if (event.code === 'KeyS') {
        event.preventDefault()
        void saveFile(harness, { saveAs: true })
        return
      }
      return
    }
    // Cmd/Ctrl + 1..4 — direct mode jump. event.code over event.key so
    // the binding is stable across keyboard layouts. Mac users on
    // Safari can't use Cmd+1..4 (Safari reserves them for tab switch);
    // plain Ctrl+1..4 also fires our handler via the ctrlKey branch.
    if (
      event.code === 'Digit1' ||
      event.code === 'Digit2' ||
      event.code === 'Digit3' ||
      event.code === 'Digit4'
    ) {
      event.preventDefault()
      harness.switchTo(Number(event.code.slice(5)))
      return
    }
    if (event.code === 'KeyS') {
      event.preventDefault()
      void saveFile(harness)
      return
    }
    if (event.code === 'KeyO') {
      event.preventDefault()
      void openFile(harness)
      return
    }
    // Cmd+Return — toggle Read ↔ Write. From Read, jump into Write;
    // from Write, jump back to Read; from Split or Code, go to Write
    // (treats Cmd+Return as "go to primary edit mode").
    if (event.code === 'Enter') {
      event.preventDefault()
      const cur = harness.getCurrentMode().key
      harness.switchTo(cur === 2 ? 1 : 2)
      return
    }
    // Cmd+\ — swap between the two most recently committed themes.
    // Designed for "I have a light theme and a dark theme and want
    // to bounce between them." No-op until the user has changed
    // theme at least once.
    if (event.code === 'Backslash') {
      event.preventDefault()
      const swapped = toggleRecentTheme()
      if (swapped) showThemeToast(swapped)
      return
    }
    // Cmd+N is browser-reserved (new window) and preventDefault can't
    // override; in Tauri the File menu's accelerator handles it at OS
    // level. So we don't bind it here. Browser users get File→New via
    // future button / palette.
    // Tauri-only browser-style zoom. In plain browsers Cmd+= / Cmd+- /
    // Cmd+0 are handled natively, so we only intercept in Tauri.
    if (isZoomTauri()) {
      if (event.code === 'Equal') {
        event.preventDefault()
        void zoomIn()
        return
      }
      if (event.code === 'Minus') {
        event.preventDefault()
        void zoomOut()
        return
      }
      if (event.code === 'Digit0') {
        event.preventDefault()
        void zoomReset()
        return
      }
    }
  })
}

// Cmd/Ctrl + Shift + F — toggle fullscreen. Inside Tauri the native window
// API gives macOS-native fullscreen (menu bar hidden, dock hidden); in plain
// browser contexts the HTML5 Fullscreen API does the equivalent on the page.
// Also flips data-fullscreen on <html> so CSS can hide the title strip.
export async function toggleFullscreen(): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const fs = await win.isFullscreen()
    await win.setFullscreen(!fs)
    document.documentElement.dataset.fullscreen = !fs ? '1' : '0'
    return
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else {
    void document.documentElement.requestFullscreen()
  }
}

// Browser: beforeunload guard prompts before navigating away with unsaved
// edits. Tauri close-requested guard does the equivalent for the desktop
// window via plugin-dialog.
function setupCloseGuard(harness: Harness): void {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    setupTauriCloseGuard(harness)
    return
  }
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) {
      event.preventDefault()
      // Legacy support — modern browsers ignore this string but require
      // the assignment for the prompt to fire.
      event.returnValue = ''
    }
  })
}

async function setupTauriCloseGuard(harness: Harness): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.onCloseRequested(async (event) => {
    if (!isDirty()) return
    const { ask } = await import('@tauri-apps/plugin-dialog')
    const ok = await ask('Discard unsaved changes and quit?', {
      title: 'Nicer.md',
      kind: 'warning',
    })
    if (!ok) event.preventDefault()
  })
}

void boot()
