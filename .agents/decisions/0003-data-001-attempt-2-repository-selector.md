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

## Attempt 3 Recovery Authorization

The Orca runtime worktree cache/resolution was refreshed. Read-only verification on 2026-08-27 established that:

- live coordinator terminal `term_e9818968-fa20-4ea2-8ca3-970672121227` is connected, writable, and bound to the expected coordinator worktree;
- `id:14e93d48-5336-4dbf-a84d-88325f8f3d77::C:/Users/DW/orca/workspaces/gethe-point/fleet-control-execute-the-we-remember-20260827t004358z` resolves exactly;
- the same full worktree selector without the `id:` prefix resolves to the same immutable worktree identity;
- `path:C:/Users/DW/orca/gethe-point` resolves to the intended repository registration and retains the frozen default base.

The recovery prerequisite is met. One and only one `fleet.py retry` is authorized for `DATA-001` Attempt 3, preserving repository selector `path:C:/Users/DW/orca/gethe-point`, frozen base ref `origin/songconmaisaix31-design/we-remember-fleet-kit`, frozen base SHA `ecc7d5cbc32bc606cf568cd508038476689c4154`, and fresh workspace name `trk-foundation-data-001--262bccf7adb3-a3`.

If Attempt 3 does not return a ready Worker receipt, the Task is permanently stopped with no further retry. If it is ready, only `DATA-001` may run until remote acceptance; later DAG work remains blocked.

## Attempt 3 Outcome

The one authorized retry created Orca Task record `task_45f46286189c` and immutable Attempt 3 contract hash `82040db046b14ac39dea458aa5c53f4a29b8e13530faeebd7d3ff635abb662a7`, then invoked `worker-start` with repository selector `path:C:/Users/DW/orca/gethe-point` and workspace name `trk-foundation-data-001--262bccf7adb3-a3`.

`worker-start` again returned `selector_not_found` before creating a Dispatch, branch, worktree, or Worker. Attempt 3 is the final allowed attempt. `DATA-001` remains failed, the Run remains incomplete, all later DAG tasks remain blocked, and no further retry is permitted.
