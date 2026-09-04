# Chrome Web Store Assets

The submission assets live in [`docs/chrome-web-store/assets`](./assets/):

- `icon-128.png`
- `screenshot-01-search-library.png`
- `screenshot-02-organize-folders-tags.png`
- `screenshot-03-note-folder-tags.png`
- `screenshot-04-capture-recent.png`
- `screenshot-05-export-private.png`
- `small-promo-tile.png`
- `marquee-promo-tile.png`

## Curated screenshots

The five 1280×800 listing images are curated marketing assets created from real
Bookmark X interface references. They communicate the product flows for search,
folder and tag organization, bookmark context, recent capture, and local export.
Because their composition may be refined with image-generation tools, they are
not presented as literal, untouched browser screenshots.

Treat these five files as source assets. The asset command must never overwrite
them. When replacing one, preserve its exact filename, PNG format, and 1280×800
dimensions, and review it for an accurate representation of the current product.

## Local commands

Run `pnpm assets:chrome-web-store` to preserve and validate the five curated
screenshots, refresh the extension icon, and generate the small and marquee
promotional tiles. The marquee uses the first curated screenshot as its product
reference. This command no longer builds the extension or captures synthetic UI
states.

Run `pnpm assets:chrome-web-store:validate` to perform a read-only check of the
complete asset set. Validation enforces the exact five screenshot names, PNG
headers, and required dimensions locally:

- icon: 128×128
- screenshots: 1280×800
- small promotional tile: 440×280
- marquee promotional tile: 1400×560

Before publishing, visually inspect every image in addition to running the local
validator.
