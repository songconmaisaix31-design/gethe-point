# RESP-REPAIR-001 Responsibility Capability Specification

Status: implementation specification
Frozen dependency: `DATA-001` at `b5ce8994ddc233ec086c1e9059b8c921e63e1cf7`

## Outcome

Provide a deterministic responsibility service and a bounded AI domain-suggestion
service. Responsibility corrections and reports use persisted facts only. The AI
service receives only authorized redacted shared excerpts and can return only an
ephemeral suggestion that an authorized human must explicitly confirm before a
domain write is attempted.

## Scope and constraints

- `modules/responsibility` owns task-attribution correction, report eligibility,
  neutral report templates, visibility checks, and persistence-port contracts.
- `modules/ai-domain` owns provider orchestration and explicit human confirmation
  for domain suggestions.
- Existing public contracts, database schema, root dependencies, and lockfiles are
  frozen inputs and are not modified by this task.
- All external actor, request, repository, and provider values are validated with
  strict schemas. Unknown keys fail closed.
- A persistence adapter must implement the documented guarded atomic operations.
  The feature service supplies all versions and authorization facts required for
  the adapter to revalidate inside its transaction.

## Deterministic responsibility flow

### Attribution correction

1. Validate the actor and `CorrectTaskAttribution` request.
2. Load a bounded persisted context and verify the active space, active actor,
   role, task, domain, visibility, evidence state, expected task version, and all
   attributed members.
3. Construct only structured audit changes for the five responsibility fields.
   The free-text correction reason is included in the idempotency hash but never
   in audit metadata.
4. Send the mutation port an immutable guard containing every checked version.
   The adapter must atomically revalidate the guard, update the task, write the
   content-free audit entry, and complete idempotency. A stale guard writes
   nothing.

### Responsibility report

1. Validate the actor, space, and closed interval, then load a bounded snapshot.
2. Include only visible, in-period, non-cancelled tasks whose review state is
   current, whose evidence is available, and whose linked current responsibility
   signal is visible and originated from `potential_task`.
3. Exclude `discussion_only`, `high_risk`, `evidence_missing`, and `needs_review`
   facts before counting.
4. Count the five persisted responsibility fields exactly and render one of the
   checked-in Chinese templates. Templates describe records only; they contain no
   score, rank, blame, diagnosis, or relationship judgment.

## AI domain-suggestion flow

1. Validate bounded task, signal, and evidence version references before loading
   context.
2. Verify exact set equality, active membership and analysis consent, same-space
   ownership, visibility, current review/evidence state, and a common non-widening
   visibility scope.
3. Build provider input from numbered `redactedExcerpt` values only. Persistent
   task, signal, evidence, member, and space identifiers are never serialized into
   provider input, and repository projections reject raw evidence fields.
4. Retry a timeout, unavailable provider, or invalid structured output once. On
   exhaustion, return a bounded review result and perform no mutation.
5. Revalidate the complete version guard after provider completion. A changed
   authorization, evidence state, or version discards the suggestion.
6. Return a non-persisted `awaiting_human_confirmation` suggestion. A separate
   command requires an authorized human and `confirmedByHuman: true`, reloads and
   revalidates the same guard, then calls one guarded atomic domain-insert port.

## Acceptance and verification

- Unit tests assert that every unauthorized or stale input stops before provider
  invocation and that provider payloads contain only redacted excerpts.
- Unit tests assert zero mutation calls for provider failures, invalid output,
  changed context, and unconfirmed suggestions.
- Unit tests cover atomic correction guards, content-free audit metadata,
  deterministic exclusions, all five report rows, and uneven-workload copy.
- Required verification is `pnpm run check:responsibility` plus the task's
  forbidden-ancestor gate and repository scope gate.

## Known integration boundary

The selected `DATA-001` base exposes the PostgreSQL schema and a handover
repository, but it does not expose responsibility or domain-suggestion repository
methods. This track therefore defines narrow ports with transaction-level guard
requirements; the integration track must bind those ports to PostgreSQL without
weakening revalidation or visibility checks.
