# Architecture

> Placeholder — to be filled in before the first public release.

Nicer.md is built as one rendering core surrounded by thin shells. This file
will document the boundaries between them, the contracts each shell relies
on, and the rationale for the major choices (markdown-it + DOMPurify in the
core, hybrid CodeMirror + Tiptap in the website shell, Tauri for desktop).

Until then, see:

- [README.md](./README.md) for a high-level overview of the packages.
- [SECURITY.md](./SECURITY.md) for the rendering threat model and the
  sanitisation contract every shell relies on.
- `packages/core/src/` for the render API surface — small enough to read
  in one sitting.
