# Escalation: DATA-001 Worker Creation Is Blocked by Orca Worktree Resolution

- Run: `run_262bccf7adb3`
- Logical task: `DATA-001`
- Severity: blocking
- Responsible boundary: Orca runtime / automation control plane
- Frozen base ref: `origin/songconmaisaix31-design/we-remember-fleet-kit`
- Frozen base SHA: `ecc7d5cbc32bc606cf568cd508038476689c4154`

## Evidence

1. Attempt 1 used `id:14e93d48-5336-4dbf-a84d-88325f8f3d77` and failed with `selector_not_found` before any Dispatch, branch, or worktree was created.
2. Read-only discovery found two local registrations for the same remote. The configured ID and the exact path `C:/Users/DW/orca/gethe-point` both resolve uniquely, and the frozen remote ref resolves to the frozen SHA.
3. Attempt 2 used `path:C:/Users/DW/orca/gethe-point`, created the immutable workspace identity `trk-foundation-data-001--262bccf7adb3-a2`, and returned the same `selector_not_found` before any Dispatch, branch, or worktree was created.
4. `orca orchestration worker-list --run run_262bccf7adb3` is empty, both Task Dispatch lookups return `null`, and no `trk-foundation-data-001--262bccf7adb3-a*` worktree exists.
5. Orca still lists the two pre-dispatch Task records `task_6a6c81796edb` and `task_901149216cb7` as `ready`. They are failed-at-launch residual records with no Dispatch or Worker and must not be dispatched manually.
6. All later plan tasks remain blocked by the DAG.

## Diagnosis Boundary

The failure occurs before worker resource accounting begins. Changing the repository selector from the exact registration ID to the unique exact repository path did not change the result. The frozen base ref and SHA were not changed.

This points to Orca resolving the coordinator terminal's managed worktree during `orchestration worker-start`, not to product code or the DATA-001 contract. No product, test, fixture, integration, or release work has started.

## Required Recovery

Correct or refresh the Orca runtime's coordinator-worktree resolution so the current coordinator terminal resolves to its exact full worktree ID during `worker-start`.

Acceptance for recovery:

- the current coordinator terminal and exact full worktree ID resolve consistently;
- the two stale `ready` Task records are reconciled or explicitly excluded from dispatch;
- `worker-start --worktree new-top-level` reaches a structured `ready` receipt;
- the next Fleet retry creates only fresh Attempt 3 workspace `trk-foundation-data-001--262bccf7adb3-a3` from the unchanged frozen SHA;
- no later DAG task is dispatched before DATA-001 is remotely accepted.

Do not invoke `fleet.py retry` again until the runtime correction is verified and Attempt 3 is explicitly authorized.
