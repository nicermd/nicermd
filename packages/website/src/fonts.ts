// Typography system — separate axis from themes. User picks a prose
// font and a code font independently; choices persist in localStorage
// and override whatever the active theme defines via inline CSS custom
// properties (highest specificity wins, so theme defaults still apply
// for users who haven't picked).
//
// Web fonts come from Google Fonts via a single `<link>` injected
// lazily — only when the user picks a non-system font, so the first
// paint is never blocked by a network request. `font-display: swap`
// means the system fallback renders first and the web face hot-swaps
// in. Later iteration: bundle WOFF2s for the desktop / mobile apps so
// they work offline; the catalogue + apply/persist API stay the same.

export interface Font {
  id: string
  name: string
  // CSS font-family value. Web fonts list themselves first with a
  // sensible system fallback chain.
  family: string
  // Google Fonts query param (`Family:wght@400;700`) — undefined for
  // system-only fonts, which are zero-cost.
  googleFonts?: string
}

export const PROSE_FONTS: readonly Font[] = [
  {
    id: 'system',
    name: 'System Sans',
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: 'system-serif',
    name: 'System Serif',
    family: 'ui-serif, Charter, "Iowan Old Style", "Hoefler Text", Georgia, "Times New Roman", serif',
  },
  {
    id: 'system-mono',
    name: 'System Mono',
    family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  {
    id: 'inter',
    name: 'Inter',
    family: '"Inter", system-ui, sans-serif',
    googleFonts: 'Inter:wght@400;500;700',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    family: '"Outfit", system-ui, sans-serif',
    googleFonts: 'Outfit:wght@400;500;700',
  },
  {
    id: 'source-serif',
    name: 'Source Serif',
    family: '"Source Serif 4", ui-serif, Georgia, serif',
    googleFonts: 'Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700',
  },
  {
    id: 'lora',
    name: 'Lora',
    family: '"Lora", ui-serif, Georgia, serif',
    googleFonts: 'Lora:wght@400;500;700',
  },
  {
    id: 'eb-garamond',
    name: 'EB Garamond',
    family: '"EB Garamond", ui-serif, Garamond, serif',
    googleFonts: 'EB+Garamond:wght@400;500;700',
  },
  {
    id: 'crimson-pro',
    name: 'Crimson Pro',
    family: '"Crimson Pro", ui-serif, Georgia, serif',
    googleFonts: 'Crimson+Pro:wght@400;500;700',
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    family: '"Fraunces", ui-serif, Georgia, serif',
    googleFonts: 'Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700',
  },
]

export const CODE_FONTS: readonly Font[] = [
  {
    id: 'system',
    name: 'System Mono',
    family: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    family: '"JetBrains Mono", ui-monospace, monospace',
    googleFonts: 'JetBrains+Mono:wght@400;500;700',
  },
  {
    id: 'fira-code',
    name: 'Fira Code',
    family: '"Fira Code", ui-monospace, monospace',
    googleFonts: 'Fira+Code:wght@400;500;700',
  },
  {
    id: 'ibm-plex-mono',
    name: 'IBM Plex Mono',
    family: '"IBM Plex Mono", ui-monospace, monospace',
    googleFonts: 'IBM+Plex+Mono:wght@400;500;700',
  },
  {
    id: 'space-mono',
    name: 'Space Mono',
    family: '"Space Mono", ui-monospace, monospace',
    googleFonts: 'Space+Mono:wght@400;700',
  },
]

const PROSE_KEY = 'nicermd:font-prose'
const CODE_KEY = 'nicermd:font-code'
const LOADED_LINK_ID = 'nicermd-font-link'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // localStorage unavailable; selection lives only for this session.
  }
}

function findFont(list: readonly Font[], id: string | null): Font {
  if (!id) return list[0]!
  return list.find((f) => f.id === id) ?? list[0]!
}

export function getActiveProseFont(): Font {
  return findFont(PROSE_FONTS, document.documentElement.dataset.fontProse ?? null)
}

