<p align="center">
  <img src="public/icons/icon.svg" width="72" alt="Bookmark X logo" />
</p>

# Export Bookmarks X (Twitter) — Bookmark X

Bookmark X is an open-source Chrome extension for saving X bookmarks (formerly
Twitter bookmarks) and exporting them to a local, private TXT file. It captures
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

Requirements: Google Chrome 102 or later and an X account with access to
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
6. Select **Capture bookmarks**.
7. Keep the X tab open while the extension scrolls and waits for new items to
   load. You may close the popup.
8. Reopen Bookmark X to check the result.
9. Choose one of the TXT export options:

| Export option             | Result                                                       |
| ------------------------- | ------------------------------------------------------------ |
| **Download full archive** | Post URL, text, author, post date, archive dates, and status |
| **URLs only**             | One canonical X post URL per line                            |

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
- every TXT export contains at most one record or URL for each X status ID.

Running capture again is therefore safe and does not create duplicate archive
entries.

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

## Back up and restore your local library

Open **More options** and use **Download JSON backup** to save a complete local
copy of your bookmarks, notes, folders, tags, archive date, and Bookmark X
settings. The file is created in your browser and is never uploaded.

To restore it, choose the JSON file and one of these modes:

| Restore mode | Result                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| **Merge**    | Imported records win when an ID already exists; local-only records remain. |
| **Replace**  | Replaces the local library after an explicit confirmation.                 |

Bookmark X validates the entire file before changing local data. A restore is
blocked while bookmark capture is running. Keep a separate copy of important
backup files, especially before using **Replace**.

## Privacy and permissions

All extension-managed bookmark data stays in IndexedDB inside the current
Chrome profile. TXT exports and JSON backups are generated locally and
downloaded through Chrome. Bookmark X does not send your archive to a server.

The extension requests only the capabilities needed for capture:

- `activeTab` checks the current tab after you open the extension;
- `storage` saves capture state and the language preference locally;
- `unlimitedStorage` allows a larger local bookmark archive;
- `https://api.github.com/*` reads only this project's public star count for the
  open-source card in Settings. The result is cached locally for 24 hours, and
  no bookmark data or GitHub credentials are included;
- the content script is restricted to `https://x.com/i/bookmarks*` and
  `https://www.x.com/i/bookmarks*`.

Bookmark X does not read passwords, cookies, or unrelated X pages. Clearing the
local archive removes extension data only; it does not remove bookmarks from X.

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
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm smoke:chrome
```

`pnpm build` creates the unpacked extension in `dist`. Load that directory from
`chrome://extensions`, then select **Reload** after each rebuild.

Create a validated distribution package with:

```bash
pnpm package
```

The package command validates the build, creates
`release/bookmark-x-<version>.zip`, and refreshes the stable
`download/bookmark-x.zip` file. The Chrome smoke test uses an isolated temporary
profile to exercise the popup, Manifest V3 service worker, IndexedDB, runtime
messaging, TXT export, JSON backup round-trip, and archive clearing.

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

The **Release train** workflow builds the chosen batch with read-only
permissions, then opens a small preparation pull request containing the
version, changelog, lockfile, manifest, and ZIP. After that PR passes CI and is
squash-merged into `develop`, the workflow refreshes the single draft
`develop` to `main` pull request. Only merging that reviewed final pull request
can create the `vX.Y.Z` tag and GitHub Release. Publication is retry-safe and
validates the already reviewed archive before granting write access to the
publishing job.

The stable `download/bookmark-x.zip` file provides a simple link to the latest
ready-to-install build.

## Frequently asked questions

### Does Bookmark X use the X or Twitter API?

No. It reads the bookmarks rendered in the open, signed-in X page only after
you start capture. No API key or OAuth application is required.

### Why must the X bookmarks tab remain open?

X loads bookmarks progressively. Bookmark X scrolls that page and waits while X
is still loading more posts, so the tab must remain open until capture finishes
or you cancel it.

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
