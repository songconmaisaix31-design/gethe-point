# Responsibility Capability Specification

Status: implementation specification for `RESP-REPAIR-002`

Frozen base: `217d9a3b421e8eef628483f349346eea981a435c`

## Outcome

Provide a fresh responsibility capability that turns authorized, current shared
signals into a server-held domain suggestion, supports exact-once human
corrections of the five persisted responsibility fields, and renders neutral
reports without an LLM.

The capability protects two user outcomes. Private or revoked facts cannot
cross the provider boundary, and retrying a correction or confirmation cannot
create a second domain change or audit fact.

## Scope

- `modules/ai-domain` owns bounded provider orchestration, the complete source
  guard, opaque draft receipts, and guarded human confirmation.
- `modules/responsibility` owns attribution correction, correction audit facts,
  report eligibility, visibility checks, and frozen report templates.
- Public contracts, database schema, root dependencies, lockfiles, deployment,
  and CI remain unchanged.
- Persistence adapters are integration-owned. This track defines narrow ports
  that require transaction-level revalidation and exact-once behavior.

## AI domain suggestion

1. Strictly validate the actor and the bounded task, signal, and evidence
   selection.
2. Load the complete context and reject any non-exact set before provider use.
3. Require an active space, an active requesting member with analysis consent,
   current visible tasks and responsibility signals, available evidence, and
   active consented source members in the same space.
4. Require each signal speaker, provenance speaker, and persisted evidence
   speaker to be identical. Provenance and evidence sets must also match
   exactly.
5. Serialize only numbered redacted excerpts and provider-safe source types.
   Raw evidence, raw references, and persistent space, member, task, signal,
   evidence, or domain identifiers are forbidden.
6. Retry one timeout, unavailable result, or invalid structured output. Two
   failed attempts return `needs_human_review` and write no draft or domain.
7. Reload and revalidate the complete context after provider return. Any actor,
   consent, membership, visibility, evidence, review-state, selection, or
   version drift discards the output.
8. Persist the validated suggestion only on the server. Return an opaque receipt
   plus display-only copy; confirmation accepts no suggestion fields.
9. Confirmation loads the receipt, verifies its stored content digest, requires
   the same currently authorized human, revalidates the complete guard, and
   calls one guarded atomic persistence port. Fabricated, tampered, consumed, or
   stale receipts cannot write a domain.

## Attribution correction

1. Strictly validate the actor and public `CorrectTaskAttribution` request.
2. Compute the canonical request hash and resolve idempotency before loading
   mutable state or deciding that a correction is a no-op.
3. An exact replay returns the original corrected task, audit ID, and audit time
   without reading current mutable state or generating a new identity or time.
4. A reused key with a different request hash fails with
   `idempotency_conflict`.
5. On a replay miss, validate the active actor, space, task, domain, visibility,
   evidence, attributed members, and expected version. A fresh stale or no-op
   request writes nothing.
6. Generate audit identity and time only after a replay miss and successful
   validation. The audit contains only structured five-stage before/after IDs;
   the free-text reason exists only in the request hash.
7. The persistence adapter atomically rechecks the full version guard, claims
   idempotency, updates the task, writes the audit, and stores the replay result.

## Deterministic report

- Every cell is counted directly from `discoveredBy`, `deadlineKeptBy`,
  `scheduledBy`, `executedBy`, and `followedUpBy` on eligible persisted tasks.
- Eligibility requires a current visible task, current evidence, and at least
  one current visible `potential_task` responsibility signal with exact
  provenance.
- `discussion_only`, `high_risk`, `evidence_missing`, `needs_review`, cancelled,
  hidden, and out-of-period facts are excluded.
- Hidden coordination is the four stages other than `executedBy`; execution is
  counted separately.
- Empty, balanced, concentrated-coordination, and other uneven states use frozen
  Chinese templates. No template contains a score, rank, blame, diagnosis, or
  relationship judgment.
- When all four hidden stages belong to one member and execution is performed by
  another, the exact PRD template is:

  `本周家庭协调工作集中在一位成员身上。虽然执行任务有所分担，但发现、安排与跟进仍未形成完整责任所有权。`

## Verification

The focused tests must prove all pre-provider rejection paths, provider payload
redaction, both validation attempts, post-provider drift, receipt fabrication
and tampering, correction replay/conflict/staleness, content-free audits, report
traceability, exclusions, and all four deterministic narratives.

The required gate is `pnpm run check:responsibility` followed by the repository
scope gate, clean worktree verification, push verification, and
`worker_finish.py --verify-only`.
