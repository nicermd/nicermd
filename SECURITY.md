# Security

Nicer.md renders untrusted markdown in the user's browser. Markdown renderers have a long history of XSS bugs via sanitization gaps — this document names the threats we defend against, the ones we don't, and the specific defaults that enforce the policy.

## Threat model

### What we defend against

1. **XSS via rendered HTML.** Attacker crafts markdown designed to produce dangerous HTML when rendered (inline scripts, `javascript:` URLs, event handlers on tags, SVG with `<script>`, etc.).
2. **URL-shared payloads.** Attacker crafts `nicermd.com/#<compressed-payload>`, sends it to a victim, victim's browser loads it and renders the payload. This is our primary novel attack surface — shared URLs are an attacker-controlled code path, not user-typed content.
3. **HTML injection via markdown-it's HTML-in-markdown feature.** Raw HTML blocks inside markdown (`<script>alert(1)</script>` typed directly) would pass through markdown-it by default.
4. **Dangerous link/image URLs.** `javascript:`, `data:` with scriptable MIME types, `file:`, `vbscript:`.
5. **Malicious frontmatter.** Frontmatter fields rendered into the page as metadata without escaping.
6. **Supply chain.** A dependency update introduces a malicious package version.
7. **Service worker cache poisoning.** Attacker tricks the service worker into caching malicious content that's then served as "our" site.
8. **DoS via huge inputs.** Massive markdown strings, pathologically nested structures, or maximally compressed URL hashes designed to exhaust resources.

### What we don't defend against (explicit)

- **User pastes their own malicious content and views it.** They are both attacker and victim; not our problem.
- **Targeted social engineering** ("click this nicermd.com URL to see something interesting" when the content is actually phishing or NSFW). No different from any web link. We show a subtle indicator on URL-shared content so users know it came from a shared URL, not a local paste.
- **Compromise of the user's machine, browser, or extensions.** Out of scope.
- **TLS/MitM between the user and Cloudflare.** Cloudflare's infrastructure concern.
- **Chrome extension: content injection from arbitrary pages.** The content script runs on pages containing `.md` content; if that page is already compromised, we can't un-compromise it. We defend the extension's own surface but don't warrant the page it's injected into.

## Defaults that enforce the policy

### markdown-it configuration

```js
markdownIt({
  html: false,        // disable raw HTML in markdown source — critical
  linkify: true,      // auto-link URLs, but we validate via our rule override
  breaks: false,      // no soft-break → <br> (prevents confusing layout attacks)
  typographer: true,  // harmless typographic substitutions
})
```

`html: false` is the single most important default. It means `<script>alert(1)</script>` typed inside markdown source is rendered as literal text, not as HTML. Do not turn this on.

### DOMPurify pass on rendered output

Even with `html: false`, we run DOMPurify on the markdown-it output as a defense-in-depth layer. This catches:
- Anything that slipped through markdown-it's own escaping
- Anything produced by plugins (Shiki, KaTeX) that might have edge cases
- Future markdown-it bugs we haven't seen yet

