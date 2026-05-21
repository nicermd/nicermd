// Shared types for the in-doc find feature.
//
// The find bar (find-bar.ts) is a thin UI that doesn't know about
// individual modes — it just drives a `FindAdapter` provided by the
// current mode's handle. Each mode's adapter implements the same
// surface against its own substrate (DOM walker for Read / Split-
// preview, CodeMirror's search machinery for Code / Split-editor,
// ProseMirror DecorationSet for Write).
//
// SearchStats keeps the bar reactive without the adapter having to
// emit events — every operation returns the resulting state, so the
// bar can update its match-count badge and the prev/next button
// disabled state without polling.

export interface SearchStats {
  // Total matches across the current target.
  matchCount: number
  // 1-based index of the currently-focused match; 0 when nothing is
  // matched / no current selection. The bar shows `current / total`
  // when current > 0, and `0 of N` otherwise.
  current: number
}

export interface FindAdapter {
  // Update the active query. Empty string clears highlights. Returns
  // the new stats; bar uses them to update the badge.
  setQuery(query: string): SearchStats
  // Advance to the next / previous match. No-op when matchCount === 0.
  // Returns the updated stats so the bar can re-render the badge.
  next(): SearchStats
  prev(): SearchStats
  // Tear down — remove highlights, dispose plugins, restore the
  // editor state. Called when the bar closes OR when the user
  // switches modes while the bar is open.
  close(): void
}
