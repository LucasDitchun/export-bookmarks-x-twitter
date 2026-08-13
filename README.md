<p align="center">
  <img src="public/icons/icon.svg" width="72" alt="Bookmark X logo" />
</p>

# Export Bookmarks X (Twitter) — Bookmark X

User guide: **English** · [Português](docs/i18n/pt-BR/USER_GUIDE.md) ·
[日本語](docs/i18n/ja/USER_GUIDE.md) · [Español](docs/i18n/es/USER_GUIDE.md) ·
[简体中文](docs/i18n/zh-CN/USER_GUIDE.md) · [Deutsch](docs/i18n/de/USER_GUIDE.md) ·
[Français](docs/i18n/fr/USER_GUIDE.md) · [Italiano](docs/i18n/it/USER_GUIDE.md)

Bookmark X is an open-source Chrome extension for saving X bookmarks (formerly
Twitter bookmarks) and exporting them to local, private TXT or Markdown files. It captures
bookmarks from your signed-in X bookmarks page, removes duplicates, preserves
posts that later disappear from X, and does not require an X API key.

The extension uses Manifest V3 and keeps its archive inside your current Chrome
profile. It has no backend, analytics, advertising, OAuth application, or
telemetry.

> Bookmark X is an independent project. It is not affiliated with, endorsed by,
> or sponsored by X Corp.

## Download the ready-to-install ZIP

[**Download the latest built extension as a ZIP**](download/bookmark-x.zip?raw=1)

This ZIP is already built. You do not need Node.js, pnpm, an API key, or a
developer account to use it. Google Chrome cannot load the ZIP directly, so
extract it before following the installation steps below.

