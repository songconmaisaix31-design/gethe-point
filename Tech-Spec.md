# We Remember MVP Contract Technical Specification

Status: Frozen by `CONTRACT-001`

Source decision: `.agents/decisions/0001-mvp-engineering-freeze.md`

Foundation base: `bede795a127ef5baa48fc4bd01752c2f3c408c65`

## 1. Outcome

This specification freezes the shared contract boundary for the fixture-first We Remember MVP. It gives every later track one typed source for actors, entities, commands, queries, events, errors, authorization, deletion, state transitions, AI drafting, deterministic time, idempotency, and fixed UI facts.

The product outcome is a safe responsibility transfer, not a generic chat or task application. A private statement cannot become shared family data without explicit per-item consent; incomplete handover information cannot move ownership; an inactive care rule cannot notify or escalate; and deleting data has deterministic, reviewable consequences.

## 2. Scope and non-goals

`packages/contracts` contains data-only schemas, immutable policy tables, port interfaces, examples, and public exports. It does not contain repositories, feature handlers, routes, persistence adapters, network calls, schedulers, rendered UI, or provider-specific AI code.

This freeze deliberately excludes:

- production authentication and real household onboarding;
- long-lived category consent grants;
- database implementation and transaction orchestration;
- provider credentials or provider-specific SDKs;
- native notifications, payments, multi-space tenancy, and V2 caregiver flows;
- medical diagnosis, dosage advice, relationship scoring, or blame-oriented reporting.

## 3. Completion criteria

The contract is complete when:

1. every ADR 0001 command and query has an explicit actor, strict request schema, strict result schema, and bounded error-code type;
2. the five task responsibility fields are required keys in `TaskSchema` and `ResponsibilityAttributionSchema`, while their values may be `null` when genuinely unknown;
3. all handover and care state pairs resolve to an explicit allowed or denied transition rule;
4. private evidence, consent, visibility, export, evidence deletion, and space deletion policies agree across schemas, matrices, examples, and documentation;
5. external and AI inputs begin as `unknown`, pass a strict Zod boundary, and fail closed on unknown keys, invalid variants, or invalid state;
6. optional AI can attempt a structured draft at most twice and then returns `needs_human_review` with `consequentialMutationAllowed: false`;
7. the UI contract freezes tokens, Chinese vocabulary, viewports, accessibility constraints, truth labels, screen states, and screenshot scenario names;
8. contract tests validate every exported example, JSON Schema generation, public package exports, state-table completeness, and representative denial paths.

## 4. Single source of truth

Runtime and compile-time contracts originate in `packages/contracts/src`. Zod schemas are the executable trust-boundary source; TypeScript types are inferred from those schemas. JSON Schema documents are generated in memory from the same Zod objects through Zod 4 `toJSONSchema`, so consumers do not maintain a second hand-written shape.

The package exports only `packages/contracts/src/index.ts` through the package root. Subpath exports are intentionally absent. This matters because later tracks must not bind to private module layout or create competing contract definitions.

## 5. Trust boundaries

### 5.1 Actor boundary

Every operation receives its actor separately from its request. A member actor carries a space, member, P0 role, and authentication evidence level. `fixture_demo` identifies a fictional role switch and is never treated as production authentication. System actors are limited to the named deterministic services required for handover acceptance, care scheduling, handover expiry, and space deletion.

Authorization uses relationship facts, not display roles alone. Examples include evidence speaker, conversation participant, current domain owner, handover source/recipient, care subject, escalation recipient, and space creator. Unknown relationships deny access without revealing whether a target exists.

### 5.2 Data layers

| Layer | Contract content | Visibility | Retention rule |
| --- | --- | --- | --- |
| L0 private | private messages and raw evidence | speaker only | deletable by the speaker; cascades invalidation |
| L1 shared | minimum redacted excerpt, structured conclusion, provenance IDs, responsibility, handover, and care records | enforced `space`, `care_related`, or explicit `members` scope | retained until explicit deletion or space deletion |
| L2 AI input | minimum redacted input for one drafting purpose | provider boundary only | provider contract forbids application persistence and content logging |

Raw `agent_dm` content never appears in a shared signal, domain event, audit change summary, provider telemetry, or ordinary error.

### 5.3 Consequential boundary

AI may draft a signal, responsibility domain suggestion, handover packet, or care-rule proposal. AI never authorizes sharing, confirms attribution, transfers ownership, schedules or escalates care, deletes data, exports data, or writes audit decisions. Those actions require deterministic code operating on validated contracts.

## 6. Core invariants

### 6.1 Consent and visibility

- Consent is one decision for one candidate signal by its speaker.
- Only an active `share` decision can authorize `ConfirmSignal`.
- `discard`, expired, revoked, missing, wrong-speaker, and ambiguous decisions deny the shared write.
- `self` visibility is private and is not accepted by a shared-signal schema.
- `members` visibility names the complete allowed member set.
- `care_related` visibility requires the subject and the authorized care participant set.
- A shared record carries only a redacted excerpt and provenance references, never raw evidence content.

