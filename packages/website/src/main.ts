import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { getTheme } from 'nicermd-core'
import { CANONICAL_DOMAIN } from './config.js'

import '@milkdown/prose/view/style/prosemirror.css'
import '@milkdown/prose/tables/style/tables.css'
import '@milkdown/prose/gapcursor/style/gapcursor.css'

const INITIAL = `# Nicer.md

A beautiful, zero-server markdown reader.

Type anywhere on this page — it's both the reader and the editor.

- One rendering core, many thin shells
- Themes as CSS custom properties
- Privacy-respecting: no trackers, no server logic

> Paste a \`.md\` file's contents, or just start writing.

\`\`\`ts
import { render } from 'nicermd-core'
const html = render('# hello')
\`\`\`

Visit [${CANONICAL_DOMAIN}](https://${CANONICAL_DOMAIN}) for the hosted version.
`

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

  await Editor.make()
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
}

const appRoot = document.getElementById('app')
if (appRoot) void mount(appRoot)
