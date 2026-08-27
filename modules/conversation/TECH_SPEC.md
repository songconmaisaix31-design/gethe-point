# Conversation Safety Capability

Status: implementation specification for `CONV-REPAIR-002`

## Outcome

Provide private `agent_dm` messaging and explicit per-signal sharing without
allowing private content, stale authority, or provider output to create shared
family state. AI is limited to a validated, non-consequential draft. Every
authorization and consequential transition remains deterministic.

## Scope

- `modules/conversation` owns the application service, persistence port, and
  fixture-grade in-memory implementation.
- `modules/ai-witness` owns the bounded two-attempt provider boundary and the
  human-authored rendering template.
- `modules/boundary` owns deterministic high-risk classification and recursive
  private-disclosure checks.
- The frozen schemas in `packages/contracts` remain the public data contract.
- This track does not create ordinary tasks, report facts, provider adapters,
  credentials, routes, or database migrations.

Creating a private message atomically creates only its self-visible raw evidence
record. It never creates a consent decision, shared signal, task, or report fact.

## Trust-boundary sequence

### CreateSignalDraft

1. Strictly parse the separately supplied actor and request.
2. Load and authorize the active space, active actor, private `agent_dm`, source
   message, all evidence, evidence state and ownership, source linkage, and the
   same speaker's analysis consent.
3. Run deterministic high-risk classification over every authorized raw input.
   A match bypasses the provider and creates only a private safety draft.
4. Call the provider with the frozen bounded request fields and a bounded
   authorized input. Recursively reject disclosure in the unknown provider
   value, validate the strict bounded field schema, render through fixed
   templates, and disclosure-check the rendered value again.
5. In a transaction, reload the full source state, reject any state or version
   drift, disclosure-check the final draft, and only then persist the private
   draft.

### ConfirmSignal

1. Strictly parse actor and request before opening persistence state.
2. Enter the repository transaction before calling `Clock.now()`.
3. Lock and load the active space/actor, draft, consent, source message, every
   evidence record, and every member referenced by visibility.
4. Validate same-speaker authority, draft version, active/unrevoked/unexpired
   per-signal consent, evidence availability, and supported visibility.
5. Build the minimum shared signal and recursively disclosure-check it against
   current raw private inputs.
6. Reload the locked state and authoritative time immediately before insertion,
   reject expiry, state, visibility, or version drift, then persist exactly one
   signal.

The persistence port documents the lock contract so a database adapter can use
row locks. The in-memory implementation serializes transactions and commits a
working copy atomically.

## Disclosure comparison

Disclosure comparison applies compatibility normalization, Unicode Default
Full Case Folding equivalence, canonical normalization, mark/whitespace/
punctuation/symbol removal, symmetric containment, and one-code-point edit
comparison. It scans every string recursively, including unknown nested
provider fields and final rendered objects. Traversal and input sizes are
bounded; exceeding a bound fails closed.

## Failure behavior

- Invalid or unauthorized input returns a static content-free error and invokes
  the provider zero times.
- High-risk content returns a private deterministic draft; it creates no task
  and no automatic shared signal.
- Provider timeout, unavailability, invalid shape, or disclosure retries once.
  A second failure returns `needs_human_review` and persists no draft or shared
  signal.
- Missing, expired, revoked, wrong-speaker, stale, cross-space, or visibility-
  drifted confirmation writes nothing.
- Telemetry contains only operation, request ID, outcome, attempt/count data,
  and entity IDs. Raw content and caught exception messages are never logged.

## Acceptance and verification

- Prove provider call count remains zero for every pre-provider denial and each
  frozen high-risk category.
- Prove recursive and rendered disclosure rejection for case-folding,
  canonical/fullwidth variants, whitespace, punctuation, symbols,
  containment, and one-code-point edits.
- Prove private message/evidence reads are self-only and private message writes
  have no shared side effect.
- Prove post-provider drift and immediate pre-persist drift write nothing.
- Prove transaction/clock/lock/reload/insert ordering and queued expiry.
- Run `pnpm run check:conversation`, the forbidden-ancestor gate, and the
  repository scope gate from a clean final `HEAD`.
