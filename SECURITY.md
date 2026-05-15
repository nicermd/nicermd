# Security

Nicer.md renders untrusted markdown in the user's browser. Markdown renderers have a long history of XSS bugs via sanitization gaps — this document names the threats we defend against, the ones we don't, and the specific defaults that enforce the policy.

This file is kept honest about **what ships today vs what's planned**: the
defences below are split between [Defences in force](#defences-in-force) (what
the current code actually enforces) and [Pending defences](#pending-defences)
(what's in the threat model but not yet shipped). When a feature lands, it
moves from the second section into the first.

## Threat model

### What we defend against

1. **XSS via rendered HTML.** Attacker crafts markdown designed to produce dangerous HTML when rendered (inline scripts, `javascript:` URLs, event handlers on tags, SVG with `<script>`, etc.).
2. **URL-shared payloads.** Attacker shares a `nicer.md/?url=<github-url>` link, victim's browser loads the linked file and renders it. This is our primary novel attack surface — shared URLs are an attacker-controlled code path, not user-typed content.
3. **HTML injection via markdown-it's HTML-in-markdown feature.** Raw HTML blocks inside markdown (`<script>alert(1)</script>` typed directly) would pass through markdown-it by default.
4. **Dangerous link/image URLs.** `javascript:`, `data:` with scriptable MIME types, `file:`, `vbscript:`.
5. **Visual confusion in document names.** Bidi-override / zero-width characters in URL-derived display names that could mislead about the source of a loaded document.
6. **Supply chain.** A dependency update introduces a malicious package version.
7. **DoS via huge inputs.** Massive markdown strings, pathologically nested structures, or content servers that stream past the documented size cap.
8. **IPC abuse in the desktop shell.** Compromised webview content escaping into native OS capabilities (filesystem read/write, shell, process).

### What we don't defend against (explicit)

- **User pastes their own malicious content and views it.** They are both attacker and victim; not our problem.
- **Targeted social engineering** ("click this nicer.md URL to see something interesting" when the content is actually phishing or NSFW). No different from any web link. We show the source URL on hover for content loaded via `?url=` so users have provenance awareness.
- **Compromise of the user's machine, browser, or extensions.** Out of scope.
- **TLS/MitM between the user and Cloudflare.** Cloudflare's infrastructure concern.

## Defences in force

### markdown-it configuration

```js
new MarkdownIt({
  html: true,        // see HTML handling below
  linkify: true,
  breaks: false,
  typographer: true,
})
```

`html: true` is intentional — it lets the markdown-it lexer recognise HTML
constructs so we can intercept them at the renderer level rather than letting
them slip through as escaped text. The defence is two-layer:

1. **Inline HTML is filtered through a static allowlist regex** that permits
   only `br|kbd|sub|sup|mark`. Anything else is dropped silently at the
   renderer level, before sanitisation.
2. **DOMPurify runs as a final-pass sanitizer** on the entire output with a
   strict tag/attribute/URI allowlist (see below). Block HTML flows into
   this pass and is constrained to a fixed set of structural and
   presentational tags. Tags outside the allowlist are dropped (children
   kept by default), attributes outside the allowlist are stripped, and
   URI values are validated against an explicit scheme allowlist.

An earlier revision additionally elided block HTML to a `⋯` placeholder
before sanitisation — a defence-in-depth layer that pre-empted DOMPurify
even getting block HTML. We dropped that elision once Write mode's
HTML-parking (see below) had demonstrated the DOMPurify-only path was
sufficient for the threat model, and because the elision was hiding real
README content (centred logos, badge strips, callout boxes) that DOMPurify
was already equipped to render safely.

### Write-mode HTML parking

Mode 2 (the Tiptap WYSIWYG editor) cannot round-trip arbitrary HTML
through its document model — its markdown serialiser tends to escape or
mangle anything that isn't representable as a native Tiptap node. To
preserve HTML scaffolding across edit/save cycles, every `html_block`
in the source is wrapped in a fenced code block with a sentinel info
string (`__nicermd_html__`) before Tiptap parses, and unwrapped on the
way out. A custom node view renders the parked content as a sanitised
preview (via `sanitizeHtml`) so Write mode shows the same visual as
Read mode rather than raw `<div>` source.

This means:

- HTML scaffolding survives Write-mode editing untouched — the saved
  file matches the source file byte-for-byte for HTML regions.
- The sanitisation surface is identical to Read mode: same DOMPurify
  configuration, same tag/attr/URI allowlist.
- A bug in DOMPurify would surface identically in both modes; there is
  no second pass and no parallel sanitiser.

### DOMPurify pass on rendered output

Configuration in `packages/core/src/index.ts`:

- **Allowed tags**: standard markdown elements (headings, paragraphs,
  lists, code/pre, links, images, table elements, blockquote, hr,
  span/div, `kbd`/`sub`/`sup`/`mark`) plus a curated set of README-
  scaffolding tags that DOMPurify is the load-bearing defence for:
  `center`, `details`, `summary`, `figure`, `figcaption`, `dl`/`dt`/`dd`,
  `u`, `i`, `b`, `small`, `q`, `cite`, `abbr`, `time`, `wbr`. All of
  these are structural or inline-formatting only — no scripting, no
  network, no JS-driven interactivity.
- **Allowed attributes**: `href`, `src`, `alt`, `title`, `class`, `id`,
  `align`, `width`, `height`, `colspan`, `rowspan`, `open` (for
  `<details open>`), `datetime`, `aria-hidden`, `aria-label`,
  `aria-labelledby`, `aria-describedby`, `rel`. No event handlers
  (`onclick=`, etc.), no `style`, no `formaction`, no `srcset`, no
  `background`. Adding new attributes goes through the supply-chain
  review process below.
- **Allowed URI schemes**: `https:`, `http:`, `mailto:`, fragment-only
  (`#anchor`), and query-only (`?url=…` for in-app deep links).
  Protocol-relative URLs (`//host/path`) are blocked — they hide the
  resolved scheme and provide phishing aid. **No `data:` URIs anywhere**
  — even `data:image/*` has been removed because a clicked
  `<a href="data:image/svg+xml,…<svg onload=…>">` executes the embedded
  script. If inline image embedding lands later, it'll be re-introduced
  via a tag-scoped DOMPurify hook (`<img src>` only).

The URI scheme allowlist is enforced via a `uponSanitizeAttribute`
hook rather than DOMPurify's `ALLOWED_URI_REGEXP` config option. The
config-driven regex is applied to *every* attribute value, not just
URL-bearing ones, which silently strips e.g. `align="center"` and
`width="500"` because those values don't match a URI pattern. The hook
scopes the URI check to the attributes that actually carry URIs
(`href`, `src`, `xlink:href`) and additionally drops `data:` on every
attribute as a belt-and-braces layer.

### External-link hardening

Every absolute-scheme link (`https:`, `http:`, `mailto:`) gets
`rel="noopener noreferrer"` added at the markdown-it renderer level
(`link_open` rule). Two protections in one short rule: `noopener`
prevents the destination accessing `window.opener` if the user
middle-clicks or Cmd-clicks to a new tab; `noreferrer` suppresses the
`Referer` header. Same-page (`#section`) and query-only (`?url=…`)
links are left alone — they're navigating the app itself.

### URL loader

`packages/website/src/url-open.ts`:

- **Host allowlist**: parser accepts only `github.com`, `www.github.com`,
  `gist.github.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com`.
  All inputs are normalized to a fetch against `raw.githubusercontent.com`
  or `gist.githubusercontent.com`. SSRF probes (`localhost`, RFC1918,
  `169.254.169.254`, internal hostnames) are rejected at parse time.
- **Protocol must be `https:`** — `file://`, `http://`, etc. rejected.
- **Path extension filter**: explicit blob/raw URLs must end in `.md`,
  `.markdown`, or `.mdx` (case-insensitive). Bare-repo / tree URLs synthesise
  README.md.
- **Redirects blocked** (`fetch(url, { redirect: 'error' })`). Redirect-based
  bypass to non-allowlist hosts is impossible.
- **5 MiB body cap** on every fetch. *Currently buffered*: the cap is
  enforced after `arrayBuffer()` resolves, so a malicious server that
  omits `content-length` and streams forever can exhaust client memory.
  Streaming-reader replacement is in `BACKLOG.md`.
- **Display name sanitisation**: control characters, zero-width characters,
  and bidi-override characters are stripped from URL-derived display names;
  length capped at 80 chars. Display goes through `textContent` so HTML
  injection is moot — this is a phishing-aid hardening.
- **Phishing gate on `?url=` boot param**: a confirmation modal appears
  before any fetch, default focus on Cancel, with a warning about untrusted
  content. The `?url=` param is stripped from the address bar before the
  modal shows, so refresh produces a clean re-boot rather than a
  re-prompt loop.
- **Loaded URL is recorded as informational only**: Save falls through to
  Save-As (we can't write back to GitHub).

### Content Security Policy — Tauri desktop shell

Set in `packages/website/src-tauri/tauri.conf.json` → `app.security.csp`:

```
default-src 'self' ipc: https://ipc.localhost;
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: https:;
font-src 'self' data: https://fonts.gstatic.com;
connect-src 'self' ipc: https://ipc.localhost ws://localhost:3333
  http://localhost:3333 https://raw.githubusercontent.com
  https://gist.githubusercontent.com https://fonts.googleapis.com
  https://fonts.gstatic.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'none';
object-src 'none';
```

Properties:

- **No `'unsafe-inline'` on script-src** — no inline event handlers, no
  inline `<script>` tags. If a dependency requires this, reject the
  dependency.
- **No `'unsafe-eval'` anywhere** — no `eval`, no `new Function`.
- **`'unsafe-inline'` on style-src** is currently permitted because Tauri's
  overlay title bar and Tiptap may inject inline styles. Tightening this
  is tracked as a future hardening pass.
- **`connect-src`** explicitly enumerates the URL loader hosts and the
  Vite HMR endpoints (dev only). New external hosts require an explicit
  CSP update.
- **`img-src` allows `https:` and `data:`** so user-supplied markdown
  can reference external images. This is a deliberate loosening; the
  tradeoff is that stripping all remote images would make most shared
  technical docs unusable. Note that `data:` here only opens up the
  `<img src>` surface — the renderer's URI allowlist still blocks
  `data:` everywhere else.
- **`frame-ancestors 'none'`** — prevents embedding our app in iframes.

### Tauri capabilities

`packages/website/src-tauri/capabilities/default.json` grants:

- **Window** — `set-fullscreen`, `is-fullscreen`, `start-dragging`,
  `toggle-maximize`. UI-only.
- **Webview zoom** — `set-webview-zoom` for the Cmd+= / Cmd+- bindings.
- **Dialog** — `open` / `save`. User-mediated by the OS dialog.
- **Filesystem** — `read-text-file` and `write-text-file`. **Current
  scope: `path: '**'` (all paths).** This is a known hardening gap;
  see [BACKLOG.md](./BACKLOG.md) for the proper fix (Tauri 2 runtime
  scope authorisation tied to dialog-returned paths). The interim
  posture is acceptable only because the upstream rendering defences
  block XSS — a sanitisation bypass would otherwise expose arbitrary
  filesystem read/write.

`dragDropEnabled: false` on the main window means OS-level drag-drop is
disabled; HTML5 drag-drop events fire and dropped files go through the
same renderer pipeline as anything else.

### Service worker

`packages/website/public/sw.js`, registered from `sw-register.ts`:

- **Web only** — registration is skipped in Tauri (the desktop shell
  has the app local) and in Vite dev (HMR + a SW that caches modules
  is a debugging trap).
- **Same-origin only** — cross-origin requests pass straight through
  to the network. `raw.githubusercontent.com`, `fonts.googleapis.com`,
  etc. are never cached or mediated by the SW. This keeps the cache
  surface narrow and matches the strict-CSP posture.
- **Versioned cache name** (`nicermd-<version>`). On `activate` any
  cache that doesn't match the current version is dropped, so stale
  bundles can't survive across releases. Bump `CACHE_VERSION` on each
  user-facing release.
- **No opaque or `range` responses are cached** — only basic, OK
  same-origin responses are written back. This avoids quota-burning
  partial responses and ambiguous cross-origin entries.
- **Last-resort navigation fallback**: when offline and the requested
  document isn't cached, the SW serves the cached `/` shell so the app
  still boots. Better than the browser's "no connection" page when the
  user has visited before.

## Pending defences

The following are described in the threat model and the project plan but
**are not yet implemented**. Each will move into [Defences in force](#defences-in-force)
when the feature lands.

- **CSP for the website** — set via Cloudflare Pages `_headers` once the
  Cloudflare deploy lands. Until then the website has no CSP at all.
  Mirrors the Tauri CSP above.
- **KaTeX math rendering** — when added, `trust: false` (default) must be
  set so `\href`, `\includegraphics`, etc. are disabled.
- **Shiki syntax highlighting** — when added, use the CSS-variables output
  mode (not inline styles), validate language identifiers against Shiki's
  known list, fall back to plain-text for unknown languages.
- **Frontmatter parsing** — when added, use a safe-loader path (no
  arbitrary YAML tags / `!!js/function`); render frontmatter fields as
  text only.
- **Compressed share URLs (`#payload`)** — when added, validate compressed
  length before decompressing, treat decompressed content as untrusted
  markdown identical to other inputs.

## Supply chain posture

- **Lock file committed** (`pnpm-lock.yaml`), reproducible installs.
- **Review bar for new runtime dependencies:**
  - Active maintenance (commits in last 12 months)
  - No open high-severity CVEs
  - Preferred: zero or few transitive dependencies
- **Core package dependencies are scrutinized hardest** because they're
  inherited by every shell. Goal: core has < 5 runtime deps total.
  Currently: 3 (markdown-it, dompurify, highlight.js).
- **Third-party attribution**: regenerated by `pnpm licenses:gen`
  before each public release. See
  [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md).
- **No telemetry / network calls** from the core or from any shell.
  The URL loader is the only outbound network path, and only fires
  after explicit user action.

## Chrome extension specifics (when built)

- **Minimum permissions.** `activeTab` and user-granted `file://` access only. No `<all_urls>`, no `tabs`, no `cookies`.
- **Isolated world for content script.** Standard Manifest V3 isolation; never `eval` strings from the page.
- **No message-passing from page → extension** that triggers privileged actions. The popup is the only UI that can change settings.
- **CSP for extension pages:** even stricter than website — no `data:` images in popup.

## VS Code extension specifics (when built)

- **Webview CSP:** `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource};` — standard VS Code webview hardening.
- **`enableScripts: true`** only for our own scripts; `localResourceRoots` restricted to our extension's output directory.
- **No file reads outside the currently-open document** without explicit user action.

## Disclosure

- **Report:** Use GitHub's private vulnerability reporting on the repo's [Security tab](https://github.com/isherlock/nicermd/security/advisories/new) — never open a public issue for a vulnerability.
- **Response time:** acknowledgment within 7 days; patch or mitigation target 30 days for confirmed vulnerabilities.
- **Credit:** reporters acknowledged in the release notes unless they prefer otherwise.

## Testing

- **Red-team plan** lives in [`red-team/PLAN.md`](./red-team/PLAN.md) — maps
  every defence above to concrete test cases. Re-run before each public
  release.
- **Renderer hardening pack** in `packages/core/src/render.test.ts` pins
  the URI-scheme allowlist, the tag/attr allowlist (positive and
  negative), event-handler stripping on every permitted tag, and the
  external-link `rel` rule. Run on every commit via `pnpm test`. New
  allowlist entries must come with a hardening test in the same pass.

## Invariants

These are non-negotiable — if you're about to break one, stop and escalate:

1. The core never makes network calls.
2. Untrusted HTML never reaches the DOM unsanitised. Inline HTML is
   filtered by an allowlist regex at the markdown-it renderer level;
   block HTML and the final output are sanitised by DOMPurify with the
   tag/attr/URI configuration above. Write-mode HTML is parked into
   code blocks, rendered for preview through the same `sanitizeHtml`
   path, and unparked on save — there is no second sanitiser anywhere.
3. DOMPurify runs on all output before it reaches the DOM.
4. CSP has no `'unsafe-inline'` on `script-src`, no `'unsafe-eval'`
   anywhere, in any shell.
5. URL loader's host allowlist stays narrow; new hosts require an
   explicit CSP `connect-src` entry too.
6. No runtime dependency is added without meeting the supply-chain
   review bar above.
7. No shell bypasses the core to render markdown directly — all rendering
   goes through `nicermd-core`.
