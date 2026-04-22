# Nicer.md

A beautiful, zero-server markdown reader. Paste, view, share — rendered with care.

**Status:** early development. The first public milestone is a working website at [nicermd.com](https://nicermd.com).

## Packages

- **`nicermd-core`** — the rendering engine. Markdown string in, sanitized HTML out. No framework dependency, no DOM assumption, no network calls.
- **`nicermd-website`** — the live demo and distribution hub. Paste or drop markdown, see it rendered, share via URL. Deployed at nicermd.com.

More shells planned: CLI, Chrome extension, VS Code extension, iOS app.

## Development

Requires [pnpm](https://pnpm.io) and Node.js 20+.

```bash
pnpm install
pnpm dev           # run the website dev server
pnpm build         # build all packages
pnpm typecheck     # type-check all packages
```

The website dev server runs on [http://localhost:3333](http://localhost:3333).

## Architecture

One rendering core, multiple thin shells. Everything runs on the user's device — no backend, no database, no telemetry. See the source of `packages/core/` for the render API; every shell imports from there.

## Security

All rendering passes through DOMPurify with a strict allow-list. Raw HTML in markdown is disabled at the parser level. See [SECURITY.md](./SECURITY.md) for the full threat model, sanitization defaults, and coordinated-disclosure process.

## License

[MIT](./LICENSE).
