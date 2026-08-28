# We Remember V1.1 Lite Plan

## Goal

Build the four-minute PRD demo path on a clean branch without importing the old engineered platform.

## Core Path

Private subject message -> explicit sharing -> persisted five-stage report -> blocked handover -> information plus two confirmations -> atomic owner/reminder transfer -> confirmed deterministic care rule -> App/A3 notification -> timeout/escalation -> closure.

## Reuse

- Keep `prototype.html`, `style-options.html`, and `dujide-logo-roof-ink.svg` from clean `origin/main`.
- Reuse Style A tokens, Chinese product copy, fictional household facts, and small pure transition ideas only after review.
- Record any copied code's old path and commit in the owning task report.

## Do Not Migrate

- Fleet Kit, `.agents`, orchestration scripts, Git hooks, monorepo packages, old contract/data packages, broad migrations, historical manifests, old run state, or production-shaped abstractions.

## Tracks

1. Foundation — root toolchain and `src/contracts.ts` only.
2. Domain — `src/domain/**`, `src/server/**`, `src/app/api/**`.
3. Web — `src/app/(ui)/**`, root App files, `src/components/**`, `public/**`.
4. QA — `fixtures/**`, `tests/**`, `docs/demo/**`.
5. Integration — exact merges plus minimal root wiring and README.

## Waves

- Wave 0: foundation scaffold and frozen contract checks.
- Wave 1: Domain, Web, and QA work in parallel from the foundation commit.
- Wave 2: the same track agents fix failed acceptance.
- Wave 3: one integration worker merges accepted SHAs and runs final verification.

## Final Checks

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test:unit
pnpm run build
pnpm run test:e2e
pnpm run test:a11y
git diff --check
git status --short --branch
```
