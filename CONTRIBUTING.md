# Contributing to Bookmark X

Bug reports and focused pull requests are welcome.

## Before starting

- Search existing issues.
- Use synthetic bookmark fixtures; never publish private bookmark contents,
  cookies, credentials, or a real signed-in page snapshot.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm build
```

Load `dist` from `chrome://extensions` in Developer mode. No API credential or
environment file is required.

## Development expectations

- Keep the content script restricted to X bookmark routes.
- Treat DOM data and runtime messages as untrusted input.
- Update extractor fixtures before changing selectors.
- Preserve partial captures without marking unseen records archived.
- Avoid new permissions and dependencies unless their need is documented.
- Keep the extension local-only and free of remote executable code.

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
node --check scripts/version.mjs
node --check scripts/package.mjs
node --check scripts/chrome-smoke.mjs
pnpm test:coverage
pnpm build
pnpm smoke:chrome
pnpm package
```

Changed business logic should retain at least 80% line, function, and statement
coverage. The configured branch threshold is 75%.

## Commits and pull requests

Use Conventional Commit subjects such as `feat: capture bookmark DOM`.

A pull request should explain the user-visible outcome, list checks run,
include screenshots for UI changes, call out permission/privacy/storage
changes, and contain no generated ZIP outside the release workflow, browser
profile, real bookmark data, or unrelated edits.

Contributions are licensed under the repository's MIT License.
