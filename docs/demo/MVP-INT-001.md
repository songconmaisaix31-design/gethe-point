# MVP-INT-001 Local Fixture Integration

Status: implementation specification and local acceptance contract

## Outcome

Connect the accepted Experience HTTP client and QA-002 seam to the real Next.js
runtime and PostgreSQL. The canonical journey remains deterministic,
credential-free, visibly fictional, and explicitly outside production
acceptance.

## Truth boundary

- The rendered experience keeps `Fixture`, `Local Demo`, and
  `Not Production Acceptance` visible.
- The `role` query parameter is an allowlisted demo selection, not
  authentication. Integration middleware exchanges it for a server-issued
  Local Fixture session identifier; command bodies never select role, actor,
  space, scenario, content, private text, or canonical identifiers.
- Session identifiers are non-secret selectors for this fictional local graph.
  Unknown, missing, or modified values fail closed and do not authorize a
  command.
- No live model, production identity provider, deployment, release, or official
  acceptance is part of this integration.

## HTTP contract

| Method | Path | Request | Success | Failure boundary |
| --- | --- | --- | --- | --- |
| `GET` | `/fixtures/mvp-core?role=<role>` | `role` is `primary`, `partner`, or `subject` | Renders the accepted Experience surface and issues the scoped Local Fixture session | An invalid role clears the session |
| `GET` | `/api/fixtures/mvp-core/state` | No body | QA `MvpCoreSnapshotSchema` | Unknown session returns `401`; no raw private text is returned |
| `POST` | `/api/fixtures/mvp-core/reset` | Exactly `{}` | `204` after one PostgreSQL reset transaction | Unknown fields return `400`; invalid session returns `401` |
| `POST` | `/api/fixtures/mvp-core/commands` | QA `MvpCoreCommandRequestSchema` | QA `MvpCoreCommandResponseSchema` | Strict parsing precedes mutation; safe error responses contain only code and snapshot |

Only the two explicit private-message probes accept `targetId`. Every other
command rejects it. Private probes are actor-bound and non-enumerating, and the
raw-share probe never creates a shared row.

## Runtime composition

1. Reset seeds the canonical fictional space, members, private conversation,
   private message, evidence, draft, responsibility domain/task, blocked
   handover, and active reminder in one PostgreSQL transaction. It seeds no
   consent decision, shared signal, report receipt, or acceptance receipt.
2. `record_share_consent` and `record_no_consent` call the public private-sharing
   service with the canonical subject actor derived from the server session.
3. `publish_consented_signal` calls the public sharing service. The signal and
   the Local Fixture responsibility-link receipt commit in the same PostgreSQL
   transaction, so a retry cannot create a second shared signal or linkage.
4. `generate_report` calls the public responsibility query service. Its adapter
   reads members, domain, task, all five persisted attribution fields, the
   consented source graph, and the validated linkage receipt from PostgreSQL on
   every request. A caller-scoped report receipt is only a durable generated
   marker; cached report JSON is never used as query truth.
5. `supply_handover_info`, `confirm_handover_from`, and
   `confirm_handover_to` call the public handover service. Missing information
   and one-sided confirmation leave domain and reminder ownership unchanged.
6. Once both confirmations exist, the server-owned
   `handover_service` actor invokes
   `createDatabaseHandoverAcceptancePort(database)`. DATA-001 then changes the
   accepted handover, domain owner, future-task owner, active reminder owner,
   audit entry, and acceptance idempotency result atomically.

## Local Fixture receipt bridge

The current DATA-001 schema intentionally has no durable task-to-source-signal
relation. For this Local Fixture only, `FixtureCreateResponsibility` stores a
Zod-validated completed result in `idempotency_records`, keyed by the canonical
source signal and actor. The adapter verifies the pre-seeded canonical domain
and task in the same transaction before completing the receipt; the report
adapter accepts no unvalidated JSON and recovers linkage only through that
receipt.

State snapshots use a PostgreSQL `REPEATABLE READ` transaction so handover,
domain ownership, and reminder ownership come from one coherent database
snapshot even though DATA-001 acceptance does not use the Fixture advisory
lock.

This is not the long-term responsibility data model. A production design needs
an owned schema migration for a first-class source relation and must not reuse
the Fixture receipt as application storage.

## Security and failure acceptance

- Before consent, shared-signal rows are zero. Consent recording and signal
  publication are separate writes.
- Partner private-message reads and raw-share attempts return non-enumerating
  `404` responses. Error responses never contain private message content.
- Invalid JSON, unknown fields, authority fields, content fields, scenario
  fields, and probe-only `targetId` on ordinary commands return `400` with zero
  mutation.
- Missing or altered Local Fixture sessions return `401` with zero mutation.
- Wrong-role commands return `403`; guarded state transitions return `409`.
- Provider behavior is the accepted deterministic Fixture implementation and
  requires no external model or credential.

## Local verification

The runtime requires a disposable PostgreSQL database with
`packages/db/migrations/0000_initial.sql` already applied. Supply its connection
URL only through `MVP_CORE_DATABASE_URL`; never commit or print the generated
value.

Run the repository checks from a clean checkout:

```text
pnpm install --frozen-lockfile
pnpm run check
pnpm run db:verify
pnpm run build
pnpm exec playwright test --grep @mvp-core
```

For the browser command, start the built Next.js server with the same local
`MVP_CORE_DATABASE_URL` and keep it bound to `127.0.0.1:3000`. The Playwright
suite does not intercept routes or inject mock HTML.
