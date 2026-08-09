# How DOM capture and live bookmark sync work

Bookmark X runs a content script on `https://x.com/*`. Full DOM capture and
scrolling start only on `/i/bookmarks` after the user presses the capture
button. On other X routes, the script remains passive until the user explicitly
clicks a bookmark button.

For each visible `article[data-testid="tweet"]`, it locates a canonical
`/<username>/status/<numeric-id>` link and reads the post text, author area, and
`time[datetime]` when present. Media-only posts are valid even without text.
Post IDs deduplicate both repeated DOM nodes and timeline virtualization.

For posted images, the extractor reads the browser-selected `currentSrc` and
keeps direct anonymous HTTPS URLs only from X's stable image host
(`pbs.twimg.com`). The first DOM occurrence wins when the same image is rendered
more than once. For video, Bookmark X stores a stable poster thumbnail and the
canonical X post URL. It never persists `video.currentSrc`, `<source>` URLs,
direct MP4/CDN URLs, `blob:` URLs, or `data:` URLs as permanent video links.
Bookmark X does not fetch or download media; it records validated URLs already
rendered by X.

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

## Live bookmark confirmation

The live observer listens in the capture phase without calling
`preventDefault()` or `stopPropagation()`, so X owns the action. It captures the
post snapshot, opens the configured modal or Side Panel in a pending state, and
watches the mutable SPA DOM for `data-testid` and `aria-pressed` changes. A
change must remain stable before the service worker receives a confirmation.

Timeouts, reversals, SPA replacement, and superseded clicks send cancellation
instead and never write bookmark state. A confirmed remove archives the local
record. A confirmed rebookmark refreshes public post fields while retaining the
original note, folder, tags, first-saved date, and metadata timestamp. All
content-script payloads and X sender URLs are validated again in the service
worker before IndexedDB writes.

## Limitations

- The user must already be signed in to X in the open tab.
- The X tab must stay open during capture.
- X can change its DOM or anti-automation behavior without notice.
- Protected or unavailable posts can only be captured if X renders them for the
  signed-in user.
- Bookmark folders are not inferred because their page DOM is not a stable
  source of membership metadata.
- A missing or rejected media URL leaves the bookmark intact; media capture is
  best effort and never broadens host permissions.

When selectors change, update the pure extractor fixtures first, then the
implementation. Never add cookie access, credential extraction, remote code,
or a bypass for X authentication.
