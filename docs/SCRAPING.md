# How DOM capture works

Bookmark X runs a content script only on `https://x.com/i/bookmarks*`. The
script starts only after the user presses the capture button.

For each visible `article[data-testid="tweet"]`, it locates a canonical
`/<username>/status/<numeric-id>` link and reads the post text, author area, and
`time[datetime]` when present. Media-only posts are valid even without text.
Post IDs deduplicate both repeated DOM nodes and timeline virtualization.

The content script scrolls the page and sends only newly discovered batches to
the extension service worker. The worker treats content-script messages as
untrusted input: it validates sender identity, source tab URL, run ID, batch
size, post IDs, canonical URLs, and field types before writing to IndexedDB.
IndexedDB is keyed by the canonical post ID, so a previously saved post is
refreshed instead of inserted again. The completed capture reports that count
discreetly as duplicates skipped, and TXT exports remain unique by post ID.

A complete run marks posts seen in that run as current and older missing posts
as archived. A cancelled or failed run never applies that missing-post step.
This prevents a partial page load from incorrectly archiving data.

## Limitations

- The user must already be signed in to X in the open tab.
- The X tab must stay open during capture.
- X can change its DOM or anti-automation behavior without notice.
- Protected or unavailable posts can only be captured if X renders them for the
  signed-in user.
- Bookmark folders are not inferred because their page DOM is not a stable
  source of membership metadata.

When selectors change, update the pure extractor fixtures first, then the
implementation. Never add cookie access, credential extraction, remote code,
or a bypass for X authentication.
