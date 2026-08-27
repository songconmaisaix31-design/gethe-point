# Acceptance Blockers — Core Wave Attempt 001

- Run: `run_a6e82cb7623f`
- Database baseline: `b5ce8994ddc233ec086c1e9059b8c921e63e1cf7`
- Recorded: 2026-08-27

## Accepted

- `HAND-001`: `59e4bcb98be9d21432a92d02e7d01962bc4451cb`

## Rejected Attempts

### RESP-001

- Evidence SHA: `7ebd3ebafb7274eed1f6f1551e1c64550a772167`
- Reason: provider input is not checked against authorized space, task IDs, and evidence IDs before the external AI call.
- Required replacement proof: unauthorized input fails closed before invocation and the provider call count remains zero.

### CARE-001

- Evidence SHA: `b5371bb0d23cd0f2b51dcd4df020043fd54942ed`
- Dispatch limitation: low-level `dispatch --inject`; `unsupervised`, not a normal supervised Worker.
- Reasons: caller-backdated acknowledgement can suppress an already-due escalation; validated resolution is discarded; PostgreSQL lock ordering is inconsistent.
- Required replacement proof: server-observed deadline semantics, persisted and audited resolution, and representative PostgreSQL concurrency verification.

### PRIV-001

- Evidence SHA: `a90c520cbd0a65c86d3f76e2f3e08f3b4d671ad8`
- Reason: export denial uses generic `not_found` outside the frozen Export error contract.
- Required replacement proof: dedicated `export_not_authorized` mapping and inactive/missing actor contract tests.

### EXPR-001

- Status: awaiting failed worker completion.
- Reason: the exact scope omits `apps/web/next-env.d.ts`; a test-only renderer is not accepted as proof that the required Next.js app runs.
- Required replacement proof: fresh owned runtime path plus real browser checks at both frozen viewports.

## Cross-track correction

- `Signal.evidenceState` contract: `available | evidence_missing`.
- DATA-001 storage: shared evidence enum `available | deleted` is also used by `signals.evidence_state`.
- Required correction: a signal-specific enum, forward migration, Drizzle snapshot, catalog evidence, and disposable PostgreSQL test.

## Gate

`INT-001` remains blocked until every replacement and correction named in ADR 0003 is independently accepted by exact remote SHA.
