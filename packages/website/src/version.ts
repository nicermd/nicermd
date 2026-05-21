// Single source of truth for the user-visible version label.
// Surfaced as a faint bottom-right badge in both shells; bumped
// manually on each public-facing release. 'alpha' sets the
// expectation that the product is early without claiming numeric
// maturity we don't have.

export const APP_NAME = 'Nicer.md'
export const APP_VERSION = 'v0.1.22 alpha'

// Derived from APP_VERSION so the alpha flag never drifts out of sync
// with the badge text. Flip by removing 'alpha' from APP_VERSION on GA.
export const IS_ALPHA = APP_VERSION.toLowerCase().includes('alpha')

// Build provenance — injected by Vite at build time (see vite.config.ts
// `define` block). 'dev' when running the dev server or in a context
// where git isn't reachable. Surfaced in the badge popover so users
// can tell whether the live site reflects the latest commit.
declare const __BUILD_SHA__: string
declare const __BUILT_AT__: string
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'undefined' ? 'dev' : __BUILD_SHA__
export const BUILT_AT: string = typeof __BUILT_AT__ === 'undefined' ? '' : __BUILT_AT__
