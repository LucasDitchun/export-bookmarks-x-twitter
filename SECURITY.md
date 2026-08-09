# Security Policy

## Supported versions

Security fixes are applied to the latest code on the default branch until
versioned releases are published.

## Reporting a vulnerability

Do not open a public issue containing bookmark data, personal information, a
proof of concept against a real X account, or details that enable exploitation.
Use GitHub private vulnerability reporting when enabled. Otherwise contact the
maintainer privately through the repository profile and include the affected
version, impact, reproduction steps using synthetic data, and a suggested
mitigation if available.

## Security boundaries

- The content script is declared for `x.com` and `www.x.com` so it can mirror
  explicit bookmark-button actions and decorate known posts across X. Automatic
  storage lookups and injected metadata are restricted to visible numeric post
  IDs that already exist in the local library. Full post extraction outside
  `/i/bookmarks` happens only after an explicit user bookmark action.
- Full timeline capture runs only on `/i/bookmarks` after the user starts it.
  The content script reads rendered DOM; it must never access cookies,
  passwords, session tokens, or bypass X authentication.
- Messages from content scripts are untrusted. The service worker validates
  extension ID, tab URL and ID, capture run ID, batch size, post IDs, canonical
  URLs, and field types.
- Bookmark data, settings, semantic-search consent, indexes, and capture
  checkpoints remain in the Chrome profile. Optional model data is downloaded
  only after explicit consent and inference stays local.
- No remote executable code is permitted.
- TXT and Markdown exports, plus complete JSON backup files, are generated
  locally. They are outside the extension's control after download and may
  contain private notes and retained posts.
- X page availability and DOM behavior remain controlled by X.

If private data appears in a report, remove it and rotate any exposed
credential through the relevant provider before continuing.
