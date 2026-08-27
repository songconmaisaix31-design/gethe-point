# MVP-RESP-001 Responsibility Specification

Status: implementation specification

Frozen base: `25f00004f83185be3d987424b28f627f3854b35d`

## Outcome

Create one responsibility domain and task from an eligible consented shared
signal, persist all five responsibility-stage owners as command data, and
produce a neutral report directly from stored facts.

The user-visible value is traceability: every report count identifies a stored
task field and an authorized shared source. A report never reconstructs
ownership from prose or asks a model to judge a family member.

## Public boundaries

- `ResponsibilitySourcePort` loads the complete consent, draft, signal,
  evidence, member, and space graph. Repository output is untrusted until the
  service validates it.
- `ResponsibilityDraftPort` returns a bounded structured proposal. The MVP
  implementation in `modules/ai-domain` is a deterministic Fixture provider;
  it does not call an LLM.
- `ResponsibilityPersistencePort` receives one atomic create command containing
  the complete `Domain` and `Task`, including `discoveredBy`,
  `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy`.
- `ResponsibilityReportPort` returns an immutable report snapshot. The service
  validates and filters that snapshot before counting persisted fields.

Adapters must make create idempotent by `sourceSignalId` and atomically persist
the domain, task, and source linkage. A rejected source or invalid actor must
never reach a mutation method.

## Eligibility and authorization

A create is eligible only when all of these facts agree:

1. the actor, active space, active source speaker, consent, draft, shared
   signal, and evidence all validate and belong to the same space;
2. the consent is an active `share` decision made by the signal speaker and
   references the source draft;
3. the source draft is `potential_task`, has no missing information, and is not
   a provider fallback requiring human review;
4. the shared signal references the consent, has available evidence, and is
   visible to the actor;
5. the draft, signal provenance, and persisted evidence use exact matching
   evidence IDs and speakers;
6. every non-null responsibility owner is an active member of the same space.

`discussion_only`, `high_risk`, discarded, expired, revoked, hidden,
cross-space, missing-evidence, malformed, and `needs_human_review` inputs fail
closed before persistence.

## Deterministic report

- Count only `current`, non-cancelled tasks inside the requested closed period.
- Require an active, visible domain; a visible eligible source graph; and exact
  available evidence coverage.
- Count only the five persisted owner fields. A `null` owner contributes no
  count; report generation never reads task titles, domain names, excerpts, or
  conclusions to infer ownership.
- Deduplicate repeated task, domain, signal, and evidence records by identifier
  so duplicate adapter rows cannot inflate totals.
- Return five rows in the frozen contract order and sort member counts by
  descending count then member ID for deterministic ties.
- Use checked-in human-authored templates for empty, distributed, concentrated,
  and mixed distributions. Templates contain no score, ranking, blame,
  diagnosis, personality inference, or relationship judgment.

## Acceptance and verification

- The canonical contract Fixture signal creates exactly one canonical Fixture
  domain and task through the public ports.
- The persistence command carries all five owners explicitly.
- Representative invalid actor, space, source, denial, review, and evidence
  states produce zero create or report mutation.
- Reports are stable under input reordering and duplicate snapshot rows.
- `pnpm install --frozen-lockfile --ignore-scripts` and
  `pnpm run check:responsibility` pass, followed by the repository scope gate,
  clean-worktree check, upstream equality, and Worker receipt verification.

## Known integration boundary

`DATA-001` already persists the five task columns but exposes no responsibility
repository. This track therefore defines narrow ports with atomicity and
idempotency requirements. A later integration adapter must bind those ports to
PostgreSQL without weakening the guards above.
