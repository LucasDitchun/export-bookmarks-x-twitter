# Chrome Web Store Assets

Run `pnpm assets:chrome-web-store` to rebuild the local submission assets from the
current `dist` bundle, a deterministic synthetic backup restored through the
extension runtime, and a final dimension/name validator.

The generated files live in [`docs/chrome-web-store/assets`](./assets/):

- `icon-128.png`
- `screenshot-01-dashboard-overview.png`
- `screenshot-02-library-inbox.png`
- `screenshot-03-bookmark-detail-note-tags.png`
- `screenshot-04-library-organization.png`
- `screenshot-05-library-archived-search.png`
- `small-promo-tile.png`
- `marquee-promo-tile.png`

The seeded listing fixture always includes three safe bookmarks, three tags, and
three folders with a `Reading / AI` hierarchy so the screenshots visibly cover
Inbox, On X now, Archived, note editing, organization, and search.

Run `pnpm assets:chrome-web-store:validate` to verify only the existing files.
