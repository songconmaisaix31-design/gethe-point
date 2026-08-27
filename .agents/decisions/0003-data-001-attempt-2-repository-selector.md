# ADR-0003: DATA-001 Attempt 2 Uses the Exact Local Repository Path

- Status: Accepted for Run recovery
- Date: 2026-08-27
- Run: `run_262bccf7adb3`
- Task: `DATA-001`

## Context

`DATA-001` Attempt 1 failed before Orca created a Dispatch, branch, or worktree. The runtime returned `selector_not_found` while `fleet.py launch` used the configured repository selector `id:14e93d48-5336-4dbf-a84d-88325f8f3d77`.

Read-only discovery found two local registrations for the same GitHub repository. The configured ID resolves to `C:/Users/DW/orca/gethe-point`, and that repository contains the frozen remote ref at `ecc7d5cbc32bc606cf568cd508038476689c4154`. The alternative registration remains out of scope.

## Decision

For this Run only, replace `state.json.repo_selector` with the unique exact selector:

```text
path:C:/Users/DW/orca/gethe-point
```

Do not change `initial_base_ref`, `initial_base_sha`, or any task-level `base_ref` / `base_sha`. Retry `DATA-001` through `fleet.py retry`, producing a fresh Attempt 2 workspace ending in `-a2`.

## Safety Gate

If Attempt 2 returns `selector_not_found`, do not create Attempt 3. Preserve the failed evidence and escalate the Orca control-plane selector issue.

## Outcome

Attempt 2 used `path:C:/Users/DW/orca/gethe-point`, preserved the frozen base, and created the required `-a2` task identity. Orca again returned `selector_not_found` before creating a Dispatch, branch, or worktree.

The safety gate is now active. No Attempt 3 or later DAG task may be started until the Orca control-plane worktree-resolution failure is corrected and recovery is explicitly authorized.
