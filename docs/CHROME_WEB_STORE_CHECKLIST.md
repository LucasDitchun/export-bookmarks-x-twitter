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
- [ ] English, Brazilian Portuguese, Japanese, Spanish, Simplified Chinese,
      German, French, and Italian copy is reviewed.
- [ ] Screenshots contain synthetic data only and do not imply affiliation with
      X Corp.

## Permissions

- [ ] `activeTab` is justified as checking the current user-invoked tab.
- [ ] `storage` is justified as storing local capture status and language
      preference.
- [ ] `unlimitedStorage` is justified as supporting a durable local archive.
- [ ] The only content-script matches are
      `https://x.com/i/bookmarks*` and
      `https://www.x.com/i/bookmarks*`.
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
- [ ] Full and URL-only TXT exports open correctly.
- [ ] Clearing the archive requires confirmation and does not alter X.
- [ ] Reloading the X page recovers from an unavailable content script.
- [ ] Unrelated X pages and arbitrary sites cannot be captured.

## Publish

- [ ] Review the final ZIP and diff.
- [ ] Confirm support, privacy-policy, repository, and contact URLs.
- [ ] Upload manually only after explicit maintainer approval.
- [ ] Record version, commit, checks, and publication date.
