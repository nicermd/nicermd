// Tiptap-based WYSIWYG engine for mode 2. Loaded lazily — main.ts calls
// `await import('./wysiwyg-engine')` only when the user first enters mode 2.
// Vite emits this whole module + Tiptap + ProseMirror + tiptap-markdown as
// a single chunk that's cached after the first fetch.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'

export interface WysiwygHandle {
  destroy(): void
  getMarkdown(): string
}

export function createWysiwyg(parent: HTMLElement, markdown: string): WysiwygHandle {
  const editor = new Editor({
    element: parent,
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: markdown,
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
