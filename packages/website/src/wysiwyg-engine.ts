// Tiptap-based WYSIWYG engine for mode 2. Loaded lazily — main.ts calls
// `await import('./wysiwyg-engine')` only when the user first enters mode 2.
// Vite emits this whole module + Tiptap + ProseMirror + tiptap-markdown as
// a single chunk that's cached after the first fetch.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { normalizeHtml } from 'nicermd-core'

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

export function createWysiwyg(
  parent: HTMLElement,
  markdown: string,
  onChange?: (markdown: string) => void,
): WysiwygHandle {
  // Normalise on input so Tiptap sees converted markdown (real image
  // nodes, not unparseable HTML soup) — round-trip is then identity-
  // stable for the patterns we recognise. The original is preserved
  // separately so an unedited toggle can return it byte-for-byte.
  const originalMarkdown = markdown
  const normalised = normalizeHtml(markdown)
  let isDirty = false

  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit.configure({
        // Default opens links on click — fights editing. Off here so a
        // click-through happens via the format bar / keyboard later.
        link: { openOnClick: false },
      }),
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
    content: normalised,
    onUpdate: ({ editor: ed }) => {
      isDirty = true
      if (!onChange) return
      const storage = (ed.storage as unknown as { markdown: MarkdownStorage }).markdown
      onChange(storage.getMarkdown())
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
    // If the user never edited, return the original markdown untouched.
    // This is what keeps "toggle into Write and back without editing"
    // from rewriting HTML scaffolding the user didn't ask to change —
    // the dominant flow on read-only browsing of a README. Only when
    // the user has actually edited do we commit Tiptap's serialised
    // output (which operates on the normalised input, so the resulting
    // diff is at least clean: <img> → ![]() rather than escape-mangled
    // text).
    getMarkdown: () => (isDirty ? markdownStorage.getMarkdown() : originalMarkdown),
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
