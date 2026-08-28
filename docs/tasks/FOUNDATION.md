# Foundation Task Card

## Goal

Create the smallest runnable toolchain and frozen shared action/projection contracts without product implementation.

## Write Paths

- `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.*`, `eslint.config.*`, `playwright.config.*`, `.gitignore`
- `src/contracts.ts`

## Deliverables

- Pinned pnpm/Node-compatible dependencies and scripts.
- Strict action, projection, error, and adapter types matching `API_CONTRACT.md`.
- No App page, database, domain logic, Fixture data, or tests owned by another track.

## Acceptance

1. Dependency set is minimal and justified.
2. `pnpm install --frozen-lockfile` succeeds after lock creation.
3. Shared contracts contain no `any` and reject unsupported enterprise channels.
4. Root configuration is sufficient for Domain/Web/QA tracks.
5. Only assigned paths change; worktree is clean and pushed.
