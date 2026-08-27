# AUTO-REPAIR-001 Handoff

## Objective

Add the smallest safe append-only amendment and supersession mechanism required to continue `run_a6e82cb7623f` without rewriting failed Attempts or hand-editing active state.

## Exact ownership

- `scripts/fleet.py`
- `scripts/common.py`
- `scripts/tests/**`
- `.agents/fleet.json`
- `.agents/prompts/coordinator.md`
- `MEMORY.md`

Do not modify `.agents/runs/**`, `.agents/plans/**`, product code, fixtures, deployment files, or any existing acceptance evidence.

## Required implementation

1. Add `fleet.py amend --state <path> --amendment <path> [--dry-run] [--json]`.
2. Require amendment-level `plan_status: approved` and `launch_authorized: true`.
3. Verify parent-plan and state SHA-256 preconditions before mutation; write the state atomically and record before/after hashes.
4. Append new waves and fresh tasks without changing any existing Task or Dispatch fields.
5. Permit changes only to downstream tasks and waves that have never been dispatched.
6. Record explicit `corrected_by` and `superseded_by` resolutions without changing historical outcomes.
7. Prevent `accept` from converting a failed logical Attempt back to completed.
8. Write acceptance evidence to a non-overwriting, attempt-unique path.
9. Teach status/finalize/manifest output to distinguish unresolved failures from `resolved_failure` backed by an accepted replacement SHA.
10. Create appended Orca Tasks with explicit Run, coordinator, and dependency identities.
11. Add `apps/web/next-env.d.ts` to the experience track allowlist.
12. Update coordinator guidance for append-only amendments and immutable failed Attempts.
13. Record only durable, non-secret recovery guidance in `MEMORY.md`.

## Acceptance

- A dry-run materializes the amended DAG without changing state or Orca.
- A matching CAS amendment appends repair waves and updates only an undispatched `INT-001` dependency/base contract.
- A stale state hash, unapproved amendment, existing Task mutation, existing Dispatch mutation, duplicate workspace, overlapping write path, or dispatched downstream edit fails before any write or Orca mutation.
- Re-running an applied amendment is idempotent and does not duplicate Tasks, waves, receipts, or Orca mutations.
- A failed Attempt cannot be accepted again under the same logical ID.
- Finalization remains blocked for unresolved failures and succeeds only when every resolution points to an accepted replacement.
- Existing plan validation, launch, partial-wave recovery, acceptance, and finalization tests continue to pass.
- `python -B -m unittest discover -s scripts/tests -v`, `python -B -m compileall -q scripts`, `python -B scripts/fleet.py validate .agents/plans/current.json --json`, `python -B scripts/fleet.py doctor --json`, and `git diff --check` pass.
- The branch is clean, pushed, and its upstream SHA equals HEAD.

## Evidence boundary

This task hardens the control plane only. Passing tests does not amend the active Run, accept a product replacement, start integration, or prove a release candidate.
