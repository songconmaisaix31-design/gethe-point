# ADR 0003: Acceptance Repair and Append-Only Run Amendment

- Status: Approved
- Date: 2026-08-27
- Run: `run_a6e82cb7623f`
- Parent plan: `.agents/plans/current.json`
- Supersedes: no prior decision

## Context

Independent acceptance found defects that mechanical scope and test gates did not detect:

- `EXPR-001` cannot prove the required Next.js runtime because `apps/web/next-env.d.ts` has no owning write path.
- `CONV-001` can publish provider-supplied private content as a shared conclusion, accepts near-verbatim excerpts as redacted, and omits frozen domestic-violence and acute-medical risk categories.
- `RESP-001` can send structurally valid but unauthorized task and evidence identifiers to an AI provider before scope validation.
- `CARE-001` accepts a caller-backdated acknowledgement after the server clock has passed the deadline and discards the validated handling resolution.
- `PRIV-001` returns an export authorization error outside the frozen API contract.
- `DATA-001` cannot persist the contract's `Signal.evidenceState = evidence_missing` value.
- `QA-001` contains cross-entity fixture contradictions that allow shape-only tests to pass false business facts.

The original Tasks and Dispatches are immutable evidence. Reopening them, editing their contracts, or overwriting their acceptance receipts would make the Run impossible to audit. The current Fleet Kit cannot append replacement waves, express supersession, or finalize a resolved failed Attempt.

## Decision

1. Keep `run_a6e82cb7623f` as the sole active Run and preserve every original Task, Dispatch, branch, SHA, receipt, and outcome unchanged.
2. Do not start `INT-001` until every rejected capability has a fresh accepted replacement and the database and contract corrections are accepted.
3. Bootstrap one fresh automation Task, `AUTO-REPAIR-001`, from the current control SHA. It may change only Fleet Kit automation paths and must not mutate the active Run state.
4. After independent acceptance of `AUTO-REPAIR-001`, create a fresh `fleet-control-*` worktree from its exact SHA, bind it to the same Run, and apply one approved append-only amendment against the original absolute state path.
5. The amendment must use a state-hash compare-and-swap precondition, preserve the original plan and Run plan snapshot, and record before/after hashes plus automation provenance.
6. Rejected Attempts remain failed. A completed replacement resolves a failure for finalization but never changes the historical outcome.
7. Only an undispatched downstream task or wave may have its base, dependencies, or specification replaced by an approved amendment.

## Repair ordering

```text
AUTO-REPAIR-001
  -> Wave A from DATA-001: CONTRACT-CORR-001 + CONV-REPAIR-001 + RESP-REPAIR-001
  -> Wave B from CONTRACT-CORR-001: DATA-CORR-001 + EXPR-REPAIR-001
  -> Wave C from DATA-CORR-001: CARE-REPAIR-001 + PRIV-REPAIR-001 + QA-REPAIR-001
  -> amended INT-001 after all accepted core and replacement SHAs
```

`CONTRACT-CORR-001` freezes server-observed care timing and a persisted/audited safe resolution. `DATA-CORR-001` adds the signal-specific evidence-state storage, care resolution storage, forward migrations, and catalog proof. `CONV-REPAIR-001` validates every provider-derived shared field against private-input disclosure and routes every frozen high-risk category before provider invocation. `CARE-REPAIR-001` enforces one PostgreSQL lock order and adds a representative concurrency regression. The experience, conversation, responsibility, care, privacy, and QA replacements use fresh Task IDs, Dispatches, worktrees, branches, and receipts.

## Integration dependency set

The amended but still undispatched `INT-001` must use `DATA-CORR-001` as its base and depend on these accepted logical tasks:

- `DATA-CORR-001`
- `EXPR-REPAIR-001`
- `CONV-REPAIR-001`
- `RESP-REPAIR-001`
- `HAND-001`
- `CARE-REPAIR-001`
- `PRIV-REPAIR-001`
- `QA-REPAIR-001`

Rejected EXPR, CONV, RESP, CARE, PRIV, and QA SHAs must not enter integration. `DATA-001` and `CONTRACT-001` remain ancestors and historical accepted gates, while their corrections become the active integration lineage.

## Consequences

- The repair path is longer than an in-place exception, but preserves user privacy, deterministic care, reproducible UI proof, and truthful release evidence.
- No accepted HAND work is repeated.
- Failed Attempts remain inspectable and cannot later appear as successful through state overwrite.
- New product work remains blocked until the Kit amendment mechanism itself is independently verified.
