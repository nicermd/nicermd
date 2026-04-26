// Theme system. Each theme is a slug + display name + light/dark mode.
// All actual colour and font values live in main.css under
// [data-theme="..."] blocks; this module just flips that attribute and
// persists the choice. CodeMirror's editor theme and HighlightStyle are
// defined with var(--cm-*) values, so CM picks up the same swap with no
// Compartment dispatch.

export type ThemeMode = 'light' | 'dark'

export interface Theme {
  slug: string
  name: string
  mode: ThemeMode
}

export const THEMES: readonly Theme[] = [
  { slug: 'default', name: 'Default', mode: 'light' },
  { slug: 'nicer', name: 'Nicer', mode: 'light' },
  { slug: 'nicer-dark', name: 'Nicer Dark', mode: 'dark' },
  { slug: 'paper', name: 'Paper', mode: 'light' },
  { slug: 'terminal-light', name: 'Terminal Light', mode: 'light' },
  { slug: 'terminal-dark', name: 'Terminal Dark', mode: 'dark' },
]

const STORAGE_KEY = 'nicermd:theme'
const DEFAULT_SLUG = 'default'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(slug: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, slug)
  } catch {
    // localStorage may be unavailable (private mode, etc.). Silent fail —
    // theme stays in memory for the session.
  }
}

function findBySlug(slug: string | null | undefined): Theme {
  if (!slug) return THEMES[0]!
  return THEMES.find((t) => t.slug === slug) ?? THEMES[0]!
}

export function getActiveTheme(): Theme {
  const slug = document.documentElement.dataset.theme
  return findBySlug(slug)
}

export function applyTheme(slug: string, persist: boolean = true): Theme {
  const theme = findBySlug(slug)
  document.documentElement.dataset.theme = theme.slug
  if (persist) writeStored(theme.slug)
  return theme
}

// Initialise on boot. Restore from localStorage if present, else use the
// configured default. (prefers-color-scheme integration is deferred to a
// later iteration — for the spike a hardcoded default keeps the surface
// area small.)
export function initTheme(): Theme {
  return applyTheme(readStored() ?? DEFAULT_SLUG, false)
}

export function cycleTheme(): Theme {
  const current = getActiveTheme()
  const idx = THEMES.findIndex((t) => t.slug === current.slug)
  const next = THEMES[(idx + 1) % THEMES.length]!
  return applyTheme(next.slug)
}

// --- Toast ----------------------------------------------------------------
// Brief corner pill that announces the active theme on cycle. Inspired by
// the v1 N-badge fade pattern. ~1.5s show, 200ms fade.

let toastEl: HTMLDivElement | null = null
let toastTimer: number | null = null

export function showThemeToast(theme: Theme): void {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'theme-toast'
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = theme.name
  toastEl.classList.add('theme-toast--visible')
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastEl?.classList.remove('theme-toast--visible')
  }, 1500)
}
