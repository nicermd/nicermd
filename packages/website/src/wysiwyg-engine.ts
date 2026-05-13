// Tiptap-based WYSIWYG engine for mode 2. Loaded lazily — main.ts calls
// `await import('./wysiwyg-engine')` only when the user first enters mode 2.
// Vite emits this whole module + Tiptap + ProseMirror + tiptap-markdown as
// a single chunk that's cached after the first fetch.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Image } from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { parkHtml, unparkHtml, sanitizeHtml } from 'nicermd-core'

// Format actions exposed to the format bar / future palette. Names map
// 1:1 to Tiptap commands, with `h1`/`h2` flattening the level argument
// for ergonomics at call sites. `link` is the one outlier — it needs
// a URL prompt when setting, no prompt when clearing.
export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'h1'
  | 'h2'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'code'
  | 'link'

export interface WysiwygHandle {
  destroy(): void
  getMarkdown(): string
  toggleFormat(action: FormatAction): void
  isFormatActive(action: FormatAction): boolean
  onFormatUpdate(cb: () => void): () => void
}

// Sentinel info-string shared with nicermd-core's parkHtml. Block HTML
// in the source is wrapped in a fenced code block with this language;
// the node view below renders those blocks as their sanitised HTML
// preview so the user still sees the original visual in Write mode,
// while the underlying code block stays opaque on round-trip.
const PARK_LANG = '__nicermd_html__'

export interface WysiwygOptions {
  // Resolves relative href / src inside parked-HTML previews. Matches
  // the baseUrl render() accepts so URL-loaded docs whose scaffolding
  // points at e.g. `.github/splash.png` resolve correctly.
  baseUrl?: string
}