Versioned ZIP files are also attached to
[GitHub Releases](https://github.com/LucasDitchun/export-bookmarks-x-twitter/releases).

## How to install Bookmark X in Google Chrome

Requirements: Google Chrome 116 or later and an X account with access to
`https://x.com/i/bookmarks`.

1. Download `bookmark-x.zip` using the link above.
2. Extract the ZIP to a permanent folder on your computer.
3. Open Google Chrome.
4. Enter `chrome://extensions` in the address bar and press **Enter**.
5. Turn on **Developer mode** in the upper-right corner.
6. Select **Load unpacked**.
7. Select the extracted folder that contains `manifest.json`.
8. Find **Bookmark X** in Chrome's extension menu and pin it for quick access.

Keep the extracted folder in place. Chrome loads the extension from that
folder, so deleting or moving it will disable the installation.

When a new version is released, download and extract the new ZIP, replace the
old folder, and select **Reload** on the Bookmark X card at
`chrome://extensions`.

## How to save and export X bookmarks

1. Sign in to X in Google Chrome.
2. Open `https://x.com/i/bookmarks`.
3. Wait until the bookmarks timeline is visible.
4. Open **Bookmark X** from Chrome's extension menu.
5. Confirm that the popup says the page is ready.
6. Choose **Recent** for new additions or **All bookmarks** to reconcile the
   whole list. The first capture automatically reviews all bookmarks.
7. Select the capture button.
8. Keep the X tab open while the extension scrolls and waits for new items to
   load. You may close the popup.
9. Reopen Bookmark X to check the result.
10. In **Export library**, optionally expand **Choose export filters**:

- choosing a folder includes that folder and all of its subfolders;
- choosing several tags includes a post when it has any selected tag;
- when folder and tag filters are both selected, a post must match the folder
  subtree **and** at least one tag;
- turn **Include archived posts** off to export only bookmarks that remain on X.

11. Select **Export .TXT** for readable plain text, or open the adjacent format
    menu and select **Export .MD** for structured Markdown.

The export is generated from one consistent local snapshot and ordered from the
newest post to the oldest. Duplicate status IDs are emitted once. Images use
their stable direct links. Videos use the canonical X post URL only: temporary
thumbnail, CDN, and MP4 addresses are never exported as video links.

Open **Settings → Export** to choose any combination of URL, post text, author,
post date, private note, folder breadcrumb, tags, images, videos, first capture,
and last-seen date. At least one field must remain enabled. The internal
current/archived status is intentionally not an export field.

Capturing is read-only with respect to X. Bookmark X does not add, remove, or
change bookmarks in your X account.

## How duplicate bookmarks are handled

Bookmark X identifies each post by its canonical X status ID:

- repeated copies created by timeline scrolling or DOM virtualization are
  discarded during capture;
- if a post already exists in the local archive, its details and last-seen
  state are updated instead of creating another entry;
- after capture, a small **“N duplicates skipped”** summary shows how many
  existing posts were not added again;
- every TXT or Markdown export contains at most one record for each X status ID.

Running capture again is therefore safe and does not create duplicate archive
entries.

## Quick updates and full reviews

Choose **Recent** to fetch new additions without traversing a large library
every time. By default, Bookmark X stops after 15 already-known posts appear
consecutively. Change that threshold under **Settings → Data** when a shorter or
more conservative overlap is preferable. The first capture always reviews
**All bookmarks**. If a recent update cannot prove the configured overlap, it
safely continues to the real end and becomes a complete review automatically.

A full review advances through the entire virtualized timeline, sends posts in
batches of at most 100, and confirms the end only after repeated quiet checks
at the real page bottom. Visible X progress indicators reset that confirmation,
including a loader that disappears and later returns. The extension shows a
discreet reminder after 30 days without a successful full review.

Only a successfully confirmed full review reconciles posts that were removed
on another device. Cancelling, leaving the bookmarks route, closing the tab,
an endless loader, or any other error keeps already captured data but never
archives or deletes an unseen post. By default, confirmed missing posts move to
**Archived**. Turn off **Settings → Data → Keep archived bookmarks** to remove
confirmed missing posts from the local library instead. This setting never
changes the user's bookmarks on X. A checkpoint-stopped quick update saves its
new batches but never archives or deletes unseen posts and does not reset the
full-review reminder.

## Live save and remove synchronization

On X pages, Bookmark X observes only explicit clicks on X's bookmark button. It
does not block or replace X's own click handler. The note interface opens in a
pending state, and the local archive changes only after X renders the new
bookmark state and keeps it stable. If X rejects or reverses the action, the
local archive remains unchanged.

Removing a bookmark archives it locally. Bookmarking the same post again makes
it current and restores its existing note, folder, and tags. Automatic opening
is enabled by default and can be disabled in **Settings → Behavior**; the same
setting chooses the in-page modal or Chrome Side Panel.

The modal accepts new values or suggestions from existing folders and tags.
Separate multiple tags with commas. A successful save closes the modal; an
error keeps it open so the draft is not lost.

## Organize notes, folders, and tags

Open **Library → Folders and tags** to see usage counts, filter the library,
create nested folders, and rename or delete folders and tags. Edit and delete
actions appear on hover or keyboard focus; touch devices keep them visible.
Deleting a folder leaves its posts uncategorized, while deleting a tag removes
that tag assignment. Both use a confirmation and a recoverable soft-delete
record internally instead of silently erasing related bookmarks.

## See your local context directly on X

When a visible X post already exists in your local Bookmark X library, a compact
card appears immediately after the post actions. Its isolated Shadow DOM shows
the folder and tags on separate, labeled rows, followed by a one-line note
preview. **Uncategorized** appears only when the post has neither a folder nor a
tag. Select **Edit** on the right to update its metadata. Unknown posts receive
no injected UI.

The card follows live saves, removals, modal edits, settings changes, and X's
virtualized timeline without duplicating itself. Open **Settings → Behavior** to
turn the mapped status, breadcrumb, tags, note, or categorization indicator on
or off individually. Large text and high contrast are enabled by default.

## Languages and manual language selection

The popup supports:

- English
- Brazilian Portuguese
- Japanese
- Spanish
- Simplified Chinese
- German
- French
- Italian

On first use, Bookmark X follows Chrome's interface language when that language
is supported. English is the default when the language cannot be identified or
is not supported.

To change the language manually, open the popup, expand **More options**, and
choose a language from the **Language** selector. The preference is stored
locally and used the next time you open Bookmark X.

The Home dashboard displays only the number of bookmarks currently found on X
and the last successful complete review. Under **Settings → Appearance**, date
format can follow the device or use day/month/year, month/day/year, or
year/month/day; time can follow the device or use 24-hour or 12-hour notation.

## Optional local semantic search

Text search works immediately and remains the default. If you want to find a
post from an incomplete memory of its meaning, open **More options → Search**
and choose **Download and enable** under **Optional semantic search**.

- nothing is downloaded until that explicit action;
- the pinned multilingual E5 model download is about 136 MB and is cached in
  this Chrome profile;
- inference runs in a dedicated Web Worker on this device, using WebGPU when
  available and packaged WebAssembly as the fallback;
- post text, author, private note, tags, and folder path are embedded locally
  and are never sent to Hugging Face or the project maintainer;
- lexical and semantic rankings are combined deterministically, while any
  model, offline, or device error falls back to normal text search;
- **Cancel**, **Reindex saved posts**, and **Remove model and index** control
  the complete local lifecycle. Removal also revokes consent.

The local vector index uses roughly 1.5 KB per saved post, plus IndexedDB record
overhead. Chrome's `unlimitedStorage` permission avoids the normal extension
quota, but it cannot create disk space. E5 truncates long inputs at 512 tokens,
and first-time indexing time depends on the number of posts and device speed.
See [Semantic search architecture and limitations](docs/SEMANTIC_SEARCH.md).

## Back up and restore your local library

Open **More options** and use **Download JSON backup** to save a complete local
copy of your bookmarks, notes, folders, tags, archive date, and Bookmark X
settings. Stable image links and video poster/canonical-post references are
included when X rendered them. The file is created in your browser and is never
uploaded.

To restore it, choose the JSON file and one of these modes:

| Restore mode | Result                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| **Merge**    | Imported records win when an ID already exists; local-only records remain. |
| **Replace**  | Replaces the local library after an explicit confirmation.                 |

Bookmark X validates the entire file before changing local data. A restore is
blocked while bookmark capture is running. Keep a separate copy of important
backup files, especially before using **Replace**.

Semantic model files, embeddings, device consent, and lifecycle state are not
included in JSON backups. Reindex after restoring if semantic search is enabled.

## Privacy and permissions

All extension-managed bookmark data stays in IndexedDB inside the current
Chrome profile. TXT/Markdown exports and JSON backups are generated locally and
downloaded through Chrome. Bookmark X does not send your archive to a server.

The extension requests only the capabilities needed for capture:

- `activeTab` checks the current tab after you open the extension;
- `storage` saves capture state and the language preference locally;
- `unlimitedStorage` allows a larger local bookmark archive;
- `https://api.github.com/*` reads only this project's public star count for the
  open-source card in Settings. The result is cached locally for 24 hours, and
  no bookmark data or GitHub credentials are included;
- `https://huggingface.co/*` and `https://*.cdn.hf.co/*` download only the
  pinned model weights, tokenizer, and configuration after explicit consent.
  All executable JavaScript and WebAssembly is packaged with the extension;
- the content script is restricted to `https://x.com/*` and
  `https://www.x.com/*`; it compares visible numeric post IDs with the local
  library to decorate matches, and reads full post fields outside the bookmarks
  page only after an explicit bookmark-button click.

Bookmark X does not read passwords or cookies. It never changes X on the
user's behalf: it only mirrors a bookmark change after X confirms it. Clearing
the local archive removes extension data only; it does not remove bookmarks
from X.

For details, read the [privacy policy](PRIVACY.md). Report security issues using
the private process in the [security policy](SECURITY.md).

## Development, testing, and local builds

Requirements: Node.js 22 or later and pnpm 10.33.2.

```bash
git clone https://github.com/LucasDitchun/export-bookmarks-x-twitter.git
cd export-bookmarks-x-twitter
pnpm install --frozen-lockfile
```

Run a development build that watches for changes:

```bash
pnpm dev
```

Run the quality checks:

```bash
pnpm verify:local
```

Pull requests to `develop` intentionally do not repeat this profile in GitHub
Actions. Keep an unverified pull request in draft until the exact commit passes
locally.

`pnpm build` creates the unpacked extension in `dist`. Load that directory from
`chrome://extensions`, then select **Reload** after each rebuild.

Create a validated distribution package with:

```bash
pnpm package
```

The package command validates the build, creates
`release/bookmark-x-<version>.zip`, and refreshes the stable
`download/bookmark-x.zip` file. The Chrome smoke test uses an isolated temporary
profile to exercise the popup, real Options and Side Panel entry pages,
Manifest V3 service worker, IndexedDB, runtime messaging, folder/tag-filtered
TXT and Markdown exports (including first-saved and last-seen fields), JSON
backup round-trip, and archive clearing. It also verifies that visiting Options
does not create semantic-search consent, a model cache, or a Hugging Face model
request.

## Versioning and releases

Bookmark X deliberately releases in batches. Features and fixes merge into
`develop` without creating a tag, so a busy development day still produces at
most the release selected by the maintainers.

Before `1.0.0`, Bookmark X follows a conservative
[ZeroVer](https://0ver.org/) policy: any non-empty backward-compatible batch
increments the patch once, while an incompatible batch increments the minor
once. From `1.0.0` onward, normal
[Semantic Versioning](https://semver.org/) applies: fixes increment patch,
features increment minor, and incompatible changes increment major. Commit
counts never become version numbers.

The manually dispatched **Stage candidate** workflow is the only complete
remote gate. It validates one exact `develop` snapshot, prepares the candidate
version and changelog, builds and smoke-tests the extension once, then moves
the sealed ZIP and source snapshot to `staging`. Repository dependencies never
execute in the write-scoped publication job.

The team tests `staging` before any public release. Only a later, explicitly
reviewed `staging` to `main` pull request can create the tag and GitHub Release;
that promotion validates the reviewed archive without reinstalling,
retesting, or rebuilding it.

The `download/bookmark-x.zip` file on `staging` provides a simple link to the
latest remotely tested build. The file on `main` remains the latest public
release.

Maintainers can find the event matrix, performance budgets, cache strategy, and
recovery rules in the [CI and release architecture guide](docs/CI.md).

## Frequently asked questions

### Does Bookmark X use the X or Twitter API?

No. It reads the bookmarks rendered in the open, signed-in X page only after
you start capture. No API key or OAuth application is required.

### Why must the X bookmarks tab remain open?

X loads bookmarks progressively. Bookmark X scrolls that page and waits while X
is still loading more posts, so the tab must remain open until capture finishes
or you cancel it. A loader that does not finish ends the review safely with an
error; it is never treated as proof that the list ended.

### Will repeated captures create duplicate bookmarks?

No. A canonical X status ID can have only one entry in the local archive.
Existing entries are refreshed and counted discreetly as duplicates skipped.

### Can Bookmark X recover deleted posts?

It preserves content that was captured earlier, even when that post is no
longer present in a later X bookmarks capture. It cannot recover a post that
was never captured.

### Why did capture stop working after an X update?

Bookmark X uses page scraping because X bookmarks are private account data. A
major X interface change may require updated selectors. Check the repository's
issues and install the latest release.

### Where is my archive stored?

It is stored locally in the Chrome profile where Bookmark X is installed.
Chrome profiles do not automatically share this archive with one another.

## Documentation and support

- [Bookmark X source code](https://github.com/LucasDitchun/export-bookmarks-x-twitter)
- [How X bookmark capture and page scraping work](docs/SCRAPING.md)
- [Chrome Web Store release checklist](docs/CHROME_WEB_STORE_CHECKLIST.md)
- [Contributing guide](CONTRIBUTING.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Issue tracker](https://github.com/LucasDitchun/export-bookmarks-x-twitter/issues)

## License

Bookmark X is open-source software released under the [MIT License](LICENSE).
Release ZIPs also include [third-party notices](THIRD_PARTY_NOTICES.md) and the
complete license texts for the packaged Transformers.js and ONNX Runtime Web
code and the optional multilingual E5 model data. Node-only sharp/libvips build
tools are not included in the browser ZIP.
