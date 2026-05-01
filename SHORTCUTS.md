# Keyboard shortcuts

A quick reference for everything wired in nicermd.

- `Cmd` is shown for macOS; substitute `Ctrl` on Windows / Linux.
- Items in **Planned** are reserved bindings, not yet implemented.
- This file is hand-maintained — please update it whenever a binding lands or moves.

## Mode switching

| Shortcut              | Action                              |
|-----------------------|-------------------------------------|
| `Cmd` + `1`           | Switch to **Mode 1 — Read**         |
| `Cmd` + `2`           | Switch to **Mode 2 — Write**        |
| `Cmd` + `3`           | Switch to **Mode 3 — Split**        |
| `Cmd` + `4`           | Switch to **Mode 4 — Code**         |
| `Cmd` + `Return`      | Toggle Read ↔ Write (from Split / Code, jumps to Write) |
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
| `Cmd` + `Alt` + `O`            | Open URL — paste a GitHub markdown URL (`github.com/<user>/<repo>/blob/<branch>/<path>.md`)          |
| `Cmd` + `S`                    | Save — writes back to where the file came from (Tauri path or File System Access handle)            |
| `Cmd` + `Shift` + `S`          | Save As — always opens the save dialog                                                              |
| Drag a `.md` / `.markdown` / `.mdx` onto the window | Loads the file into the active mode; subsequent `Cmd+S` falls through to Save-As (no path / handle). |

**Open URL** is GitHub-only for now. Accepted shapes:

- `github.com/<u>/<r>/blob/<branch>/<path>.md` (or `/raw/`) — fetched as the corresponding raw URL.
- `raw.githubusercontent.com/<u>/<r>/<branch>/<path>.md` — passthrough.
- `github.com/<u>/<r>/tree/<branch>[/<dir>]` — fetches `README.md` at that location.
- `github.com/<u>/<r>` — fetches `README.md` from `main`, falling back to `master`.
- `gist.github.com/<u>/<id>` — fetches the gist's first file via `/raw` (which 302s to the latest revision). For multi-file gists, paste the direct `gist.githubusercontent.com/<u>/<id>/raw/<sha>/<file>` URL to pick a specific file.

Explicit blob/raw paths must end in `.md`, `.markdown`, or `.mdx` — anything else is rejected as not-markdown so we don't accidentally render binaries or HTML. Source is recorded as anonymous so a subsequent `Cmd+S` falls through to Save-As (we can't write back to GitHub). Non-GitHub hosts are rejected; gists, private repos, and `?url=` boot params are deliberately out of scope. The fetcher caps responses at 5 MiB and refuses cross-host redirects.

The picker prefills from the clipboard if the most recently copied text is a recognisable GitHub URL, and shows a live preview of the raw URL it would fetch as you type. Successfully loaded URLs accumulate in a 5-deep `Recent` list inside the modal — name on the left, dim URL on the right; arrow-key navigable; Enter loads the highlighted row.

**Share links** — append `?url=<github-url>` to a Nicer.md address (e.g. `nicer.md/?url=https://github.com/anthropics/anthropic-cookbook`) and the recipient sees a confirmation modal: "A link is asking Nicer.md to load this markdown file: [preview]". Default action is **Cancel** — markdown content can mimic login pages or carry misleading instructions, so the gate is intentional. The `?url=` param is stripped from the address bar before the modal appears, so a refresh boots cleanly without re-prompting.

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
| `Cmd` + `\`          | Swap to the previously-committed theme — bounces between the two most recent (e.g. light ↔ dark) |
| `Cmd` + `Alt` + `F`  | Open font picker — independent prose + code font selection (lazy-loaded from Google Fonts) |

The picker also auto-opens on first-ever visit (when no theme has been chosen yet) and lists all built-in themes plus a "Coming soon" row of placeholder themes. A custom-theme URL field is scaffolded; fetching is deferred to a follow-up.

`Cmd` + `Alt` + `T` was picked over `Cmd` + `Shift` + `T` because Chrome reserves `Cmd+Shift+T` for "reopen closed tab" — `preventDefault` cannot override that browser-level accelerator.

The four modes:

1. **Read** — rendered HTML via `nicermd-core`, no editor.
2. **Write** — Tiptap rich-text, markers hidden, Notion/Bear feel. Lazy-loaded on first enter.
3. **Split** — CodeMirror source on the left, live `nicermd-core` preview on the right.
4. **Code** — CodeMirror with a GitHub-source palette and line numbers. The "purist" mode where bytes are preserved exactly.

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

## Write mode — table editing (Tiptap)

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
