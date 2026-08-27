# PRIV-001 Privacy Service Specification

Status: Implementation contract for `PRIV-001`

Frozen dependencies:

- `CONTRACT-001` at `4f92e193870c54c39d4d26eda136f0950b6da339`
- `DATA-001` at `b5ce8994ddc233ec086c1e9059b8c921e63e1cf7`

## Outcome

Provide one deterministic privacy boundary for evidence access, redacted shared
conclusions, visible audit history, future-analysis revocation, personal export,
evidence deletion, and family-space deletion. Role labels never grant raw evidence
access, and every denial of an absent or unauthorized private record is
non-enumerating.

## Scope

The module owns:

- actor and visibility authorization predicates;
- trust-boundary schemas for raw-evidence, redacted-conclusion, and future-analysis
  queries that are internal to the privacy module;
- handlers for the frozen `DeleteEvidence`, `RevokeAnalysisConsent`,
  `ExportMyData`, `DeleteSpace`, and `GetAuditTrail` contracts;
- a transaction port that persistence adapters must implement atomically;
- deterministic report-eligibility policy for evidence-backed tasks.

The module does not own HTTP authentication, PostgreSQL schema changes, raw-content
storage, responsibility report rendering, UI, provider calls, or root dependencies.

## Public behavior

| Operation | Authorization | Result | Failure behavior |
| --- | --- | --- | --- |
| `readRawEvidence` | active evidence speaker in the same space | raw view for one available evidence item | absent, deleted, cross-space, and wrong-speaker records all return `not_found` |
| `readSharedConclusion` | active same-space member satisfying the signal visibility predicate | strict `SharedSignal` containing redacted text and provenance only | hidden and absent records both return `not_found` |
| `getAuditTrail` | active same-space member satisfying each entry visibility predicate | filtered, bounded, newest-first entries | cross-space access returns `not_found`; hidden entries are omitted |
| `authorizeFutureAnalysis` | active speaker with current member consent and only their available evidence | content-free authorization receipt | revoked consent returns `consent_invalid`; guessed evidence returns `not_found` |
| `RevokeAnalysisConsent` | member acting as self | member becomes revoked; prior authorized records stay unchanged | stale versions and replays fail closed |
| `ExportMyData` | member acting as self | current self-private and visibility-authorized shared records | no other member's private content enters the bundle |
| `DeleteEvidence` | evidence speaker | raw content removed; dependent projections invalidated | one atomic rollback on any failure |
| `DeleteSpace` | exact space creator with exact name and version | ephemeral content-free receipt | no persisted receipt, audit, or idempotency result survives deletion |

## Transaction and retention invariants

`PrivacyStore.transaction` must commit all writes or none. Evidence deletion updates
the evidence tombstone, every dependent signal provenance, every dependent task and
domain, one content-free audit entry, and its content-free replay record in the same
transaction. IDs in the receipt are unique and lexicographically sorted so the same
state always produces the same projection order.

Accepted handovers are read to produce `preservedAcceptedHandoverIds` but are never
updated or reversed. Affected domains retain `ownerId` while moving to
`needs_review`. Report consumers call `isTaskReportEligible`; a task is excluded when
it needs review or any referenced evidence is unavailable.

Export replay metadata stores only IDs and timestamps. It never stores the export
bundle, message text, raw evidence, raw references, credentials, tokens, or arbitrary
provider data. On replay, the module rebuilds the bundle from current authorization,
which prevents a stale idempotency record from restoring access that has since been
revoked.

Space deletion calls the persistence cascade and then verifies that no in-space
product, audit, or replay record remains. The receipt exists only in the command
response.

## Known integration constraint

`SharedSignal` requires `evidenceState: "evidence_missing"`, while the frozen
`DATA-001` schema currently maps `signals.evidence_state` to the evidence enum
`available | deleted`. The privacy port and tests implement the frozen contract value;
the data track must provide a signal-specific persisted enum before PostgreSQL
integration can store this transition.

## Verification

`pnpm run check:privacy` must pass strict TypeScript, focused ESLint, and focused
Vitest tests. Tests cover ID guessing, role-independent raw evidence denial,
visibility-filtered conclusions and audits, revocation history preservation,
deterministic invalidation, content-free replay records, actor-authorized export, and
complete space cascade.
