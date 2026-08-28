# We Remember Timetable Agents MVP

This repository contains a timetable-first family home with role-safe member Agents. The accepted credential-free V1.1 Fixture demo remains available for consented sharing, five-stage responsibility attribution, blocked handover, deterministic care escalation, and truthful App/Robot A3 evidence.

## Requirements

- Node.js 24
- pnpm 11.2.2

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://localhost:3000/` for the seven-day family timetable. Open `http://localhost:3000/demo` for the retained four-minute V1.1 flow, and use **Reset demo** before presenting to restore the timetable and demo state to the canonical local SQLite Fixture.

For local development:

```bash
pnpm dev
```

No provider credential is required. Without `STEPFUN_API_KEY`, or whenever provider enhancement fails, Agent answers use the deterministic Fixture intent router. Optional server-side provider configuration recognizes `STEPFUN_API_KEY` and `STEPFUN_MODEL`; keep their values in the local environment and never commit them.

## Verify

```bash
pnpm run test:unit
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:e2e
pnpm run test:a11y
```

Run `pnpm run build` before the Playwright commands. `test:unit` runs both colocated server/domain tests and Fixture contract tests. Playwright starts the built application, refuses to reuse an existing server, and runs serially because every browser test intentionally exercises the same persisted local Fixture and real API boundary.

## Demo path

Follow [docs/demo/FOUR_MINUTE_DEMO.md](docs/demo/FOUR_MINUTE_DEMO.md).

The demo requires no credentials. Robot A3 is disabled by default, and the runtime implements only `app` and `robot_a3` notification channels. This is a local, single-household Fixture with local SQLite persistence; it is not production authentication, multi-household tenancy, multi-user concurrency, live delivery, or real-device receipt evidence.
