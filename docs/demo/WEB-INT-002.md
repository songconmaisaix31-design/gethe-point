# WEB-INT-002 Responsive Web App Local Acceptance

Status: accepted for the local hackathon MVP only

Date: 2026-08-28

## Outcome

The responsive single-role Web App was assembled from immutable owner-track
commits, exercised through a real built Next.js server and its real HTTP API
against disposable PostgreSQL, and accepted at desktop, tablet, and mobile
viewports. The final integrated source head before this evidence document is
`a5f47e6d6fc1bf250f55634888cc97f207b0cc38`.

This receipt is local acceptance evidence. It is not production, deployment,
release, live-account, identity-provider, or external-provider evidence.

## Immutable integration provenance

The logical base was
`d993660d9dae5d402097470a901878329640b043`. The five requested sources were
merged in the requested order, each with `--no-ff`:

| Order | Immutable source | Owner delivery | Integration merge receipt |
| --- | --- | --- | --- |
| 1 | `df9b5b3787715c9582aafcc3a936fa6afe3918c4` | Origin visual sources | `ae37d4a3432636cc8c3337669341856651cfd693` |
| 2 | `9ea6e29ce748bf4826c623b3658ca40fef42b91e` | `WEB-UI-001` responsive UI | `541cf29a9487a2f9d0ddce2f79af97ff52818d6b` |
| 3 | `8ac264900706f25239c3586bd641224ac430ea20` | `WEB-STATIC-002` static acceptance | `b63229ccdba777d416669da0d1dd99ecdfce2472` |
| 4 | `6b534006d7f6042603aa4a022aef961b01f1b621` | `WEB-QA-002` responsive QA, including parent `8826f75b63c03d864677f1d207c8e2f2aabf45e0` (`WEB-QA-001`) | `51a5484da927a131f19fdd15ba8437d94e3f5d08` |
| 5 | `691b104787802ca5da1dd224e4d2c48d130dd902` | `WEB-MEM-001` decision memory | `29a7f7fd137b4d24ea5d42d3fb8817f03007f554` |

Owner tracks supplied the following immutable corrections after integration
exposed acceptance mismatches. Each correction was coordinator-authorized and
merged once with `--no-ff`; no source history was amended or rebased.

| Immutable source | Owner delivery | Integration merge receipt |
| --- | --- | --- |
| `52574c19804d2166dde3fc8463d8bc0be8f70e3c` | `WEB-STATIC-003` card contract alignment | `b789208f9481c69d1358bd82460602e78d101f79` |
| `467139889bd794c6d6512a97730e110c84f81db2` | `WEB-QA-004`, including parent `3a0f8d570cef9b219b4975938ba374a1679981fa` (`WEB-QA-003`) | `6fd049309898f6f05e172b78a9d42eb7f96db682` |
| `b60db86abbba3915c41e402eaee682f282158fa8` | `WEB-QA-005` adjacent card-zone acceptance | `7303e3dc8345af205e723e31f2a667ab5a6d71bd` |
| `b8dc888d98bfe3bd703795d71effd8309121e80e` | `WEB-QA-007` bounded mobile gutter acceptance | `a5f47e6d6fc1bf250f55634888cc97f207b0cc38` |

## Product handoff rehome

The responsive product acceptance was copied byte-for-byte from:

`C:/Users/DW/orca/workspaces/gethe-point/fleet-control-mvp-repair-v3/.agents/handoffs/WEB-UI-001-responsive-spec.md`

to:

`docs/demo/MVP-WEB-APP-RESPONSIVE.md`

Both files had SHA-256
`e3223824d273fcbe4f427417998cc7d1ef0d929d770af62bb28947b26a6164e5`
at integration time.

## Runtime receipt

- The built application was bound only to `127.0.0.1:51456`; the port was
  verified unused before startup.
- Next.js served the real fixture page and the real
  `/api/fixtures/mvp-core/{state,reset,commands}` handlers.
- Disposable PostgreSQL container
  `we-remember-web-int-002-20260828044336-7f13ab7185` carried task and Dispatch
  labels for `WEB-INT-002` and `ctx_13d723ae7c07`.
- `packages/db/migrations/0000_initial.sql` was applied to the isolated
  database before the app started.
- The database connection was passed only through `MVP_CORE_DATABASE_URL`. Its
  value was neither printed nor persisted.
- The final six-scenario rerun used the same Next/API/PostgreSQL runtime. Static
  scanning found no Playwright route interception or mock reference in the
  MVP-core test or Playwright configuration.
- Final QA corrections changed acceptance fixtures/tests only. A production
  build was rerun successfully after every correction was merged.
