# AUTO-REPAIR-002 Handoff

## Objective

Replace rejected automation Attempt `AUTO-REPAIR-001` with a crash-consistent, concurrency-safe append-only amendment implementation before any active Run state is amended.

## Frozen base and evidence

- Base SHA: `c4797ad076e049935ea16a9e9e7d036e3c30a08b`
- Rejected Dispatch: `ctx_3c9a0a297505`
- Preserve the prior branch, commit, transcript, and acceptance outcome unchanged.

## Exact ownership

- `scripts/fleet.py`
- `scripts/common.py`
- `scripts/tests/**`
- `.agents/fleet.json`
- `.agents/prompts/coordinator.md`
- `MEMORY.md`

Do not modify `.agents/runs/**`, `.agents/plans/**`, product code, fixtures, deployment files, or existing acceptance evidence. Do not apply an amendment to the active Run.

## Required implementation

1. Add one standard-library cross-process lock for each Run state. Every command that can write an existing state or its derived STATUS must hold the same lock from byte-snapshot load through commit or settlement.
2. On Windows use `msvcrt.locking`; on POSIX use `fcntl.flock`. Use a bounded fail-closed acquisition policy and do not add a dependency.
3. Parse JSON and compute SHA-256 from the same immutable bytes read while holding the lock. Never hash and parse separate filesystem snapshots.
4. Replace amendment commit with a recoverable journal-first protocol. The immutable journal must record amendment hash, before/after state hashes, fixed `applied_at`, exact change summary, and expected receipt/STATUS identities before state replacement.
5. Make replay deterministic across failures before and after state replacement and during receipt or STATUS generation. A valid journal may repair missing derived evidence; a missing, corrupt, or conflicting journal/receipt must fail closed.
6. Never report `already_applied` without validating the state amendment record, source hash, journal, receipt, and derived STATUS. Recreate only deterministically derivable missing artifacts.
7. Preserve non-overwriting evidence paths and prevent duplicate waves, tasks, resolutions, journals, receipts, or Orca mutations.
8. Compute the original DAG's transitive downstream set for every resolution source. Existing wave or task updates are allowed only when never dispatched and downstream of at least one resolved source.
9. Permit `superseded_by` only for a failed source and `corrected_by` only for a completed source.
10. Preserve all accepted AUTO-REPAIR-001 behavior: approval and authorization checks, explicit Run/coordinator/dependency identities, immutable failed Attempts, accepted replacement SHA finalization, attempt-unique acceptance evidence, and the experience runtime allowlist.
11. Update coordinator guidance and `MEMORY.md` with only durable, non-secret recovery rules.

## Acceptance

- Two real processes synchronized by a barrier cannot lose either state update; a bounded lock failure makes no state, evidence, STATUS, or Orca mutation.
- State and amendment content/hash pairs are proven to come from one byte snapshot.
- Failure injection before and after state replacement and during journal, receipt, and STATUS writes is replay-safe and produces one coherent result.
- Missing, corrupt, or content-mismatched journal/receipt evidence never produces a false `already_applied` result.
- An unrelated zero-dependency planned wave/task cannot be patched even when it has never been dispatched.
- `failed + corrected_by` and `completed + superseded_by` are rejected before any mutation.
- Existing dispatched/lifecycle mutation, stale CAS, duplicate identity, overlap, reacceptance, finalization, launch recovery, and integration tests remain green.
- `python -B -m unittest discover -s scripts/tests -v`, `python -B -m compileall -q scripts`, `python -B scripts/fleet.py validate .agents/plans/current.json --json`, `python -B scripts/fleet.py doctor --json`, and `git diff --check` pass.
- The branch is clean, pushed, and its upstream SHA equals HEAD.

## Evidence boundary

Passing this task proves only the replacement control-plane mechanism. It does not amend the active Run, accept a product replacement, start integration, or prove a release candidate.
