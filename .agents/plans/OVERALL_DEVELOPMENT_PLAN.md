# We Remember MVP Overall Development Plan

- Status: Approved for supervised execution
- Date: 2026-08-27
- Machine plan: [`current.json`](current.json)
- Product and engineering freeze: [`../decisions/0001-mvp-engineering-freeze.md`](../decisions/0001-mvp-engineering-freeze.md)
- Execution contract: [`../decisions/0002-parallel-execution-contract.md`](../decisions/0002-parallel-execution-contract.md)
- Shared control base: `origin/songconmaisaix31-design/we-remember-requested-fleet-v2`

## Outcome

Deliver a reproducible Chinese Web/PWA fixture demo that proves this user outcome:

> A family can see who carries each stage of a responsibility domain, transfer the complete domain only after information and both confirmations are present, move its reminders atomically, and show that the prior owner no longer carries the follow-up burden.

The implementation must remain useful without network credentials. Optional live AI drafts interpretations; deterministic code owns consent, authorization, persisted state, reminders, care escalation, deletion, export, and audit.

## Definition of done

The MVP is complete only when all of the following are true:

1. A clean checkout installs from the committed lockfile and passes typecheck, lint, unit, contract, database, browser E2E, accessibility, and visual checks.
2. A disposable PostgreSQL migration proves all five responsibility fields exist and consequential constraints are enforced.
3. The seven-step fixture demo completes with explicit consent, neutral reporting, blocked handover, two confirmations, atomic owner/reminder migration, deterministic care escalation, and visible workload release.
4. Representative denial and failure states remain blocked and observable.
5. Raw private evidence is never exposed to another role or logged.
6. The release manifest links each accepted task, Dispatch, remote SHA, merge commit, check receipt, and evidence level.
7. Fixture, local runtime, public deployment, and official acceptance claims remain visibly separate.

## Dependency graph

```text
FOUND-001
  -> CONTRACT-001
    -> DATA-001
      -> EXPR-001 ─┐
      -> CONV-001 ─┤
      -> RESP-001 ─┤
      -> HAND-001 ─┤
      -> CARE-001 ─┤
      -> PRIV-001 ─┤
      -> QA-001 ───┴-> INT-001
                         -> EXPR-002 ─┐
                         -> CONV-002 ─┤
                         -> RESP-002 ─┤
                         -> HAND-002 ─┤
                         -> CARE-002 ─┤
                         -> PRIV-002 ─┤
                         -> QA-002 ───┴-> INT-002
```

The first three tasks are serial because they establish shared build inputs, machine contracts, and persisted invariants. Parallelizing them would create incompatible package, schema, and migration baselines. Product work becomes parallel only after `DATA-001` is accepted.

## Waves and ownership

| Wave | Tasks | Base | Product value |
| --- | --- | --- | --- |
| Workspace bootstrap | `FOUND-001` | Shared control branch | One reproducible toolchain and lockfile for every worker |
| Contract freeze | `CONTRACT-001` | Accepted `FOUND-001` | One API, schema, security, state-machine, and UI fact source |
| Database foundation | `DATA-001` | Accepted `CONTRACT-001` | Persisted privacy and responsibility invariants before features |
| Parallel core | `EXPR-001`, `CONV-001`, `RESP-001`, `HAND-001`, `CARE-001`, `PRIV-001`, `QA-001` | Accepted `DATA-001` | Seven isolated product capabilities built concurrently |
| Alpha integration | `INT-001` | Accepted `DATA-001` plus exact core SHAs | First complete fixture flow with real module adapters |
| Parallel hardening | `EXPR-002`, `CONV-002`, `RESP-002`, `HAND-002`, `CARE-002`, `PRIV-002`, `QA-002` | Accepted `INT-001` | Adversarial, responsive, accessibility, and failure coverage |
| Release integration | `INT-002` | Accepted `INT-001` plus exact hardening SHAs | Reproducible release candidate and evidence manifest |

## Physical topology

```text
apps/web/                     Chinese role-specific Web/PWA
modules/conversation/         private messages and consented signal commands
modules/ai-witness/           replaceable schema-validated witness drafts
modules/boundary/             high-risk routing and minimum-context redaction
modules/responsibility/       five-stage ownership and deterministic reports
modules/ai-domain/            replaceable domain suggestions
modules/handover/             blocked two-party transfer and atomic migration
modules/ai-handover/          replaceable handover information drafts
modules/care/                 human-confirmed deterministic scheduler
modules/privacy/              access, revocation, export, and deletion policies
packages/contracts/           single typed contract and schema source
packages/db/                  migrations, repositories, and disposable DB proof
packages/config/              root TypeScript, test, and build facts
packages/testkit/             fictional fixture builders and contract harness
fixtures/                     golden fictional family data
tests/e2e/                    browser acceptance and failure paths
docs/demo/                    demo script and truth-boundary copy
docs/release/                 release evidence and manifests
```

