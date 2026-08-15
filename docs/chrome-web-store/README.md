# Chrome Web Store Assets

Run `pnpm assets:chrome-web-store` to rebuild the local submission assets from the
current `dist` bundle, a deterministic synthetic backup restored through the
extension runtime, and a final dimension/name validator.

The generated files live in [`docs/chrome-web-store/assets`](./assets/):

- `icon-128.png`
- `screenshot-01-search-library.png`
- `screenshot-02-organize-folders-tags.png`
- `screenshot-03-note-folder-tags.png`
- `screenshot-04-capture-recent.png`
- `screenshot-05-export-private.png`
- `small-promo-tile.png`
- `marquee-promo-tile.png`

The product-led storyboard uses a deterministic local library with twelve safe
synthetic bookmarks, five tags, and three folders. In listing order, the five
screenshots show search, folder/tag organization, bookmark context, recent capture,
and local export. The real extension UI remains the dominant visual at a readable
scale; the surrounding black, off-white, and lime frame adds only a short stage
label and a three-to-four-word benefit.

The promotional tiles deliberately avoid collages of unreadable interface
miniatures. The small tile focuses on the product mark and promise, while the
marquee uses one enlarged search state as product proof.

Run `pnpm assets:chrome-web-store:validate` to verify only the existing files.
