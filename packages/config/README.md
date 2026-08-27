# Shared Developer Harness

This directory documents the repository-wide build and verification contract. It contains no product behavior, runtime configuration, credentials, or personal data.

The supported toolchain is Node.js 24 and pnpm 11.2.2. Pinning both versions keeps local and CI behavior aligned while Node.js 24 is the selected LTS runtime for this delivery.

## External dependency policy

All external dependencies are declared once in the root `package.json` and resolved exactly by `pnpm-lock.yaml`. Workspace packages may declare names and exports later, but feature tracks must not add external dependencies or mutate the root lockfile.

| Dependency group | Included packages | Why it exists |
| --- | --- | --- |
| Web runtime | `next`, `react`, `react-dom` | The approved responsive App Router surface. |
| Data and validation | `drizzle-orm`, `postgres`, `zod` | Typed PostgreSQL access, migrations, and trust-boundary validation. |
| Build and static checks | `typescript`, TypeScript types, `eslint`, `eslint-config-next`, `typescript-eslint` | Strict shared type and lint gates for Node, React, and Next.js. |
| Unit and contract tests | `vitest` | One deterministic runner for function, contract, and repository tests. |
| Browser acceptance | `@playwright/test`, `@axe-core/playwright` | Fixture E2E, accessibility, and screenshot evidence with one browser harness. |
| Migration authoring | `drizzle-kit` | Schema-driven SQL migration generation and inspection. |

There is deliberately no AI SDK, styling framework, DOM unit-test stack, container library, or environment-file package. Optional AI uses built-in `fetch` behind the frozen provider contract; CSS uses platform primitives; browser behavior uses Playwright; disposable PostgreSQL verification uses the local container/runtime boundary and the locked `postgres` driver.

## Supply-chain controls

pnpm denies dependency build scripts by default. The workspace allows only `esbuild`, which verifies the native build binary used by Vitest and Drizzle Kit, and `sharp`, which provides Next.js image processing.

The workspace also pins three transitive fixes without adding feature dependencies: `sharp@0.35.3` for [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), `postcss@8.5.26` for [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) and its [incomplete-fix advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), and `esbuild@0.25.4` only below `@esbuild-kit/core-utils` for [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). Changing or removing these pins requires a foundation review, a frozen install, the relevant tool smoke test, and a fresh dependency audit.

## Root command contract

| Command | Contract |
| --- | --- |
| `pnpm run check:foundation` | Typecheck, lint, and smoke-test the shared harness. |
| `pnpm run check:contracts` | Typecheck and run focused checks for `packages/contracts`. |
| `pnpm run check:data` | Typecheck and run focused checks for `packages/db`. |
| `pnpm run check:experience` | Typecheck and run focused checks for `apps/web`. |
| `pnpm run check:conversation` | Typecheck and run focused checks for conversation, witness, and safety modules. |
| `pnpm run check:responsibility` | Typecheck and run focused checks for responsibility and domain-draft modules. |
| `pnpm run check:handover` | Typecheck and run focused checks for handover and its draft adapter. |
| `pnpm run check:care` | Typecheck and run focused checks for deterministic care behavior. |
| `pnpm run check:privacy` | Typecheck and run focused checks for privacy and deletion behavior. |
| `pnpm run check:qa-core` | Typecheck and run focused checks for fictional fixtures and the contract harness. |
| `pnpm run check:qa` | Typecheck and run focused checks for the completed QA-owned paths. |
| `pnpm run check` | Run the complete static, lint, unit, and contract suite. |
| `pnpm run db:verify` | Run disposable database tests under `packages/db/tests/disposable`. |
| `pnpm run build` | Build the Next.js application in `apps/web`. |
| `pnpm run test:e2e:fixture` | Run Playwright tests tagged `@fixture`, including accessibility, excluding screenshots. |
| `pnpm run test:accessibility:fixture` | Run Playwright tests tagged `@a11y`. |
| `pnpm run test:visual:fixture` | Run Playwright screenshot tests tagged `@visual`. |

Focused checks fail when their owned path or tests are missing. Future Playwright tests must include `@fixture`; accessibility cases also include `@a11y`, and screenshot cases also include `@visual`.
