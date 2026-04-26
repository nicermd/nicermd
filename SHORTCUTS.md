# Keyboard shortcuts

A quick reference for everything wired in nicermd.

- `Cmd` is shown for macOS; substitute `Ctrl` on Windows / Linux.
- Items in **Planned** are reserved bindings, not yet implemented.
- This file is hand-maintained — please update it whenever a binding lands or moves.

## Mode switching

| Shortcut              | Action                              |
|-----------------------|-------------------------------------|
| `Cmd` + `1`           | Switch to **Mode 1 — Read**         |
| `Cmd` + `2`           | Switch to **Mode 2 — WYSIWYG**      |
| `Cmd` + `3`           | Switch to **Mode 3 — Code + preview** |
| `Cmd` + `4`           | Switch to **Mode 4 — Raw code**     |
| `Cmd` + `Shift` + `M` | Cycle modes 1 → 2 → 3 → 4 → 1       |

## Window

| Shortcut              | Action                                              |
|-----------------------|-----------------------------------------------------|
| `Cmd` + `Shift` + `F` | Toggle fullscreen (native macOS fullscreen in Tauri, HTML5 Fullscreen API in browser) |
| `Cmd` + `=` / `+`     | Zoom in (Tauri only — browsers handle natively)     |
| `Cmd` + `-`           | Zoom out (Tauri only — browsers handle natively)    |
| `Cmd` + `0`           | Reset zoom to 100% (Tauri only — browsers handle natively) |

Zoom range is 50%–300% in 10% steps; the level persists in `localStorage` and is restored on next launch.

## File

| Shortcut                       | Action                                                                                              |
|--------------------------------|-----------------------------------------------------------------------------------------------------|
| `Cmd` + `N`                    | New empty document (prompts to discard unsaved changes if dirty)                                    |
| `Cmd` + `O`                    | Open file via system dialog                                                                         |
| `Cmd` + `S`                    | Save — writes back to where the file came from (Tauri path or File System Access handle)            |
| `Cmd` + `Shift` + `S`          | Save As — always opens the save dialog                                                              |
| Drag a `.md` / `.markdown` / `.mdx` onto the window | Loads the file into the active mode; subsequent `Cmd+S` falls through to Save-As (no path / handle). |

The active filename appears in the Tauri title strip (centered, between the traffic lights and the right edge) and in the browser tab title (`document.title`). A leading `•` indicates unsaved changes. The title strip hides automatically in macOS-native fullscreen.

Closing the window (browser tab close / Tauri window close) prompts to discard if there are unsaved edits.

## Autosave

Edits are debounced-snapshotted to `localStorage` 1.5s after typing stops. The backup is cleared on a successful Save / Open / New. On startup, if a recent (<24h) backup is found that doesn't match the current loaded doc, a small banner offers **Restore** or **Discard**.

The backup is single-slot — it covers "I crashed mid-edit and want my work back." It does not cover multiple simultaneous documents.

Save-back support depends on runtime:

- **Tauri (desktop):** `plugin-dialog` for the file picker, `plugin-fs` for read/write. Real OS-level paths.
- **Chromium browsers:** File System Access API (`showOpenFilePicker` / `showSaveFilePicker`) — true in-place write.
- **Firefox / Safari:** `<input type="file">` to open, downloads `.md` for save (Save-As only — no in-place write available).

Drag-drop in Tauri is configured to use HTML5 events (`dragDropEnabled: false`); same code path as the browser.

## Themes

| Shortcut             | Action                                             |
|----------------------|----------------------------------------------------|
| `Cmd` + `Alt` + `T`  | Open theme picker (arrows preview live, Enter commits, Esc reverts) |

The picker also auto-opens on first-ever visit (when no theme has been chosen yet) and lists all built-in themes plus a "Coming soon" row of placeholder themes. A custom-theme URL field is scaffolded; fetching is deferred to a follow-up.

`Cmd` + `Alt` + `T` was picked over `Cmd` + `Shift` + `T` because Chrome reserves `Cmd+Shift+T` for "reopen closed tab" — `preventDefault` cannot override that browser-level accelerator.

The four modes:

1. **Read** — rendered HTML via `nicermd-core`, no editor.
2. **WYSIWYG** — Tiptap, markers hidden, Notion/Bear feel. Lazy-loaded on first enter.
3. **Code + preview** — CodeMirror source on the left, live `nicermd-core` preview on the right.
4. **Raw code** — CodeMirror with a GitHub-source palette and line numbers. The "purist" mode where bytes are preserved exactly.

## Standard editing (modes 2, 3, 4)

These come from CodeMirror / ProseMirror defaults. Mode 1 is read-only and ignores them.

| Shortcut                       | Action                          |
|--------------------------------|---------------------------------|
| `Cmd` + `Z`                    | Undo                            |
| `Cmd` + `Shift` + `Z` / `Cmd` + `Y` | Redo                       |
| `Cmd` + `X` / `C` / `V`        | Cut / Copy / Paste              |
| `Cmd` + `A`                    | Select all                      |
| Arrow keys                     | Move cursor / extend selection  |

Undo history is per-mode — switching modes does not preserve undo state across engines.

## Mode 2 — table editing (Tiptap)

| Shortcut          | Action                                            |
|-------------------|---------------------------------------------------|
| `Tab`             | Move to next cell (creates a new row at the end)  |
| `Shift` + `Tab`   | Move to previous cell                             |
| `Enter`           | Insert a line break inside the current cell       |

Table column drag-resize is supported visually but does not survive a markdown round-trip — markdown's table grammar has no column-width concept.

## Planned

Reserved bindings that haven't landed yet. Subject to change before they ship.

| Shortcut              | Action                                    | Status        |
|-----------------------|-------------------------------------------|---------------|
| `Cmd` + `/`           | Open command palette                      | Not yet wired |
| `Cmd` + `.`           | Toggle focus mode (Tauri only)            | Not yet wired |
| `Esc`                 | Priority chain: close palette → exit modal → exit focus | Not yet wired |

## URL flags (dev only)

These activate inside `pnpm dev` builds. They are tree-shaken out of production builds and have no effect on the deployed site.

| Flag            | Effect                                                                |
|-----------------|-----------------------------------------------------------------------|
| `?dev=1`        | Boot `stress.md`, show the mode-label pill, enable cross-tab sync     |
| `?freeze=1`     | (Use with `?dev=1`) Lock this tab to its boot state — for "before" snapshots when comparing round-trip output across tabs |
