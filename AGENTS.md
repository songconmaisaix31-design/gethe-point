# Project Instructions

- Project: We Remember MVP V1.1
- Initialized: 2026-08-28
- Stack: Next.js, React, strict TypeScript, Node SQLite, Zod, Playwright
- Package manager: pnpm
- Visual source of truth: `prototype.html`, Style A tokens

## Goal

Build only the four-minute MVP demo path. Every change must directly support consented sharing, persisted five-stage responsibility, blocked handover, deterministic care escalation, or truthful App/A3 notification evidence.

## Working Rules

- Read `PRD.md`, `Tech-Spec.md`, `API_CONTRACT.md`, and `ORCA_WORKTREE_LITE.md` before implementation.
- Keep one Web application and one lightweight persistence boundary. Do not create a monorepo, package graph, framework, custom scheduler, Fleet Kit, proof system, or generic platform.
- Prefer platform APIs and installed dependencies. Add a dependency only when it removes more risk or code than it adds.
- Reuse `prototype.html`, `style-options.html`, and `dujide-logo-roof-ink.svg`. Selectively migrate old implementation code only at function/component level after review; never cherry-pick or merge an old implementation branch wholesale.
- Do not migrate `.agents/`, Fleet scripts, Git hooks, old contract packages, old database packages, historical run state, release manifests, or verification bureaucracy.
- Preserve unrelated user changes and never modify protected `main`.
- Code, comments, filenames, commits, README, and technical docs use English. Product UI copy is Chinese.

## Safety Invariants

- Direct-message content remains self-only until the speaker gives explicit per-item consent.
- Incomplete information or missing confirmation keeps handover blocked and does not transfer ownership.
- Unconfirmed care rules never activate. Care timing, timeout, escalation, acknowledgement, and closure contain no LLM calls.
- Reports use persisted five-stage attribution and neutral templates; never score, rank, diagnose, or blame people.
- External input starts as `unknown` and is validated at the boundary.
- Never read, print, copy, or store `.env`, tokens, webhook URLs, cookies, private keys, or credentials.
- `ENABLE_ROBOT` defaults to `false`. Live provider acceptance is never presented as user receipt or acknowledgement.

## Ownership

- Coordinator: specifications, plan, task cards, status, decisions, and acceptance only.
- Foundation: root toolchain and shared contracts.
- Domain: `src/domain/**`, `src/server/**`, `src/app/api/**`.
- Web: `src/app/(ui)/**`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/**`, `public/**`.
- QA: `fixtures/**`, `tests/**`, `docs/demo/**`.
- Integration: exact merges and minimal root/assembly glue; domain defects return to their owner.

## Verification

- Install: `pnpm install --frozen-lockfile`
- Typecheck: `pnpm run typecheck`
- Lint: `pnpm run lint`
- Unit tests: `pnpm run test:unit`
- Build: `pnpm run build`
- Fixture E2E: `pnpm run test:e2e`
- Accessibility: `pnpm run test:a11y`