### 6.2 Responsibility

`Task.discoveredBy`, `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy` are required stored keys. A `null` value means the responsibility is genuinely unknown; absence is invalid. Reports read these exact values, exclude discussion-only or invalidated facts, and use neutral deterministic vocabulary without ranking, scores, blame, diagnosis, or relationship judgment.

### 6.3 Handover

The persisted states are `draft`, `proposed`, `blocked`, `awaiting_confirmations`, `accepted`, `declined`, and `expired`. Missing operational information forces `blocked`. Both source and recipient confirmations plus complete information are required before acceptance. Acceptance is terminal and must atomically migrate `Domain.ownerId`, future task ownership defaults, active reminders, and one audit fact. Any failure preserves the prior owner and reminders.

ADR 0001 lists acceptance commands but omits triggers for its approved `declined` and `expired` terminal states. `CONTRACT-001` therefore adds only `DeclineHandover` and `ExpireHandover`; this closes the approved state machine without adding a new product capability.

### 6.4 Care

A care rule remains `draft` until a human confirms its schedule, acknowledgement window, ordered escalation chain, primary caregiver, and terminal behavior. The event machine uses an injectable `Clock`, persisted idempotency keys, and deterministic transitions. Duplicate ticks, acknowledgements, or handling requests replay the first result rather than producing another event or notification. Exhausted or impossible escalation ends visibly as `unresolved`; it never disappears silently.

### 6.5 Deletion and export

Evidence deletion removes the raw evidence, marks dependent signals `evidence_missing`, marks dependent tasks and domains `needs_review`, excludes them from reports, and appends an in-space audit record. It does not reverse an accepted handover. Revoking analysis consent blocks future analysis but does not falsify prior authorized events. Personal export returns only data the requesting actor may currently read. Space deletion requires the space creator, an exact confirmation, and an idempotency key; it cascades all in-space product and audit content and returns only an ephemeral non-content receipt.

## 7. AI and provider contract

`LLMProvider.complete` is a replaceable port over built-in `fetch` adapters. Its response is `unknown` until narrowed by the requested Zod schema. Provider telemetry contains only request IDs, purpose, prompt version, attempt count, latency, and token counts; it contains no input or output content.

The frozen attempt policy is:

| Fact | Value |
| --- | --- |
| maximum attempts | `2` |
| maximum retries | `1` |
| retryable boundary failures | invalid structured output, timeout, provider unavailable |
| fallback | `needs_human_review` |
| consequential mutation in fallback | `false` |

A validated draft is still non-consequential and requires the relevant human/deterministic command before shared or operational state changes.

## 8. Deterministic time and idempotency

Feature code receives a `Clock`; contract tests and fixture flows never sleep or read wall-clock time directly. JSON boundaries use offset-aware ISO-8601 instants.

Consequential and retryable commands carry an idempotency key. The persistence port scopes a key by space, command, and actor, stores a canonical request hash, and returns one of `claimed`, `replay`, or `conflict`. Reusing a key with a different request hash is `idempotency_conflict`; it never executes the new request.

## 9. UI fact source

The UI is Chinese and fixture-first. The exact visible truth labels are `演示数据 Fixture` and `用于演示流程，不是账号实况`. Role switching must also display that it is not production authentication.

Required visual checks are 390x844 and 1440x900. All roles cover loading, empty, blocked, denied, error, retry, and success. The older-subject surface uses at least 20px body text, 26px headings, 60x60px primary targets, 7:1 body contrast, visible focus, non-color-only status, reduced motion, no nested navigation, at most three primary elements per screen, and one-step acknowledgement.

The contract freezes screenshot scenario names and assertions, not rendered images. `EXPR-001` owns the first rendered fixed-fixture baselines; `CONTRACT-001` intentionally contains no UI implementation.

## 10. Package layout

```text
packages/contracts/
  package.json
  README.md
  src/
    actors.ts
    entities.ts
    errors.ts
    events.ts
    examples.ts
    index.ts
    json-schemas.ts
    operations.ts
    policies.ts
    ports.ts
    primitives.ts
    state-machines.ts
    ui.ts
  tests/
    contracts.test.ts
```

Documentation under `docs/architecture` explains policy and state tables for human review. It does not redefine schema fields.

## 11. Verification

The required gate is:

```bash
pnpm run check:contracts
```

It runs repository-wide strict TypeScript, focused ESLint for `packages/contracts`, and focused Vitest contract tests. Before delivery, the worker also runs the Orca scope gate, `git diff --check`, clean-worktree verification, push verification, and `worker_finish.py --verify-only`.

## 12. Known limits

- Contract validation proves shapes and deterministic policy facts, not database atomicity or route authorization. Later data and feature tracks must prove those behaviors.
- Fixture actors are fictional and do not prove production identity.
- Screenshot names and assertions are frozen here; actual screenshots require the UI track's rendered implementation.
- Human usability of the one-step older-subject acknowledgement remains a later acceptance receipt, even when automated accessibility checks pass.
