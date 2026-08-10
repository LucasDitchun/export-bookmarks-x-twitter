# How DOM capture and live bookmark sync work

Bookmark X runs a content script on `https://x.com/*`. Full DOM capture and
scrolling start only on `/i/bookmarks` after the user presses the capture
button. On other X routes, the script remains passive until the user explicitly
clicks a bookmark button, apart from comparing visible numeric post IDs with the
local library for the metadata card described below.

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

The content script scrolls the page and sends only newly discovered batches of
at most 100 posts to the extension service worker. A `Set` keyed by canonical
status ID makes deduplication linear even for libraries with thousands of
items; DOM reads are grouped before each scroll write. The worker treats
content-script messages as
untrusted input: it validates sender identity, source tab URL, run ID, batch
size, post IDs, canonical URLs, and field types before writing to IndexedDB.
IndexedDB is keyed by the canonical post ID, so a previously saved post is
refreshed instead of inserted again. The completed capture reports that count
discreetly as duplicates skipped, and TXT exports remain unique by post ID.

## Full-review completion

Reaching the current document bottom is only a candidate for completion. The
runner observes the timeline through `MutationObserver` before it scrolls, then
requires repeated quiet end checks. Any visible progress bar, `aria-busy`
state, timeline mutation, or loader observed between checks resets the end
confirmation. A loader may disappear and reappear; its activity remains part
of that wait result even when it is already gone at the next DOM read. A loader
that exceeds the bounded retry budget produces an incomplete error, never a
successful end.

The content script also verifies the X bookmarks route before and after every
wait. Navigation, cancellation, page unload, a rejected stale run, delivery
failure, and extraction errors all leave the run incomplete. Only a completion
message carrying the validated `stable_end` reason can start reconciliation in
the service worker.

A successful full review marks posts seen in that run as current. With **Keep
archived bookmarks** enabled, older missing posts become archived. With it
disabled, missing posts and their folder-membership rows are deleted in the
same IndexedDB transaction. Cancelled, incomplete, stale, or failed runs keep
the batches already captured but discard their temporary seen markers and
never reconcile missing posts. Live bookmark events use their own intent state
and never participate in a full-review run ID or finalization.

## Quick updates and checkpoints

The capture card offers two modes. **Quick update** is the normal fast path for
new bookmarks; **Full review** deliberately traverses the whole list and is the
only mode that reconciles posts removed on another device. The first capture is
always a full review because there is no trustworthy stopping point yet.

After a successful capture, Bookmark X stores the first ten unique post IDs as
local checkpoints. A quick update scans from the newest items and stops only
after it sees three known checkpoint IDs consecutively. A repeated virtualized
DOM node is ignored, while any unknown ID resets the consecutive-match count.
This makes reordered or partly removed checkpoints safe without turning a
single coincidental match into an early stop.

At a checkpoint stop, every delivered batch is already committed to IndexedDB.
The worker saves the new checkpoint window and discards only that run's
temporary `seen` rows. It does not finalize the run, archive or delete absent
posts, apply the keep-archived setting, or change the timestamp of the last
successful full review.

If three consecutive checkpoints are never found, the runner continues with
the same loader, retry, route, and stable-end safeguards used by a full review.
Only after reaching a proven stable end does the worker convert it into a full
review and reconcile absences. Cancellation, navigation, delivery failure, and
loading timeout still keep partial batches but preserve the previous
checkpoints and never reconcile.

The popup shows a small reminder after 30 elapsed days without a successful
full review. The calculation compares absolute timestamps, so daylight-saving
and local-timezone boundaries cannot make the reminder early or late. Running a
quick update does not reset it.

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

## Local metadata decoration

Visible X articles are observed in animation-frame batches. The content script
sends at most 100 numeric post IDs per local lookup; the service worker reads the
matching bookmarks, tags, folder breadcrumbs, settings, and selected locale in
one batch. Only local matches receive a `bookmark-x-metadata` host immediately
after the post action group.

The card uses an open Shadow DOM and constructs every node with `createElement`,
`createTextNode`, and `textContent`; stored notes, folder names, and tags are
never parsed as HTML. It updates after confirmed live actions and metadata or
settings changes. Mutation records are batched, stale async results are ignored,
recycled articles are rebound to their new status ID, disconnected hosts are
discarded, and mutations caused by the component itself are ignored.

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
