export type ThemeMode = 'light' | 'dark'

export interface Theme {
  name: string
  slug: string
  description: string
  mode: ThemeMode
  css: string
}

const DEFAULT_CSS = `:root {
  --nicer-bg: #ffffff;
  --nicer-bg-secondary: #f4f4f5;
  --nicer-font-body: system-ui, -apple-system, sans-serif;
  --nicer-font-heading: var(--nicer-font-body);
  --nicer-font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, 'SF Mono', Menlo, monospace;
  --nicer-font-size-base: 16px;
  --nicer-line-height: 1.7;
  --nicer-max-width: 720px;
  --nicer-text: #1a1a1a;
  --nicer-text-muted: #666;
  --nicer-heading: #111;
  --nicer-link: #2563eb;
  --nicer-link-hover: #1d4ed8;
  --nicer-code-bg: #f4f4f5;
  --nicer-code-text: #18181b;
  --nicer-code-border: #e4e4e7;
  --nicer-blockquote-border: #d4d4d8;
  --nicer-blockquote-text: #52525b;
  --nicer-hr-color: #e4e4e7;
  --nicer-table-border: #e4e4e7;
  --nicer-table-header-bg: #f4f4f5;
  --nicer-table-stripe-bg: #fafafa;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--nicer-bg);
  color: var(--nicer-text);
  font-family: var(--nicer-font-body);
  font-size: var(--nicer-font-size-base);
  line-height: var(--nicer-line-height);
}

.nicer-doc {
  max-width: var(--nicer-max-width);
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

.nicer-doc h1,
.nicer-doc h2,
.nicer-doc h3,
.nicer-doc h4,
.nicer-doc h5,
.nicer-doc h6 {
  color: var(--nicer-heading);
  font-family: var(--nicer-font-heading);
  line-height: 1.25;
  margin: 2em 0 0.6em;
}
.nicer-doc h1 { font-size: 2em; font-weight: 700; margin-top: 0; }
.nicer-doc h2 { font-size: 1.5em; font-weight: 700; }
.nicer-doc h3 { font-size: 1.25em; font-weight: 600; }
.nicer-doc h4,
.nicer-doc h5,
.nicer-doc h6 { font-size: 1.05em; font-weight: 600; }

.nicer-doc p { margin: 0 0 1em; }

.nicer-doc a {
  color: var(--nicer-link);
  text-decoration: none;
}
.nicer-doc a:hover {
  color: var(--nicer-link-hover);
  text-decoration: underline;
}

.nicer-doc code {
  background: var(--nicer-code-bg);
  color: var(--nicer-code-text);
  border: 1px solid var(--nicer-code-border);
  border-radius: 4px;
  padding: 0.125em 0.375em;
  font-family: var(--nicer-font-mono);
  font-size: 0.9em;
}

.nicer-doc pre {
  background: var(--nicer-code-bg);
  border: 1px solid var(--nicer-code-border);
  border-radius: 6px;
  padding: 1em;
  overflow-x: auto;
  margin: 1em 0;
}
.nicer-doc pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.92em;
}

.nicer-doc blockquote {
  border-left: 3px solid var(--nicer-blockquote-border);
  color: var(--nicer-blockquote-text);
  margin: 1em 0;
  padding: 0.25em 1em;
  font-style: italic;
}

.nicer-doc hr {
  border: none;
  border-top: 1px solid var(--nicer-hr-color);
  margin: 2em 0;
}

.nicer-doc ul,
.nicer-doc ol {
  padding-left: 1.5em;
  margin: 0 0 1em;
}
.nicer-doc li { margin: 0.25em 0; }

.nicer-doc img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em 0;
  border-radius: 6px;
}

.nicer-doc table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}
.nicer-doc th,
.nicer-doc td {
  border: 1px solid var(--nicer-table-border);
  padding: 0.5em 0.75em;
  text-align: left;
}
.nicer-doc th {
  background: var(--nicer-table-header-bg);
  font-weight: 600;
}
.nicer-doc tbody tr:nth-child(even) {
  background: var(--nicer-table-stripe-bg);
}
`

const THEMES: Record<string, Theme> = {
  default: {
    name: 'Default',
    slug: 'default',
    description: 'Clean system sans-serif on soft off-white. Quiet and restrained.',
    mode: 'light',
    css: DEFAULT_CSS,
  },
}

export function getTheme(slug = 'default'): Theme {
  const theme = THEMES[slug]
  if (!theme) throw new Error(`Unknown theme: ${slug}`)
  return theme
}

export function getThemes(): Theme[] {
  return Object.values(THEMES)
}
