# Privacy Policy — Nicer.md Chrome Extension

_Last updated: 2026-05-26_

## Summary

The Nicer.md extension does **not** collect, store, transmit to our
servers, sell, or share any of your data. There is no analytics, no
tracking, no advertising, no cookies, and no account. Everything the
extension does happens on your device, only when you explicitly ask
it to.

## What the extension does

The extension exists to send a URL or some selected text to the
[Nicer.md](https://nicer.md) web app so it can be rendered as
markdown. It acts only in response to a direct action you take:

- **Clicking the toolbar icon** (or pressing the keyboard shortcut) —
  opens the current tab's URL in a new Nicer.md tab.
- **Right-click → Nicer.md → Open in browser / Open in desktop** —
  opens the page (or a link you right-clicked) in Nicer.md, on the
  web or in the desktop app.
- **Right-click → Nicer.md → Render selection** — sends the text you
  have highlighted to a scratch document in Nicer.md.

If you never invoke the extension, it reads nothing and sends
nothing.

## What data the extension accesses, and when

| Data | When | Why | Where it goes |
|---|---|---|---|
| The active tab's URL | Only when you click the toolbar icon, press the shortcut, or pick a right-click menu item | To tell Nicer.md which page to render | Passed to the Nicer.md web app in your browser |
| A link's URL | Only when you right-click a link and choose a menu item | Same as above | Same as above |
| Text/HTML you have selected | Only when you choose "Render selection" | To render your selection as markdown | Same as above |

This is "website content" in Chrome's data-disclosure taxonomy. It is
**accessed transiently and never collected**: the extension does not
write it to disk, does not keep it after the action completes, and
does not send it to any server operated by the developer.

## How the hand-off works (no data in the URL bar)

When you invoke the extension, it generates a random one-time token,
holds the URL or selected text in the service worker's memory
associated with that token, and opens
`https://nicer.md/?ext-pickup=<token>`. The Nicer.md page then asks
the extension — over a channel restricted to `https://nicer.md` only —
for the data behind that token. The token is:

- **single-use** — consumed the first time it's retrieved, then
  discarded;
- **short-lived** — expires after 30 seconds whether used or not;
- **in-memory only** — never written to disk or browser storage.

This keeps the content (which may be long or sensitive) out of the
address bar, browser history, and referrer headers.

## What Nicer.md does with it

Nicer.md is a zero-server markdown reader. It renders everything
**in your browser** — there is no backend, no database, and no
logging of your content. For URLs on GitHub-family domains, your
browser fetches the markdown directly from GitHub
(`raw.githubusercontent.com` / `gist.githubusercontent.com`); that
request reaches GitHub's servers and is subject to
[GitHub's privacy policy](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
Selected text is rendered locally and never leaves your browser.

## Permissions, and why each is needed

- **`activeTab`** — lets the extension read the active tab's URL **at
  the moment you invoke it**, and nothing more. It grants no standing
  access to your browsing; the permission is active only for that
  single user-initiated action.
- **`contextMenus`** — registers the right-click "Nicer.md" menu.
- **`scripting`** — used solely by "Render selection" to read your
  highlighted selection as HTML (so formatting like bold, links, and
  lists is preserved), scoped to the active tab that `activeTab`
  already authorized. It is not used to inject anything into pages or
  to read pages you haven't acted on.
- **`externally_connectable: https://nicer.md/*`** — the only website
  permitted to message the extension, used exclusively for the
  one-time token hand-off described above.

The extension requests **no host permissions**, runs **no content
scripts**, and uses **no `storage`, `cookies`, `tabs` history, or
network/analytics** permissions.

## Data we do not collect or do

- We do **not** collect, store, or transmit your data to our servers
  (we don't operate one for this purpose).
- We do **not** sell or share your data with third parties.
- We do **not** use analytics, tracking pixels, fingerprinting, or
  advertising.
- We do **not** set cookies or use local/sync storage.
- We do **not** read pages, tabs, or browsing history outside the
  single action you initiate.

## Children's privacy

The extension is a general-purpose tool and is not directed at
children. It collects no personal information from anyone.

## Changes to this policy

If the extension's behavior changes in a way that affects this
policy, we'll update this document and the "Last updated" date above.
Material changes will be noted in the extension's release notes.

## Contact

Questions or concerns: open an issue at
[github.com/nicermd/nicermd](https://github.com/nicermd/nicermd/issues).
For anything you'd prefer to report privately, use the repository's
[private security advisory](https://github.com/nicermd/nicermd/security/advisories/new)
form.

---

_Nicer.md is open source (MIT). The extension's full source is at
[github.com/nicermd/nicermd](https://github.com/nicermd/nicermd/tree/main/packages/chrome-ext) —
you can verify every claim in this policy against the code._