Configuration:
- Allowed tags: standard markdown elements only (headings, paragraphs, lists, code, pre, a, img, table-related, blockquote, hr, strong, em, del, sub, sup, br, span/div with no attributes except class, math elements needed by KaTeX)
- Allowed attributes per tag: minimal — `href` on `a`, `src`/`alt`/`title` on `img`, `class` everywhere (themes use classes)
- Forbidden: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<button>`, `<style>`, any event handler (`on*`), any `javascript:` / `vbscript:` / `data:` URL except `data:image/*` on `<img>`
- URL schemes allowed on `<a href>`: `http`, `https`, `mailto`, `#` (fragment)
- URL schemes allowed on `<img src>`: `http`, `https`, `data:image/*` (with strict MIME check)

### KaTeX

- Run with `trust: false` (default). This disables `\href`, `\includegraphics`, and other commands that take URLs or paths.
- If `trust` is ever selectively enabled, it must reject any URL not matching our `<a href>` allowlist.

### Shiki

- Use the CSS-variables output mode, not the inline-style mode. This lets our CSP `style-src` omit `'unsafe-inline'`.
- Validate language identifiers against Shiki's known-language list before passing them in. Unknown language → fall back to plain-text code block, not an error or uncontrolled passthrough.

### Content Security Policy (website)

Set via Cloudflare Pages `_headers` file at site root:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data: https:;
  font-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'none';
  object-src 'none';
  upgrade-insecure-requests
```

Key properties:
- **No `'unsafe-inline'`** on `script-src` or `style-src` — requires Shiki in CSS-variable mode, no inline `<style>` tags, no inline event handlers.
- **No `'unsafe-eval'`** — nothing should need it. If a dependency requires `eval`/`new Function`, reject the dependency.
- **`connect-src 'self'`** — the core never calls the network; the website only fetches its own assets.
- **`img-src` allows `https:` and `data:`** so user-supplied markdown can reference external images. This is a deliberate loosening; alternative is to strip all remote images, which makes shared technical docs unusable.
- **`frame-ancestors 'none'`** — prevents embedding our site in iframes on other origins (clickjacking defense).

Additional headers:
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
X-Content-Type-Options: nosniff
```

### URL-shared content specifics

- The hash fragment is lz-string-compressed. Validate compressed length ≤ 2048 bytes before decompressing (DoS protection against decompression bombs).
- After decompressing, treat the content as untrusted markdown — identical sanitization path to pasted content.
- Display a small, persistent indicator when content came from a URL hash: "Shared via URL" with an option to clear. This gives users provenance awareness without being intrusive.
- Do not auto-render on page load until the DOM is ready and the CSP is active.

### Frontmatter

- Parse YAML frontmatter with `gray-matter` (or equivalent) that does NOT execute arbitrary YAML tags (`!!js/function`, custom constructors). Use the safe-loader path.
- Render frontmatter fields (title, author, date) as text only — never as HTML, never pass through markdown-it a second time.

### Service worker

- Cache only same-origin static assets (`.js`, `.css`, `.html`, `.woff2`, `.svg` from our own origin).
- Never cache responses where the response URL origin differs from our origin.
- Use versioned cache keys (`nicermd-v{build-hash}`) so deploys invalidate old caches cleanly.
- Network-first for HTML shells, cache-first for hashed assets.

## Supply chain posture

- **Lock files committed** (`pnpm-lock.yaml`), reproducible installs.
- **Dependabot** enabled for security advisories and version updates.
- **Review bar for new runtime dependencies:**
  - Must have > 1M weekly npm downloads OR be an Anthropic-maintained / well-known-maintainer package
  - Must have no open high-severity CVEs
  - Must have active maintenance (commits in last 12 months)
  - Preferred: zero transitive dependencies
- **Core package dependencies are scrutinized hardest** because they're inherited by every shell. Goal: core has < 5 runtime deps total.
- **No `postinstall` scripts allowed** in direct dependencies (use `--ignore-scripts` in CI; audit manually for any that need them).
- **No telemetry / network calls** from the core or from any shell without an explicit user opt-in. This is both a privacy stance and a supply-chain-attack reduction (compromised dependencies can't exfiltrate).

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

- **Report:** `security@nicermd.com` (Cloudflare Email Routing to maintainer) or a private GitHub Security Advisory.
- **Response time:** acknowledgment within 7 days; patch or mitigation target 30 days for confirmed vulnerabilities.
- **Credit:** reporters acknowledged in the release notes unless they prefer otherwise.

## Testing

- **Torture-test corpus** of pathological markdown files in `samples/security/` (XSS attempts from common CVE databases, malformed structures, unicode edge cases, maximum-depth nesting). Run through the core in CI on every PR; any rendering that produces executable output fails the build.
- **CSP is tested** in the deployed site via a simple integration check (curl the site, parse the CSP header, assert against the expected policy).
- **DOMPurify config is unit-tested** against a curated list of bypass attempts.

## Invariants

These are non-negotiable — if you're about to break one, stop and escalate:

1. The core never makes network calls.
2. markdown-it runs with `html: false`.
3. DOMPurify runs on all output before it reaches the DOM.
4. CSP has no `'unsafe-inline'` on `script-src` or `style-src`, no `'unsafe-eval'` anywhere.
5. No runtime dependency is added without meeting the review bar above.
6. No shell bypasses the core to render markdown directly — all rendering goes through `nicermd-core`.
