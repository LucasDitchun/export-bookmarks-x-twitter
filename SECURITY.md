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

- The content script runs only on the X bookmarks route declared in the
  manifest.
- It reads rendered DOM; it must never access cookies, passwords, session
  tokens, or bypass X authentication.
- Messages from content scripts are untrusted. The service worker validates
  extension ID, tab URL and ID, capture run ID, batch size, post IDs, canonical
  URLs, and field types.
- Bookmark data and capture checkpoints remain in the Chrome profile.
- No remote executable code is permitted.
- Downloaded TXT files are outside the extension's control after export.
- X page availability and DOM behavior remain controlled by X.

If private data appears in a report, remove it and rotate any exposed
credential through the relevant provider before continuing.
