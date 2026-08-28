# We Remember MVP V1.1

This repository contains the credential-free four-minute Fixture demo for consented sharing, five-stage responsibility attribution, blocked handover, deterministic care escalation, and truthful App/Robot A3 evidence.

## Requirements

- Node.js 24
- pnpm 11.2.2

## Run locally

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Use **Reset demo** before presenting so the local SQLite Fixture returns to its initial state.

For a production-mode local run:

```bash
pnpm build
pnpm start
```

## Verify

```bash
pnpm run test:unit
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:e2e
pnpm run test:a11y
```

`test:unit` runs both colocated server/domain tests and Fixture contract tests. Playwright runs serially because every browser test intentionally exercises the same persisted local Fixture and real API boundary.

## Demo path

Follow [docs/demo/FOUR_MINUTE_DEMO.md](docs/demo/FOUR_MINUTE_DEMO.md).

The demo requires no credentials. Robot A3 is disabled by default, and the runtime implements only `app` and `robot_a3` notification channels. Local Fixture evidence is not production authentication, live delivery, or real-device receipt evidence.
