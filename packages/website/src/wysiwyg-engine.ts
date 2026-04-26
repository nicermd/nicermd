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

export interface WysiwygHandle {
  destroy(): void
  getMarkdown(): string
}

export function createWysiwyg(
  parent: HTMLElement,
  markdown: string,
  onChange?: (markdown: string) => void,
): WysiwygHandle {
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
    content: markdown,
    onUpdate: ({ editor: ed }) => {
      if (!onChange) return
      const storage = (ed.storage as unknown as { markdown: MarkdownStorage }).markdown
      onChange(storage.getMarkdown())
    },
  })

  // tiptap-markdown attaches `markdown` to editor.storage at runtime; the
  // Tiptap core `Storage` type doesn't carry that knowledge. One unknown-cast
  // gets us to the typed shape.
  const markdownStorage = (editor.storage as unknown as { markdown: MarkdownStorage }).markdown

  return {
    destroy: () => editor.destroy(),
    getMarkdown: () => markdownStorage.getMarkdown(),
  }
}