## Golden fixture

The fixture contains only fictional data:

- Members: a primary carer, a partner, and an older subject.
- Domains: medication refill, school administration, and household maintenance.
- At least eight valid consented signals distributed across the three domains.
- At least two discussion-only private messages that do not become tasks.
- One signal rejected at the consent gate.
- One handover blocked by missing operational information, then completed after both confirmations.
- One care acknowledgement before timeout and one deterministic escalation after timeout.
- One deleted evidence item that invalidates a derived signal and removes it from the report.

Every fixture screen displays `演示数据 Fixture` and `用于演示流程，不是账号实况`.

## Cross-track contracts

All modules consume `packages/contracts` through its public exports. Deep imports are prohibited. Contracts cover actors, visibility, commands, queries, domain events, idempotency keys, errors, audit metadata, `LLMProvider`, and `Clock`.

Consequential commands use this result model:

```text
success | blocked | denied | needs_human_review | failed
```

Unknown, missing, invalid, or timed-out inputs never become `success` by default.

## Verification matrix

| Boundary | Required representative checks |
| --- | --- |
| Workspace | Frozen install, strict typecheck, lint, no duplicate dependency source |
| Contracts | JSON/schema parsing, success and failure examples, exhaustive state transitions |
| Database | Fresh migration, system-catalog proof, constraints, rollback-safe failure, repository tests |
| Conversation | Self-only raw evidence, per-item consent, redaction, invalid AI output, timeout, one retry, human fallback |
| Responsibility | Five persisted fields, corrections, neutral deterministic report, discussion-only exclusion |
| Handover | Missing information, one-sided confirmation, decline, expiry, concurrent accept, atomic reminders |
| Care | Human activation, injectable time, idempotent ticks, acknowledgement, escalation, closure, unresolved |
| Privacy | Actor matrix, evidence deletion invalidation, consent revocation, export scoping, space cascade |
| Experience | 390x844 and 1440x900, loading/empty/blocked/error/retry/success, overflow, overlap, contrast, focus, reduced motion |
| Integration | Seven-step fixture flow, exact-SHA merges, build, browser E2E, release evidence labels |

## 96-hour control points

| Time | Required result | Stop or cut rule |
| --- | --- | --- |
| H0-H4 | `FOUND-001` accepted | No feature package may add a dependency later |
| H4-H12 | `CONTRACT-001` accepted | No database or feature code against placeholder contracts |
| H12-H20 | `DATA-001` accepted on disposable PostgreSQL | No UI-only simulation of persisted invariants |
| H20-H52 | Seven core tracks accepted in parallel | Return cross-track defects to their owner; do not patch sideways |
| H52-H66 | `INT-001` accepted | Stop if exact dependency SHAs do not merge cleanly |
| H66-H86 | Seven hardening tracks accepted in parallel | No new feature scope |
| H86-H96 | `INT-002`, release evidence, and rehearsal | Freeze candidate; only severity-owned fixes |

## Scope-cut order

Cut in this order if schedule pressure appears:

1. Rephrase helper and all P1 behavior.
2. Optional live AI; retain deterministic fixture providers.
3. Native/PWA install polish and nonessential animation.
4. Deployment automation; retain reproducible local/browser evidence.

Do not silently cut consent, authorization, all five responsibility fields, neutral reporting, blocked two-party handover, atomic owner/reminder migration, deterministic care, evidence invalidation, deletion/export, or role-specific home experiences.

## Key risks

| Risk | Control |
| --- | --- |
| Parallel lockfile conflicts or dirty generated artifacts | One root manifest, lockfile, and reproducible `.gitignore` owned only by `foundation` |
| Private content leakage | Self-only raw evidence, minimum redacted shared data, actor authorization tests, no content logging |
| AI creates consequential state | Validated draft-only provider with one retry and human fallback |
| Handover partially applies | One database transaction for owner, reminders, and audit |
| Scheduler duplicates escalation | Persisted idempotency keys and injectable-clock tests |
| Demo role switch is mistaken for auth | Fixture labels and explicit non-production identity boundary |
| Integration hides module defects | Clean exact-SHA merges; failures return to the owning track |
| A screenshot is treated as release proof | Evidence-level labels and a linked release manifest |