export function getActiveCodeFont(): Font {
  return findFont(CODE_FONTS, document.documentElement.dataset.fontCode ?? null)
}

// Rebuild the single Google Fonts <link> with whatever non-system
// faces are currently in play. Invalidates the URL so the browser
// fetches the new combination; idempotent when nothing changed.
function syncFontLink(): void {
  const families: string[] = []
  for (const list of [PROSE_FONTS, CODE_FONTS]) {
    for (const font of list) {
      if (!font.googleFonts) continue
      const isProseActive = list === PROSE_FONTS && font.id === getActiveProseFont().id
      const isCodeActive = list === CODE_FONTS && font.id === getActiveCodeFont().id
      // Always include the active one so it's available; preview-time
      // expansion happens in the picker via loadCatalogue().
      if (isProseActive || isCodeActive) families.push(font.googleFonts)
    }
  }
  let link = document.getElementById(LOADED_LINK_ID) as HTMLLinkElement | null
  if (families.length === 0) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.id = LOADED_LINK_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href =
    'https://fonts.googleapis.com/css2?' +
    families.map((f) => `family=${f}`).join('&') +
    '&display=swap'
}

// Preload every catalogue entry — used by the picker so live-preview
// hovers show the actual face immediately. Independent of the active
// selection's <link>, which stays minimal.
let catalogueLink: HTMLLinkElement | null = null
export function loadCatalogue(): void {
  if (catalogueLink) return
  const families: string[] = []
  for (const list of [PROSE_FONTS, CODE_FONTS]) {
    for (const font of list) {
      if (font.googleFonts) families.push(font.googleFonts)
    }
  }
  if (families.length === 0) return
  catalogueLink = document.createElement('link')
  catalogueLink.rel = 'stylesheet'
  catalogueLink.href =
    'https://fonts.googleapis.com/css2?' +
    families.map((f) => `family=${f}`).join('&') +
    '&display=swap'
  document.head.appendChild(catalogueLink)
}

// Apply by setting CSS custom properties inline on <html>. Inline
// style has higher specificity than any [data-theme] block, so user
// choice always wins; clearing back to the theme default just means
// removing the inline property.
export function applyProseFont(id: string, persist = true): Font {
  const font = findFont(PROSE_FONTS, id)
  document.documentElement.dataset.fontProse = font.id
  document.documentElement.style.setProperty('--font-body', font.family)
  if (persist) writeStored(PROSE_KEY, font.id)
  syncFontLink()
  return font
}

export function applyCodeFont(id: string, persist = true): Font {
  const font = findFont(CODE_FONTS, id)
  document.documentElement.dataset.fontCode = font.id
  document.documentElement.style.setProperty('--font-code', font.family)
  if (persist) writeStored(CODE_KEY, font.id)
  syncFontLink()
  return font
}

// Boot-time restore. No-op visually if the user has never picked —
// system fonts are the default in :root.
export function initFonts(): void {
  const prose = readStored(PROSE_KEY)
  const code = readStored(CODE_KEY)
  if (prose) applyProseFont(prose, false)
  if (code) applyCodeFont(code, false)
}

// True if the user has explicitly picked this axis (committed a
// choice via the font picker). Theme defaults won't override an
// explicit pick, but they will surface as a live preview when the
// user is on the system fallback.
export function hasUserProseFont(): boolean {
  return readStored(PROSE_KEY) !== null
}
export function hasUserCodeFont(): boolean {
  return readStored(CODE_KEY) !== null
}

// Theme-driven defaults: applied non-persistently when the user
// hasn't explicitly chosen, so theme switching can surface a curated
// typography pairing without overriding explicit user choice. Pass
// the active theme's defaultProseFont / defaultCodeFont IDs.
export function applyThemeFontDefaults(defaults: {
  defaultProseFont?: string
  defaultCodeFont?: string
}): void {
  if (!hasUserProseFont()) {
    applyProseFont(defaults.defaultProseFont ?? 'system', false)
  }
  if (!hasUserCodeFont()) {
    applyCodeFont(defaults.defaultCodeFont ?? 'system', false)
  }
}