- After browser and screenshot acceptance, only server PID `86752` and the
  exact labeled container above were stopped. Both the listener and container
  were verified absent afterward.

## Validation receipt

| Check | Final result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with pnpm `11.2.2`; `pnpm-lock.yaml` stayed at Git blob `f703f4e8a639424ec59dbc8dd2b403cf19931396` |
| `git diff --check` | Passed before evidence staging; rerun by the integration commit gate |
| `pnpm run typecheck` | Passed |
| Source lint | Passed with `apps/web/.next` physically moved out of the source tree; the track checks also ran without `.next` |
| `pnpm run test:unit` | 89 passed, 7 skipped; 16 files passed, 1 skipped |
| `pnpm run check:experience` | 25 passed, 7 skipped; 6 files passed, 1 skipped |
| `pnpm run check:qa` | 8 passed; 1 file passed |
| `pnpm run db:verify` | 4 passed; 1 disposable-database test file passed |
| `pnpm run build` | Passed; fixture page, three fixture API routes, root route, and Proxy middleware were emitted |
| Real-runtime Playwright `@mvp-core` | 6 passed with one worker and no interception |

The final Playwright run covered:

1. consent, report generation, handover, ownership, reminder, and reload
   persistence;
2. zero shared writes when consent is declined;
3. blocked and one-sided handover behavior;
4. private-message probes and authority tampering failing closed;
5. strict command bodies and probe-only `targetId`; and
6. the selected-role responsive Web App at desktop, tablet, and mobile sizes.

The final Playwright output directory is:

`test-results/playwright-web-int-002-final-a5f47e6`

Earlier owner-track mismatches were retained as local evidence rather than
hidden: the first real-runtime run reached 4/6, the next two corrected runs
reached 5/6, and the final owner-corrected run reached 6/6. An initial runner
attempt also found that the default Playwright output directory conflicted
with active server log handles on Windows; all actual reruns used unique output
directories without changing the product or test contract.

## Screenshot receipt

All screenshots were captured from the real local runtime after resetting the
same PostgreSQL fixture. They are local ignored artifacts, not versioned
release assets.

| View | Local path | SHA-256 | Inspection |
| --- | --- | --- | --- |
| Desktop primary, `1440x900` | `test-results/web-int-002-screenshots-a5f47e6/desktop-primary-1440x900.png` | `75140b1511581e210fa6058e316d9916de619f70826fb8e43f51e599b402b709` | One selected primary workspace; two substantial cards; no device stage, clipping, or overlap |
| Tablet partner, `1024x768` | `test-results/web-int-002-screenshots-a5f47e6/tablet-partner-1024x768.png` | `ef930b8d114cdf130ba35ea5769587be4bd525fb801f6c7951bf512a9fb5a7c6` | One selected partner workspace; substantial responsibility card; no horizontal overflow |
| Mobile subject, `390x844` | `test-results/web-int-002-screenshots-a5f47e6/mobile-subject-390x844.png` | `37d91ae680ffb45b9b32ef2b35f77c9f58c9b9f665c7e3b9e9a94ead5bd96990` | Compact role navigation, current server truth, reset, and all truth labels visible above the selected subject content |
| Mobile subject full page, `390x1728` | `test-results/web-int-002-screenshots-a5f47e6/mobile-subject-390x844-full.png` | `324280573801ce52b4c7cbcc5f9b2f1d3ed6da05a08d69cc1531d01b3c53f8ba` | Substantial consent card and all subject actions visible without clipping or overlap |

The automated screenshot receipt confirmed for every required viewport:

- exactly one selected role surface and one current role link;
- document `scrollWidth` equal to `clientWidth`;
- zero detected phone/device frames;
- all seven fixture and truth-boundary labels present, complete, and not
  ellipsized;
- role cards meeting their accepted minimum heights; and
- the role's primary action reachable after normal scrolling and receiving
  pointer input.

At `390x844`, compact role navigation, current status, and reset were all
inside the initial viewport. The selected subject surface used the accepted
14px safe gutter, within the QA maximum of 16px.

## Limits and truth boundary

- This is a deterministic Local Fixture using fictional people and data. The
  role query is a demo selector, not identity or authentication.
- No live credentials, private account, production identity, model provider,
  deployment, domain, alias, telemetry, or official release was exercised.
- HTTP `200`, a successful build, screenshots, and local Playwright results
  establish only this bounded local MVP acceptance.
- The disposable database and app process were removed after acceptance, so
  this receipt does not claim a continuously available environment.
- Screenshot and Playwright artifact paths are local to this worktree and are
  intentionally not committed as product assets.
