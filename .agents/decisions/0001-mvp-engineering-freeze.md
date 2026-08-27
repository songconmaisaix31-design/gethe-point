# ADR 0001: We Remember MVP Product and Engineering Freeze

- Status: Approved
- Date: 2026-08-27
- Product source: `产品需求文档_都记得_PRD.md` at Git blob `761a2431b674824d40fea06b22058c7afd65260a`
- Fleet source: `orca-directory-fleet-kit.zip` at SHA-256 `FAC74080BF7517527743BE7ED3CB0EA9CB8A71039EF83B0E952BF8000B42678E`
- Delivery window: 96 hours

## Decision

Build a responsive Chinese Web/PWA demo that proves one complete, privacy-safe responsibility-transfer loop for a fictional three-person family. The product is not a generic chat application and not a flat task list. The demo must make invisible responsibility visible, transfer a complete responsibility domain safely, and show that the original owner is no longer carrying its reminders and follow-up.

The application is fixture-first. Optional live AI is a replaceable drafting adapter and is not required for acceptance. Consequential behavior remains deterministic.

## P0 product boundary

P0 contains:

1. Three role-specific experiences: primary carer, partner, and older subject.
2. Private agent conversations with self-only raw evidence.
3. Per-item explicit consent before a private message can produce shared family data.
4. A family-space activity view containing only consented structured conclusions.
5. Five persisted responsibility fields on every task: `discoveredBy`, `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy`.
6. A deterministic, neutral responsibility report grouped by responsibility domain.
7. One blocked-by-default, two-party responsibility-domain handover.
8. Atomic owner, reminder, and audit migration when the handover is accepted.
9. One human-confirmed deterministic care rule with acknowledgement, timeout, escalation, closure, and unresolved states.
10. Evidence provenance, evidence deletion, future-analysis consent revocation, personal export, and family-space deletion.
11. Fictional demo fixtures and explicit `演示数据 Fixture` labeling.

The rephrase helper is P1. Long-lived category consent grants, native applications, native push notifications, real household onboarding, production identity, payments, and multi-family tenancy are out of scope.

## Consent and visibility

- Consent is per candidate signal. There is no persistent category-level auto-authorization in the MVP.
- The speaker chooses whether a candidate signal is discarded or shared and selects its supported visibility scope.
- `agent_dm` raw content and raw evidence remain self-visible. Other members cannot retrieve them through a shared conclusion.
- A shared signal may contain only the minimum consented redacted excerpt, structured conclusion, provenance marker, actor, purpose, and consent decision.
- Missing, expired, withdrawn, or ambiguous consent denies the shared write.
- High-risk content never bypasses consent. It is withheld from ordinary task creation and the speaker receives non-diagnostic safety guidance.

## Responsibility and reporting

- `Domain.ownerId` is the active domain owner.
- The five task responsibility fields are stored values, not inferred presentation fields.
- Reports use deterministic human-authored templates and exact stored values. They do not use an LLM.
- Reports describe workload distribution without scores, rankings, blame, diagnoses, or relationship judgments.
- Discussion-only messages remain non-tasks and must be represented in acceptance fixtures.

## Handover state machine

Persisted states are:

```text
draft
  -> proposed
  -> blocked | awaiting_confirmations
blocked
  -> awaiting_confirmations | declined | expired
awaiting_confirmations
  -> accepted | declined | expired
accepted | declined | expired
  -> terminal
```

- `blocked` means required operational information is missing. It is not a soft warning.
- `awaiting_confirmations` requires independent confirmation from both the current and proposed owner.
- `accepted` is terminal for that handover record.
- Acceptance atomically updates `Domain.ownerId`, future task ownership defaults, active reminders, and the audit trail.
- Failure at any point leaves the prior owner and reminders unchanged.

## Care state machine

- A care rule is inactive until a human confirms its trigger, acknowledgement window, escalation chain, and terminal behavior.
- The execution path uses persisted events, an injectable clock, idempotency keys, and deterministic transitions.
- No LLM participates in acknowledgement, timeout, escalation, closure, or unresolved transitions.
- Repeated scheduler ticks or webhook retries must not create duplicate care events or notifications.

