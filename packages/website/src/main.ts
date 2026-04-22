import { render, getTheme } from 'nicermd-core'
import { CANONICAL_DOMAIN } from './config.js'

const INITIAL = `# Nicer.md

A beautiful, zero-server markdown reader.

This is the walking skeleton — paste anything below to see it rendered.

- One rendering core, many thin shells
- Themes as CSS custom properties
- Privacy-respecting: no trackers, no server logic

> Drop a \`.md\` file here, paste markdown, or just start typing.

\`\`\`ts
import { render } from 'nicermd-core'
const html = render('# hello')
\`\`\`

Visit [${CANONICAL_DOMAIN}](https://${CANONICAL_DOMAIN}) for the hosted version.
`

const LAYOUT_CSS = `
html, body, #app { height: 100%; }
body { margin: 0; }
.app-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100vh;
}
.app-input {
  width: 100%;
  height: 100%;
  border: none;
  border-right: 1px solid var(--nicer-code-border);
  padding: 1.25rem;
  font-family: var(--nicer-font-mono);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  background: var(--nicer-bg-secondary);
  color: var(--nicer-text);
  box-sizing: border-box;
}
.app-output {
  overflow-y: auto;
  height: 100%;
}
@media (max-width: 720px) {
  .app-layout { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .app-input { border-right: none; border-bottom: 1px solid var(--nicer-code-border); }
}
`

function escapeForTextarea(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function mount(root: HTMLElement): void {
  const theme = getTheme('default')

  // Constructable stylesheets — no inline <style>, strict-CSP friendly.
  const themeSheet = new CSSStyleSheet()
  themeSheet.replaceSync(theme.css)
  const layoutSheet = new CSSStyleSheet()
  layoutSheet.replaceSync(LAYOUT_CSS)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet, layoutSheet]

  root.innerHTML = `
    <div class="app-layout">
      <textarea class="app-input" spellcheck="false">${escapeForTextarea(INITIAL)}</textarea>
      <div class="app-output">
        <article class="nicer-doc" id="nicer-output"></article>
      </div>
    </div>
  `

  const input = root.querySelector<HTMLTextAreaElement>('.app-input')!
  const output = root.querySelector<HTMLElement>('#nicer-output')!

  const update = (): void => {
    output.innerHTML = render(input.value)
  }

  input.addEventListener('input', update)
  update()
}

const appRoot = document.getElementById('app')
if (appRoot) mount(appRoot)
