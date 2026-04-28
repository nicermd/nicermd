# Known Issues

Living log. Open items at top, recently closed below. Drop closed items
once they've been quiet for a release or two.

## Open

- **Command palette: Escape may need two presses in Chrome.**
  Chrome's input autofill machinery seems to silently consume the first
  Escape on the search input before any keydown listener sees it.
  Window-level capture-phase listener + input-level capture-phase
  listener + `data-form-type="other"` / `data-1p-ignore` /
  `data-lpignore` mitigations are in place; if they're not enough,
  next step is to swap the `<input>` for a `<div contenteditable>` —
  different DOM contract, bypasses Chrome's text-input autofill
  entirely. Tauri / Safari / Firefox unaffected. Living with it for
  now since Esc-to-close is power-user behaviour and click-outside /
  click-result still work. _packages/website/src/command-palette.ts_

## Recently fixed

- **Filename missing in Tauri after fullscreen toggle.** `data-fullscreen`
  on `<html>` got stuck at `'1'` if the user entered or exited
  fullscreen via macOS native controls (green button, swipe gestures)
  rather than our Cmd+Shift+F toggle. CSS hid `.window-title` based on
  that attribute, so the filename disappeared and never came back.
  Fix: boot-time sync of `data-fullscreen` from `win.isFullscreen()`
  plus a `win.onResized` listener that re-syncs on fullscreen
  transitions. _packages/website/src/main.ts boot()_

- **Title + icons shift between modes.** Modes 1/2/4 scroll at the
  document level (vertical scrollbar present); mode 3 scrolls inside
  its panes (no document scrollbar). With classic-style scrollbars,
  this caused fixed-position elements pinned to `right: 0` to shift
  horizontally when switching modes. Fix: `scrollbar-gutter: stable`
  on `html` reserves the gutter unconditionally. No-op on overlay
  scrollbars; stabilises layout on classic ones.
  _packages/website/src/main.css_

- **Title strip cycle caused disappearing icons.** A dev-only A/B cycle
  for title-strip position persisted `'none'` to localStorage on first
  boot, leaving fresh users with nothing visible. Fix: deleted the
  variant module and locked the strip in (filename top, icons
  top-right) for both shells. _commit 545f4fb_

- **Scroll-hide stuck off-screen.** Once the strip hid on a fast
  downward scroll, gentle reading-pace scroll-up (1-2 px/frame)
  couldn't bring it back because the show-direction also required a
  threshold delta. Fix: asymmetric thresholds — hide needs sustained
  velocity, show fires on any upward delta.
  _packages/website/src/scroll-strip.ts_