export function createWysiwyg(
  parent: HTMLElement,
  markdown: string,
  onChange?: (markdown: string) => void,
  options: WysiwygOptions = {},
): WysiwygHandle {
  const baseUrl = options.baseUrl

  // Extended CodeBlock with a node view that branches on language:
  // - For parked-HTML blocks: render an inert sanitised preview so the
  //   user sees the rendered content (logo, badges, headings) and not
  //   the raw <div> source.
  // - For everything else: ordinary <pre><code> with a contentDOM that
  //   ProseMirror manages — same as the default behaviour.
  // Defined inside createWysiwyg so the node view closes over baseUrl;
  // moving it to module scope would lose per-doc URL resolution.
  const HtmlAwareCodeBlock = CodeBlock.extend({
    addNodeView() {
      return ({ node }) => {
        if (node.attrs.language === PARK_LANG) {
          const dom = document.createElement('div')
          dom.className = 'nicermd-parked-html-preview'
          dom.contentEditable = 'false'
          dom.innerHTML = sanitizeHtml(node.textContent, { baseUrl })
          return { dom }
        }
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        if (node.attrs.language) {
          code.className = `language-${node.attrs.language as string}`
        }
        pre.appendChild(code)
        return { dom: pre, contentDOM: code }
      }
    },
  })

  // Resolve relative src against baseUrl at render time. Same intent as
  // rewriteRelativeUrls in nicermd-core, but applied in the editor DOM
  // only — the ProseMirror node attrs keep the original relative path
  // so save-out matches the source file byte-for-byte. Without this,
  // markdown `![](.github/cover.png)` in a URL-loaded README renders as
  // a broken image in Write mode (browser resolves against the app
  // origin, not the README's origin).
  const ABSOLUTE_OR_SAME_DOC_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|[#?])/i
  const resolveSrc = (src: string): string => {
    if (!baseUrl || !src || ABSOLUTE_OR_SAME_DOC_RE.test(src)) return src
    try {
      return new URL(src, baseUrl).href
    } catch {
      return src
    }
  }
  const BaseUrlAwareImage = Image.extend({
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('img')
        const src = (node.attrs.src as string | null) ?? ''
        dom.src = resolveSrc(src)
        const alt = node.attrs.alt as string | null
        if (alt) dom.alt = alt
        const title = node.attrs.title as string | null
        if (title) dom.title = title
        return { dom }
      }
    },
  })
  // Park block HTML in fenced code blocks before Tiptap sees it. The
  // code-block primitive is one of the few Markdown constructs Tiptap
  // round-trips byte-for-byte, so wrapping HTML in it neutralises the
  // serialiser-mangling problem entirely — even mid-edit. unparkHtml
  // on the way out restores the original HTML.
  const originalMarkdown = markdown
  const parked = parkHtml(markdown)
  let isDirty = false

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        // Default opens links on click — fights editing. Off here so a
        // click-through happens via the format bar / keyboard later.
        link: { openOnClick: false },
        // Replaced below with HtmlAwareCodeBlock that swaps the node
        // view for our parked-HTML language.
        codeBlock: false,
      }),
      HtmlAwareCodeBlock,
      // Markdown images — StarterKit v3 doesn't bundle the Image node,
      // so markdown like `![alt](src)` (and the linked-image badge
      // pattern used in most READMEs) renders as nothing without this.
      // inline:false keeps images as block-level for paragraph layout
      // parity with Read mode.
      // The node view resolves relative src against baseUrl in the DOM
      // only — the underlying ProseMirror attrs (and therefore the
      // serialised markdown on save) keep the original relative form.
      // Without this, README cover/badge images load from
      // localhost:3333/<path> and show broken icons in Write mode.
      BaseUrlAwareImage.configure({ inline: false, allowBase64: false }),
      // GFM tables — StarterKit doesn't bundle these, so add them
      // explicitly. resizable lets users drag column borders.
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: parked,
    onUpdate: ({ editor: ed }) => {
      isDirty = true
      if (!onChange) return
      const storage = (ed.storage as unknown as { markdown: MarkdownStorage }).markdown
      onChange(unparkHtml(storage.getMarkdown()))
    },
  })

  // tiptap-markdown attaches `markdown` to editor.storage at runtime; the
  // Tiptap core `Storage` type doesn't carry that knowledge. One unknown-cast
  // gets us to the typed shape.
  const markdownStorage = (editor.storage as unknown as { markdown: MarkdownStorage }).markdown

  // Each action takes the editor itself so link can branch on the
  // current state (clear vs. prompt + set) without pretending to fit
  // the chain shape of the other commands.
  const ACTIONS: Record<FormatAction, () => void> = {
    bold: () => void editor.chain().focus().toggleBold().run(),
    italic: () => void editor.chain().focus().toggleItalic().run(),
    strike: () => void editor.chain().focus().toggleStrike().run(),
    h1: () => void editor.chain().focus().toggleHeading({ level: 1 }).run(),
    h2: () => void editor.chain().focus().toggleHeading({ level: 2 }).run(),
    bulletList: () => void editor.chain().focus().toggleBulletList().run(),
    orderedList: () => void editor.chain().focus().toggleOrderedList().run(),
    blockquote: () => void editor.chain().focus().toggleBlockquote().run(),
    code: () => void editor.chain().focus().toggleCode().run(),
    link: () => {
      if (editor.isActive('link')) {
        editor.chain().focus().unsetLink().run()
        return
      }
      const url = window.prompt('Link URL:')
      if (!url) return
      editor.chain().focus().setLink({ href: url }).run()
    },
  }

  // For active-state queries, most actions map to a single Tiptap mark /
  // node name. Headings need the level attribute to disambiguate.
  const queryActive = (action: FormatAction): boolean => {
    switch (action) {
      case 'h1': return editor.isActive('heading', { level: 1 })
      case 'h2': return editor.isActive('heading', { level: 2 })
      default: return editor.isActive(action)
    }
  }

  return {
    destroy: () => editor.destroy(),
    // Clean exit (no edits): return the original markdown untouched —
    // no parse/serialise round-trip, no parking residue. Dirty exit:
    // pull Tiptap's serialised output and strip the parking fences so
    // the saved file looks like the source again (HTML in HTML, not in
    // code blocks).
    getMarkdown: () =>
      isDirty ? unparkHtml(markdownStorage.getMarkdown()) : originalMarkdown,
    toggleFormat: (action) => ACTIONS[action](),
    isFormatActive: (action) => queryActive(action),
    onFormatUpdate: (cb) => {
      editor.on('selectionUpdate', cb)
      editor.on('update', cb)
      return () => {
        editor.off('selectionUpdate', cb)
        editor.off('update', cb)
      }
    },
  }
}
