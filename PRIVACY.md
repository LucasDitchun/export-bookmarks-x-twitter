# Bookmark X Privacy Policy

Last updated: July 29, 2026

Bookmark X is a local-first Chrome extension that captures bookmarks rendered
on the X bookmarks page and exports them as text. It has no backend, analytics,
advertising, telemetry, or X API integration.

## Data handled

When you explicitly start capture on `x.com/i/bookmarks`, the extension may
read post IDs, text, author names and usernames, creation dates, and canonical
post URLs rendered for your signed-in session. It also stores capture
timestamps, counts, status metadata, and the selected interface language.

Bookmarks can contain private or sensitive information. Treat exported files
as private files.

The extension does not read or store your X password, cookies, session tokens,
email address, browsing history, or content from arbitrary pages.

## Purpose and processing

Data is used only to build and display your local archive and create the TXT
export you request. Bookmark records are stored in IndexedDB; small capture
checkpoints are stored in `chrome.storage.local`. Exported files are created
only on request and are then managed by Chrome and the operating system.
The selected interface language is stored in `chrome.storage.local`.

## Network access and sharing

Bookmark X does not send captured data to its developer or any extension-owned
server. It does not sell, rent, share, or use bookmark data for advertising,
profiling, or credit decisions.

X itself controls the page and network requests in the signed-in tab. Bookmark
X reads the resulting page DOM but does not make X API calls or extract
authentication credentials.

## Retention and deletion

Previously captured posts remain in the local archive until you choose
**Clear archive**, clear extension data, or uninstall the extension. Removing a
bookmark on X does not automatically erase its archived copy. Downloaded TXT
files must be deleted separately.

## Permissions

- `activeTab`: lets the popup verify the current user-invoked tab.
- `storage`: stores capture state and the interface language preference locally.
- `unlimitedStorage`: supports a durable local archive.
- The content script match is restricted to `https://x.com/i/bookmarks*` and
  `https://www.x.com/i/bookmarks*`.

Bookmark X does not request cookies, browsing history, downloads, or access to
arbitrary websites.

## Security and contact

Content-script messages are treated as untrusted and validated before storage.
The extension uses no remote executable code.

For privacy questions, use a public repository issue only when it contains no
personal data or bookmark content. Report sensitive issues through the private
process in [SECURITY.md](SECURITY.md).
