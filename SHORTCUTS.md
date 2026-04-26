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
| `Cmd` + `S`           | Save in place (FSA / Tauri) or download   | Not yet wired |
| `Cmd` + `O`           | Open file                                 | Not yet wired |
| `Cmd` + `/`           | Open command palette                      | Not yet wired |
| `Cmd` + `Shift` + `F` | Enter / exit full screen                  | Not yet wired |
| `Cmd` + `.`           | Toggle focus mode (Tauri only)            | Not yet wired |
| `Esc`                 | Priority chain: close palette → exit modal → exit focus | Not yet wired |

## URL flags (dev only)

These activate inside `pnpm dev` builds. They are tree-shaken out of production builds and have no effect on the deployed site.

| Flag            | Effect                                                                |
|-----------------|-----------------------------------------------------------------------|
| `?dev=1`        | Boot `stress.md`, show the mode-label pill, enable cross-tab sync     |
| `?freeze=1`     | (Use with `?dev=1`) Lock this tab to its boot state — for "before" snapshots when comparing round-trip output across tabs |
