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
pnpm verify:local
```

Changed business logic should retain at least 80% line, function, and statement
coverage. The complete coverage, audit, package, semantic-model, and Chrome
smoke gate runs once when a maintainer promotes a batch to `staging`.

Record the exact commit and result in the pull request. If the local profile was
not run, keep the pull request in draft until it can be verified locally. Pull
requests to `develop` intentionally start no GitHub Actions.

## Commits and pull requests

Use Conventional Commit subjects such as `feat: capture bookmark DOM`.

Create feature and fix branches from `develop`, and target every contribution
pull request to `develop`. Compatible changes accumulate there without running
remote CI or publishing a version. A maintainer manually runs **Stage
candidate** once for the selected batch; the verified source and ZIP then move
to `staging`. Only a later, explicitly reviewed `staging` to `main` pull request
may publish a release.

A pull request should explain the user-visible outcome, list the exact local
commit and checks run, include screenshots for UI changes, call out
permission/privacy/storage changes, and contain no generated ZIP, browser
profile, real bookmark data, or unrelated edits.

Contributions are licensed under the repository's MIT License.
