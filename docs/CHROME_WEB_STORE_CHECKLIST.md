# Chrome Web Store release checklist

## Listing and privacy

- [ ] The listing states the single purpose: capture the signed-in user's X
      bookmarks into a local archive and export TXT.
- [ ] It clearly says page scraping is used and that X interface changes can
      temporarily break capture.
- [ ] It states there is no X API, backend, analytics, advertising, sale of
      data, or telemetry.
- [ ] Data disclosures cover post text, authors, dates, URLs, capture metadata,
      local retention, and separately downloaded exports.
- [ ] The listing says semantic search is optional, downloads about 136 MB only
      after consent, runs locally, and can be removed completely.
- [ ] English, Brazilian Portuguese, Japanese, Spanish, Simplified Chinese,
      German, French, and Italian copy is reviewed.
- [ ] Screenshots contain synthetic data only and do not imply affiliation with
      X Corp.

## Permissions

- [ ] `activeTab` is justified as checking the current user-invoked tab.
- [ ] `storage` is justified as storing local capture status and language
      preference.
- [ ] `unlimitedStorage` is justified as supporting a durable local archive.
- [ ] `https://huggingface.co/*` and `https://*.cdn.hf.co/*` are justified as
      pinned model-data downloads after consent; no remote code is loaded.
- [ ] The only content-script matches are `https://x.com/*` and
      `https://www.x.com/*`; outside `/i/bookmarks`, post processing requires
      an explicit bookmark-button click.
- [ ] There are no broad host permissions, cookie/history permissions,
      externally connectable origins, or web-accessible resources.

## Build and quality

- [ ] Version metadata matches the manifest.
- [ ] Dependencies come from the committed lockfile with Node.js 22+.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `version.mjs`, `package.mjs`, and `chrome-smoke.mjs` pass `node --check`.
- [ ] `pnpm test:coverage` passes.
- [ ] `pnpm build`, `pnpm smoke:chrome`, and `pnpm package` pass.
- [ ] The ZIP has `manifest.json` at its root and contains no source maps,
      environment files, private keys, test fixtures, real bookmark data, or
      remote executable code.

## Manual acceptance

- [ ] A signed-in user can open `x.com/i/bookmarks` and start capture.
- [ ] The page scrolls, counts increase, and closing the popup does not stop the
      content script.
- [ ] Duplicate/virtualized posts appear once and the completed capture reports
      the already-saved count discreetly.
- [ ] Media-only posts are retained.
- [ ] Cancelling keeps captured records without archiving unseen records.
- [ ] A complete second capture marks missing older posts archived.
- [ ] A loader that disappears and returns delays completion; an endless loader
      fails safely without reconciling unseen records.
- [ ] Leaving the bookmarks route or closing the tab never reconciles unseen
      records.
- [ ] With **Keep archived bookmarks** off, only a proven full review deletes
      missing local records and leaves their folders intact.
- [ ] Full and URL-only TXT exports open correctly.
- [ ] Clearing the archive requires confirmation and does not alter X.
- [ ] Reloading the X page recovers from an unavailable content script.
- [ ] A bookmark click opens the selected surface pending; a stable confirmed
      save adds it, and a stable confirmed remove archives it.
- [ ] X failure/reversal changes no local record; rebookmark restores note,
      folder, and tags.
- [ ] Arbitrary non-X sites cannot be captured.
- [ ] Before consent, semantic search creates no worker download and text search
      remains fully functional.
- [ ] Model download progress is announced, cancellation terminates the worker,
      and removal clears the dedicated cache, index, and consent state.
- [ ] WebGPU and packaged WASM fallback both work; offline/model failures return
      normal lexical results without blocking the UI.

## Publish

- [ ] Review the final ZIP and diff.
- [ ] Confirm support, privacy-policy, repository, and contact URLs.
- [ ] Upload manually only after explicit maintainer approval.
- [ ] Record version, commit, checks, and publication date.
