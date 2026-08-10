# Continuous integration and staging architecture

Bookmark X deliberately runs GitHub Actions only when a remote runner adds new
confidence. Feature work is verified locally, while one manually selected
`develop` snapshot receives the complete remote gate before it becomes
`staging`.

## Branch and event matrix

| Source           | Destination | Trigger                         | Validation                                             | GitHub-hosted minutes               |
| ---------------- | ----------- | ------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| feature/fix      | `develop`   | pull request                    | `pnpm verify:local`, recorded in the PR                | none by default                     |
| any exact commit | none        | manual **On-demand validation** | the same `verify:local` profile                        | only when local evidence is missing |
| `develop`        | `staging`   | manual **Stage candidate**      | complete staging profile, build, ZIP, and Chrome smoke | once per selected batch             |
| `staging`        | `main`      | reviewed pull request           | provenance, version, and committed ZIP only            | seconds; no rebuild                 |

No workflow listens to pushes or pull requests targeting `develop`. This is
intentional: a skipped workflow cannot safely be a required check, and rerunning
the same suite after a contributor already ran it locally wastes both time and
Actions quota.

## Canonical verification profiles

The command lists live in `scripts/verification-plan.mjs`, not in workflow
YAML. A future test or gate is added there once and automatically reaches every
caller.

```bash
# Normal contribution loop
pnpm verify:local

# Complete release-candidate gate (normally run only by Stage candidate)
pnpm verify:staging
```

`verify:local` runs formatting, lint, typecheck, the test suite, and a production
build. `verify:staging` runs the dependency audit, formatting, lint, typecheck,
release and semantic contracts, coverage, one production build, the pinned
semantic-model check, one package operation, and one Chrome smoke run.

Each profile prints the duration of every material step. Those measurements are
the source for future estimates and make slow regressions visible without
splitting work across multiple runners.

## When local checks were not run

Use **Actions → On-demand validation → Run workflow** and provide the full
40-character commit SHA. The workflow checks out exactly that commit and runs
`pnpm verify:local`. It never runs automatically and cannot publish anything.

## Creating a staging candidate

1. Confirm that the intended feature pull requests are merged into `develop`.
2. Open **Actions → Stage candidate**.
3. Select the `develop` branch and run the workflow.
4. The read-only job installs dependencies once and runs `pnpm verify:staging`.
5. Only after every gate passes, a separate write-scoped job seals the ZIP,
   merges the exact validated snapshot into `staging`, and commits the verified
   `download/bookmark-x.zip`.
6. Test the unpacked extension or download the ZIP directly from `staging`.

The workflow has a single concurrency group with `cancel-in-progress: true`, so
a newer manually selected batch cancels an obsolete one. Repository code and
dependencies never execute in the job holding `contents: write`.

## Main release

`main` remains the public release branch. Promotion is never automatic: a
same-repository pull request from `staging` to `main` must be opened explicitly.
Its check validates provenance, version agreement, archive integrity, and the
reviewed ZIP without installing dependencies, running tests, or rebuilding.

The current project work stops at `staging` until its build has been manually
tested. Do not open or merge the `staging` → `main` pull request as part of a
staging cycle.

## Caching and maintenance

- `actions/setup-node` restores the pnpm store from `pnpm-lock.yaml`.
- The frozen install happens once in each intentionally requested runner.
- Build, package, semantic-model validation, and Chrome smoke each happen once
  per staging batch.
- Third-party actions remain pinned to immutable commit SHAs and are updated by
  Dependabot.
- Workflow-policy tests protect the event matrix, permissions, action pins, and
  absence of duplicate expensive commands.

No CI configuration can literally remain unchanged forever: GitHub Actions,
Node.js, Chrome, and security advisories evolve. Keeping one command plan and
three small workflows minimizes that maintenance surface without weakening the
release boundary.

## Official references

- [Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Automatic token authentication and permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication)
