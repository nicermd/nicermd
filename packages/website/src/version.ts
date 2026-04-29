// Single source of truth for the user-visible version label.
//
// Engineering tags on git (v0.1-milkdown, v0.4-tauri-foundation, etc.)
// track internal milestones; this string is for users — it sets the
// expectation that the product is early without claiming numeric
// maturity we don't have. Surfaced as a faint bottom-right badge in
// both shells; bumped manually on each public-facing release.

export const APP_NAME = 'Nicer.md'
export const APP_VERSION = 'v0.1 alpha'
