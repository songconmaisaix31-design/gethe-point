# RESP-001 Responsibility Specification

## Outcome

The module turns persisted responsibility facts into three deterministic operations:

1. correct all five task-attribution fields through an actor-authorized, optimistic, idempotent repository write with content-safe audit metadata;
2. confirm a validated domain draft through an explicit member action and atomically group the selected tasks;
3. build a five-row responsibility report from persisted task fields and actor-visible confirmed responsibility signals.

AI and fixtures may propose a domain. They cannot mutate tasks, domains, audit history, or reports.

## Acceptance rules

- The only counted stages are `discoveredBy`, `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy` read directly from persisted `Task` records.
- A counted task needs a persisted `potential_task` draft, a confirmed shared signal with purpose `responsibility`, actor-readable visibility, and available evidence covering every task evidence reference.
- `discussion_only`, `high_risk`, `evidence_missing`, `needs_review`, unconfirmed, cross-space, and actor-invisible facts never contribute stage counts.
- Corrections require an authenticated active member in the same space, readable task visibility, current evidence, an exact expected version, active attribution targets, and at least one changed field.
- Correction repositories receive the updated task and its audit entry in one commit command. Implementations must persist or replay that command atomically by actor and idempotency key.
- Domain confirmation revalidates the draft against current actor-visible task/evidence scope. Missing information blocks confirmation; selected tasks and evidence must be subsets of the validated draft.
- Reports use fixed human-authored copy. They expose counts and exclusions, never scores, rankings, diagnoses, relationship judgments, or blame.

## Persistence boundary

This track does not own database repositories. It exports narrow repository ports carrying parsed contract records, expected versions, idempotency metadata, actor identity, and audit metadata. A database adapter must preserve atomicity and reject stale versions; integration must not reinterpret authorization or report eligibility.

## Verification

- focused tests cover uneven attribution, discussion-only, missing evidence, review state, visibility, cross-space actors, stale versions, invalid AI output, incomplete draft confirmation, and audit changes;
- `pnpm run check:responsibility` is the required track check;
- `scripts/gate.py` verifies the exact write scope.
