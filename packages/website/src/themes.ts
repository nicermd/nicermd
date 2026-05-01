// Theme system. Each theme is a slug + display name + light/dark mode.
// All actual colour and font values live in main.css under
// [data-theme="..."] blocks; this module just flips that attribute and
// persists the choice. CodeMirror's editor theme and HighlightStyle are
// defined with var(--cm-*) values, so CM picks up the same swap with no
// Compartment dispatch.

import { applyThemeFontDefaults } from './fonts'

export type ThemeMode = 'light' | 'dark'

export interface Theme {
  slug: string
  name: string
  mode: ThemeMode
  // Optional attribution for community-palette themes. Rendered as a
  // subtitle in the picker card; never used to claim authorship.
  inspiredBy?: string
  // Optional font catalogue IDs. When the user has NOT explicitly
  // picked a font in the font picker, applyTheme falls back to these
  // — so theme switching can surface a curated typography pairing
  // without overriding explicit user choice. Both reference IDs from
  // PROSE_FONTS / CODE_FONTS in fonts.ts.
  defaultProseFont?: string
  defaultCodeFont?: string
}

export const THEMES: readonly Theme[] = [
  // Headline pair — Atom's One Light / One Dark. Polished, mature
  // palettes with balanced contrast, recognised across many editors.
  { slug: 'one-light', name: 'One Light', mode: 'light', inspiredBy: 'Atom', defaultProseFont: 'inter', defaultCodeFont: 'fira-code' },
  { slug: 'one-dark', name: 'One Dark', mode: 'dark', inspiredBy: 'Atom', defaultProseFont: 'inter', defaultCodeFont: 'fira-code' },
  // Mono-styled originals — kept on system fonts so they stay zero-network.
  { slug: 'terminal-light', name: 'Terminal Light', mode: 'light', defaultProseFont: 'system-mono', defaultCodeFont: 'system' },
  { slug: 'terminal-dark', name: 'Terminal Dark', mode: 'dark', defaultProseFont: 'system-mono', defaultCodeFont: 'system' },
  // Community-palette tributes (palettes MIT/BSD; original credits below).
  // Default fonts pair each theme with a typography that matches its
  // origin — applied only when the user hasn't explicitly chosen.
  { slug: 'solarized-light', name: 'Solarized Light', mode: 'light', inspiredBy: 'Ethan Schoonover', defaultProseFont: 'source-serif', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'solarized-dark', name: 'Solarized Dark', mode: 'dark', inspiredBy: 'Ethan Schoonover', defaultProseFont: 'source-serif', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'nord', name: 'Nord', mode: 'dark', inspiredBy: 'Arctic Ice Studio', defaultProseFont: 'inter', defaultCodeFont: 'fira-code' },
  { slug: 'gruvbox-dark', name: 'Gruvbox Dark', mode: 'dark', inspiredBy: 'Pavel Pertsev', defaultProseFont: 'inter', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'dracula', name: 'Dracula', mode: 'dark', inspiredBy: 'Zeno Rocha', defaultProseFont: 'inter', defaultCodeFont: 'fira-code' },
  { slug: 'everforest', name: 'Everforest', mode: 'dark', inspiredBy: 'sainnhe', defaultProseFont: 'lora', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'catppuccin-latte', name: 'Catppuccin Latte', mode: 'light', inspiredBy: 'Catppuccin', defaultProseFont: 'inter', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'catppuccin-mocha', name: 'Catppuccin Mocha', mode: 'dark', inspiredBy: 'Catppuccin', defaultProseFont: 'inter', defaultCodeFont: 'jetbrains-mono' },
  { slug: 'ayu-light', name: 'Ayu Light', mode: 'light', inspiredBy: 'Ivan Konstantinov', defaultProseFont: 'inter', defaultCodeFont: 'fira-code' },
  { slug: 'rose-pine-dawn', name: 'Rosé Pine Dawn', mode: 'light', inspiredBy: 'Rosé Pine', defaultProseFont: 'crimson-pro', defaultCodeFont: 'jetbrains-mono' },
  // Warm-print read — cream paper + deep brown ink, restrained earth-
  // tone syntax. Pairs naturally with a literary serif for body.
  { slug: 'newsprint', name: 'Newsprint', mode: 'light', defaultProseFont: 'crimson-pro', defaultCodeFont: 'jetbrains-mono' },
]

const STORAGE_KEY = 'nicermd:theme'
const PREVIOUS_KEY = 'nicermd:theme-previous'
const DEFAULT_SLUG = 'one-light'

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

function readPreviousStored(): string | null {
  try {
    return localStorage.getItem(PREVIOUS_KEY)
  } catch {
    return null
  }
}

function writePreviousStored(slug: string): void {
  try {
    localStorage.setItem(PREVIOUS_KEY, slug)
  } catch {
    // Same fall-through as above.
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
  if (persist) {
    // When committing a different theme, capture the previously
    // committed one so toggleRecentTheme() can swap back. Reading
    // localStorage rather than dataset.theme dodges live-preview
    // pollution — the picker calls applyTheme(…, false) while the
    // user arrows around, then once with persist=true on commit.
    const currentlyPersisted = readStored()
    if (currentlyPersisted && currentlyPersisted !== theme.slug) {
      writePreviousStored(currentlyPersisted)
    }
    writeStored(theme.slug)
  }
  document.documentElement.dataset.theme = theme.slug
  // Apply the theme's font pairing as a non-persisted preview if
  // (and only if) the user hasn't explicitly chosen fonts. Direction:
  // themes → fonts; fonts has no themes dependency.
  applyThemeFontDefaults({
    defaultProseFont: theme.defaultProseFont,
    defaultCodeFont: theme.defaultCodeFont,
  })
  return theme
}

// Swap to the previously-committed theme. Designed for "toggle
// between my light + dark" — repeated calls bounce between the
// two most recent themes, because applyTheme records the swap.
// Returns null if there's no previous theme yet (fresh user).
export function toggleRecentTheme(): Theme | null {
  const previous = readPreviousStored()
  if (!previous || previous === readStored()) return null
  return applyTheme(previous)
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
// Brief corner pill. Originally announced the active theme on cycle
// (inspired by the v1 N-badge fade pattern); now also used by other
// short-lived "X happened" affordances (e.g. share-link copied) — same
// element, ~1.5s show, 200ms fade.

let toastEl: HTMLDivElement | null = null
let toastTimer: number | null = null

export function showToast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'theme-toast'
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = message
  toastEl.classList.add('theme-toast--visible')
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastEl?.classList.remove('theme-toast--visible')
  }, 1500)
}

export function showThemeToast(theme: Theme): void {
  showToast(theme.name)
}
