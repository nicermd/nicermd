# Contributing

The project is in alpha (`v0.1.x`). The repo is public so the code is browsable, the license is real, and bug reports / suggestions can land. PRs from outside contributors are welcome but should be coordinated via an issue first — alpha-stage architecture is still moving and a long-running fork is more painful than a quick "hold on, let me explain" up front.

## Reporting issues

- **Bugs** — open an issue. Useful info: version (the build SHA in the corner-badge popover, or `git rev-parse --short HEAD` for self-built copies), browser / OS, repro steps, expected vs actual.
- **Security issues** — see [SECURITY.md](./SECURITY.md) for coordinated disclosure. Don't open public issues for security findings.
- **Feature requests** — issues welcome. Work is currently prioritised against [BACKLOG.md](./BACKLOG.md) and [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

## Dev setup

```bash
pnpm install
pnpm dev           # builds core, runs website dev server (http://localhost:3333)
pnpm typecheck     # tsc --noEmit across the workspace
pnpm test          # vitest run, both packages
```

For desktop work:

```bash
pnpm --filter nicermd-website tauri:dev
```

## Coding conventions

A few choices that aren't obvious from the code:

- **No unrequested abstractions.** Three similar lines is better than a premature helper. Don't add error handling for impossible cases. Trust internal code; only validate at system boundaries.
- **Comments explain *why*, not *what*.** Naming carries the *what*. Save comments for hidden constraints, surprising tradeoffs, references to specific bug fixes that aren't obvious from context.
- **Small commits.** Each commit should be revertable. Bundle related changes; don't bundle unrelated ones. The commit-message body should explain reasoning, not just restate the diff.
- **Strict TypeScript.** `noUncheckedIndexedAccess` is on. `any` is rare and usually wrong.
- **No commercial-product brand names** as user-visible feature / theme / palette names — name things descriptively (Paper, Terminal, Newsprint). The one carve-out is community-palette tributes (Solarized, Nord, Catppuccin, etc.): these are widely-recognised palette names in the editor ecosystem and are kept verbatim, with the original designer credited via an `inspiredBy` field in the theme registry (rendered as "Inspired by …" subtitle) and formally attributed in [PALETTES.md](./PALETTES.md).
- **Sanitisation invariant.** Untrusted HTML must never reach the DOM unsanitised — see [SECURITY.md](./SECURITY.md) for the three-layer defence.

## Commit messages

Lowercase imperative subjects, prefixed with type:

```
add: <something new>
fix: <bug>
remove: <something dropped>
refactor: <internal restructuring, no behavior change>
chore: <tooling, deps>
docs: <docs-only>
release: <version bump>
```

Body explains the *why* — the diff already shows the *what*. For non-trivial commits, also explain what was considered and rejected.

## PR expectations

- Branch from `main`, push to a `try/<topic>` or `feat/<topic>` branch (CF auto-deploys non-main branches to a preview URL — useful for visual changes).
- Link the issue the PR addresses.
- Tests pass (`pnpm test`), typecheck clean (`pnpm typecheck`), no new ESLint warnings if/when ESLint lands.
- For visible changes, include a before/after screenshot or short Loom in the PR description.
- Squash-merge via the GitHub UI; the squashed commit message follows the conventions above.

## Releases

The desktop binary and the web build version together — see the "Releasing" section of [README.md](./README.md). One-liner: `pnpm version:bump <semver>`, commit, `pnpm release:tauri`.
