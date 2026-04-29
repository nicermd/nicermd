# Nicer.md

A nicer, zero-server markdown reader. Read, write, and save markdown — beautifully, in the same pane, with no server.

**Status:** early development. The first public milestone is a working website at [nicermd.com](https://nicermd.com).

## Packages

- **`nicermd-core`** — the rendering engine. Markdown string in, sanitized HTML out. No framework dependency, no DOM assumption, no network calls.
- **`nicermd-website`** — the live demo and distribution hub. Paste or drop markdown, see it rendered, share via URL. Deployed at nicermd.com.

More shells planned: CLI, Chrome extension, VS Code extension, iOS app.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io) (`corepack enable` if Node 20+ is already installed).

```bash
pnpm install
pnpm dev           # build core + run website dev server
pnpm build         # build all packages
pnpm typecheck     # type-check all packages
```

The website dev server runs on [http://localhost:3333](http://localhost:3333).

For active work on the core alongside the website, use two terminals:

```bash
pnpm dev:core      # tsup watch-mode on the core
pnpm dev:website   # vite dev server on the website
```

## Architecture

One rendering core, multiple thin shells. Everything runs on the user's device — no backend, no database, no telemetry. See the source of `packages/core/` for the render API; every shell imports from there.

## Security

All rendering passes through DOMPurify with a strict allow-list. Raw HTML in markdown is disabled at the parser level. See [SECURITY.md](./SECURITY.md) for the full threat model, sanitization defaults, and coordinated-disclosure process.

## License

[MIT](./LICENSE.md). For bundled third-party libraries, see
[THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md).
