import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { getTheme, getThemes } from './themes.js'

export { getTheme, getThemes }
export type { Theme, ThemeMode } from './themes.js'

export interface RenderOptions {
  theme?: string
  sanitize?: boolean
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
})

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li',
    'code', 'pre',
    'blockquote', 'em', 'strong', 'del', 's',
    'hr', 'br',
    'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
    'sup', 'sub',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|data:image\/(?:png|jpe?g|gif|webp|svg\+xml))/i,
}

export function render(markdown: string, options: RenderOptions = {}): string {
  const html = md.render(markdown)
  if (options.sanitize === false) return html
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string
}
