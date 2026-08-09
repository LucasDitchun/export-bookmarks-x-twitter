# Continuous integration and release architecture

Bookmark X uses a deliberately small CI topology. The goal is to provide one
authoritative result for each change, reuse work already accepted into
`develop`, and publish exactly the archive that reviewers approved.

## Invariants

- `main` is the primary and published branch. It never rebuilds or retests code
  already accepted by `develop`.
- Every ordinary pull request to `develop` runs one complete quality job. The
  job is not split into a matrix because each GitHub-hosted job starts on a new
  runner and repeats checkout, runtime setup, dependency restore, and teardown.
- Release preparation runs the expensive browser and real-model acceptance
  gates once. Its generated pull request rebuilds only to prove that the
  committed ZIP matches the reviewed source; it does not repeat lint,
  typechecking, or unit coverage.
- The required pull-request workflow is always triggered. Do not add path
  filters to it: GitHub can leave a required check pending when its entire
  workflow is skipped.
- Actions are pinned to full commit SHAs, permissions start empty or read-only,
  and write access is isolated to the jobs that open a preparation pull request
  or publish an accepted release.
- The Node.js release line is declared once in `.node-version`. pnpm is declared
  once in `package.json`. Workflows consume those declarations rather than
  duplicating tool versions.

## Event and gate matrix

| Event                                                  | Mode              | Work performed                                                                                                                                                                | Intentionally omitted                                     |
| ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Pull request to `develop`                              | `full`            | install, full dependency audit, formatting, lint, typecheck, policy and semantic contract tests, coverage, build, package; Chrome smoke only when its browser harness changes | real model download                                       |
| Push to `develop` changing the lockfile or CI workflow | `cache`           | fetch dependencies into the base-branch pnpm cache                                                                                                                            | source validation and build                               |
| Release preparation dispatch on `develop`              | release candidate | audit, release policy, real pinned-model validation, version/changelog generation, build, package, Chrome smoke, archive verification                                         | lint, typecheck, and coverage already proven by `develop` |
| Automated preparation pull request to `develop`        | `release`         | scope/provenance checks, audit, generated-file formatting, build, package, content-by-content ZIP comparison                                                                  | lint, typecheck, coverage, semantic contract tests        |
| Reviewed `develop` pull request to `main`              | promotion         | provenance, version, changelog, and reviewed ZIP validation                                                                                                                   | install, build, package, browser smoke, and test suite    |
| Merge into `main`                                      | publish           | verify merge ancestry, create or resume the tag and GitHub Release                                                                                                            | every build and source-quality gate                       |

The `full`, `release`, and `cache` modes keep one stable required-check name
while avoiding duplicate work. New features belong to the existing full gate;
they should not create another job unless they require a genuinely independent
trust boundary.

## Dependency caching

`actions/setup-node` caches the pnpm content-addressable store, never
`node_modules`. Pull-request caches are scoped to their merge reference and
cannot be reused by sibling pull requests. A small push job therefore warms the
cache on `develop` whenever the lockfile changes; subsequent pull requests can
restore that base-branch cache. Installs remain frozen and prefer cached
packages, so a missing cache changes performance but never dependency
resolution.

Do not cache `node_modules`, `dist`, semantic-model weights, or the generated
ZIP. Those outputs are platform-sensitive, large, security-relevant, or already
represented by short-lived release artifacts.

## Concurrency and cancellation

Feature CI is grouped by pull-request branch and cancels an obsolete run when a
new commit arrives. Release-train push synchronization also cancels stale work,
but a manual release preparation never cancels another preparation. Promotion
validation may cancel a stale revision; the closed-event publishing job may
not be cancelled.

This distinction prevents old commits from consuming runner time without
risking a partially created tag or release.

## Performance budget

The August 2026 baseline for an ordinary pull request was about 59 seconds of
job time. Formatting, lint, typechecking, and coverage represented roughly 33
seconds that were previously repeated during release preparation and again on
the generated release pull request. The optimized targets are:

- ordinary pull-request CI: no slower than 75 seconds at the 90th percentile;
- generated release pull-request validation: no slower than 45 seconds with a
  warm dependency cache;
- release preparation excluding the real model download: no slower than 90
  seconds;
- promotion validation: no slower than 20 seconds.

The repository is public, so standard GitHub-hosted runner minutes are not
currently billed. These budgets still reduce queue time, storage churn, energy
use, and future cost if repository visibility changes. Review actual job-step
durations after substantial toolchain changes rather than optimizing from
intuition.

## Release flow and recovery

1. Merge feature and fix pull requests into `develop` only after the full gate
   succeeds.
2. Dispatch the release train on the selected `develop` commit.
3. Review and merge the generated preparation pull request after its `release`
   gate proves scope, provenance, and ZIP equivalence.
4. Load the stable ZIP in Chrome and complete the manual acceptance checklist.
5. Mark the single `develop` to `main` pull request ready. Merging it is the only
   supported publication path.

Preparation and publication are retry-safe. Re-run the failed workflow at the
same commit; do not edit generated release files manually. A tag or archive at
an unexpected SHA is treated as a hard failure.

## Maintenance rules

- Dependabot owns updates to SHA-pinned actions and dependency lockfiles.
- Update `.node-version` only when adopting a supported Node.js release line;
  validate the full gate before merging that one-file runtime change.
- Keep the canonical `pnpm build`, `pnpm package`, and smoke commands in
  `package.json`. Workflows call those commands rather than copying their
  internals.
- Keep browser-harness smoke detection path-scoped inside the existing quality
  job. Ordinary feature pull requests must not pay for another browser launch
  or a second runner setup.
- Add workflow-policy tests before changing triggers, permissions,
  cancellation, release scope, or gate placement.
- Compare measured step durations before and after a CI change. Revert an
  optimization that weakens a trust boundary or moves work to another
  duplicated job.

No CI system can literally remain unchanged forever because GitHub Actions,
Node.js, browsers, and security advisories evolve. This architecture minimizes
that maintenance surface: tool versions have one source of truth, action
updates are automated, and policy tests protect the topology.

## Primary references

- [GitHub Actions billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)
- [`actions/setup-node` dependency caching](https://github.com/actions/setup-node#caching-global-packages-data)
- [`actions/upload-artifact` compression behavior](https://github.com/actions/upload-artifact#altering-compressions-level-speed-v-size)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