## Evidence deletion and space deletion

- Deleting raw evidence marks related signals `evidence_missing`.
- Dependent tasks and responsibility domains become `needs_review` and are excluded from future reports until reviewed.
- Evidence deletion does not silently reverse an already accepted handover.
- The invalidation is audited while the family space exists.
- Deleting a family space cascades all product content, raw evidence, derived conclusions, handovers, reminders, care events, and in-space audit records.
- Audit immutability applies during the space lifetime. Space deletion returns an ephemeral receipt but retains no product content in the MVP store.

## Architecture

Use one locked `pnpm` workspace with a single root dependency manifest. Feature tracks do not add dependencies or mutate the lockfile. This prevents parallel lockfile conflicts and makes every worker reproducible from the same accepted base.

The selected stack is:

- Next.js App Router, React, and strict TypeScript for the responsive Web/PWA.
- PostgreSQL and Drizzle for persisted constraints and explicit migrations.
- Zod plus generated or hand-maintained JSON Schema at external and AI boundaries.
- Vitest for unit and contract tests.
- Playwright for browser, accessibility, and screenshot checks.
- CSS modules or native CSS variables for the UI; no styling framework is required.
- Built-in `fetch` behind an `LLMProvider` interface for optional OpenAI-compatible providers.
- An injectable `Clock` and a persisted idempotent scheduler command for care behavior.

Exact dependency versions are frozen by `FOUND-001` in `pnpm-lock.yaml`; later tracks may only use those dependencies. A new dependency requires a separate foundation task and review.

## Runtime truth boundary

- Fixture mode is the default and must remain fully functional without network credentials.
- Demo role switching is not production authentication. The UI and release evidence must say so.
- Application services still receive an explicit actor and enforce authorization; the fixture adapter supplies only fictional identities.
- Optional live AI reads credentials only from approved runtime environment variables. Secret values are never read by the coordinator, logged, committed, or copied into fixtures.
- Local verification, fixture evidence, public deployment, and official acceptance are distinct evidence levels.

## Command and query contracts

The architecture task must define typed contracts for these commands:

- `CreatePrivateMessage`
- `CreateSignalDraft`
- `DecideConsent`
- `ConfirmSignal`
- `CorrectTaskAttribution`
- `ProposeHandover`
- `SupplyHandoverInfo`
- `ConfirmHandoverFrom`
- `ConfirmHandoverTo`
- `AcceptHandover`
- `ConfirmCareRule`
- `TickCareScheduler`
- `AcknowledgeCareEvent`
- `HandleCareEvent`
- `DeleteEvidence`
- `RevokeAnalysisConsent`
- `ExportMyData`
- `DeleteSpace`

It must also define typed contracts for these queries:

- `GetRoleHome`
- `GetPrivateConversation`
- `GetVisibleSharedSignals`
- `GetResponsibilityReport`
- `GetDomainWithEvidence`
- `GetPendingHandovers`
- `GetCareInbox`
- `GetAuditTrail`

## UI fact source

`CONTRACT-001` must freeze the UI tokens, required component states, Chinese copy vocabulary, and fixture screenshots before `EXPR-001` starts. The static experience uses fixed contract fixtures first; integration with real module handlers happens only in `INT-001`.

Required viewport checks are 390x844 and 1440x900. The subject experience uses at least 20px body text, 26px headings, 60x60px primary targets, 7:1 body contrast, reduced-motion support, and a one-step acknowledgement path. Every role must expose loading, empty, blocked, error, retry, and success states without truncation, overlap, or obscured primary actions.

## Consequences

- The first three implementation waves are intentionally serial because dependencies, contracts, and database constraints are shared facts.
- Seven product tracks can then run in parallel without editing the same physical paths.
- AI outages cannot block the fixture demo or mutate consequential state.
- The MVP can truthfully demonstrate its privacy and responsibility model without claiming production identity or live household data.
