# CONV-001 Conversation and AI Boundary Specification

## Outcome

Provide private `agent_dm` messaging and consented signal creation without allowing raw evidence, model output, or ambiguous state to authorize a shared write.

## Acceptance criteria

1. `CreatePrivateMessage` stores a self-visible message only. It creates no draft, consent, shared signal, domain, or task.
2. `CreateSignalDraft` reads only the speaker's available evidence, sends a bounded redacted input to an optional provider, validates unknown output, and persists only a valid non-consequential draft.
3. Provider invalid JSON, timeout, unavailable responses, thrown failures, and two invalid outputs return `needs_human_review` after exactly two attempts and persist no draft or shared record.
4. `DecideConsent` records one immutable per-draft decision by the draft speaker. No sharing option is inferred or preselected.
5. `ConfirmSignal` is the only shared-write handler. It requires an active, unexpired `share` decision for the same draft and speaker, a current draft version, valid shared visibility, and a matching idempotency claim.
6. A confirmed signal copies only the consented draft excerpt, conclusion, visibility, consent ID, and content-free provenance. It never copies message content, raw evidence content, or `rawRef`.
7. Discussion-only and high-risk drafts cannot write tasks. High-risk input receives non-diagnostic speaker guidance and is never sent to the optional provider.
8. Logs contain operation names, request/space/actor/record IDs, attempts, latency, and typed outcomes only. Errors contain a request ID and stable content-free message.

## Architecture

- `modules/boundary` owns redaction, high-risk routing, safe errors, and content-free telemetry.
- `modules/ai-witness` owns the strict signal-candidate schema, deterministic fixture provider, OpenAI-compatible `fetch` adapter, timeout, and one-retry policy.
- `modules/conversation` owns the four deterministic handlers and a persistence port. The in-memory implementation is a reference/fixture adapter; integration can implement the same transactional port over DATA-001 without changing handler policy.
- All contract types and schemas are imported through `packages/contracts/src/index`, the repository's public contract export surface. No competing API contract is introduced.

## Security and failure rules

- Actor and request values enter as `unknown` and are parsed with the frozen public schemas before reads or writes.
- Missing records and records outside the actor's space use non-enumerating safe errors.
- Evidence must be available, self-visible, authored by the actor, and linked to the requested private message.
- Provider input is deterministically redacted and bounded. Provider output remains `unknown` until strict schema validation succeeds.
- Network providers require HTTPS, except loopback HTTP for local tests and development.
- High-risk classification is a routing safeguard, not a diagnosis. It emits guidance only and grants no authorization.
- Consequential confirmation is atomic and idempotent in the persistence port. A failed guard performs no write.

## Verification

- Focused Vitest coverage for success, authorization denial, immutable consent, visibility, idempotency, redaction, high-risk/discussion-only routing, invalid JSON, timeout, provider failure, retry recovery, and content-free logs/errors.
- `pnpm run check:conversation`
- `python scripts/gate.py check --run-checks`
- `git diff --check`
