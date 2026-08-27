# Fleet Worker-Start Selector Recovery Tech Spec

- Status: Approved for one recovery Run
- Date: 2026-08-27
- Recovery Run: `run_6f548c6156cc`
- Coordinator terminal: `term_5eafc3f3-3648-43a3-b4f1-052e2277ff5a`
- Coordinator worktree: `14e93d48-5336-4dbf-a84d-88325f8f3d77::C:/Users/DW/orca/workspaces/gethe-point/fleet-control-selector-recovery-20260827T014449Z`

## Problem

`scripts/fleet.py` currently starts a new top-level Worker through one composed
`orchestration worker-start` call. On this host that path fails with
`selector_not_found` before Orca creates a Dispatch, worktree, branch, or Worker.
Changing the repository selector does not change the result.

The product DAG is therefore blocked before `DATA-001` can begin. The old product
Run and its three residual Task rows are audit evidence, not reusable work.

## Goal

Make Fleet new-top-level Worker startup use the supported low-level sequence:

1. create an independent top-level worktree explicitly with the exact repository
   selector, frozen remote base, `--no-parent`, the requested agent, and setup;
2. retain the complete Orca worktree ID and the single returned agent terminal
   handle;
3. wait for that exact handle to reach `tui-idle`;
4. dispatch the newly created Task with `orchestration dispatch --inject`, an
   explicit Run ID, and an explicit coordinator sender handle;
5. persist the worktree, terminal, Task, Dispatch, branch, base SHA, workspace,
   attempt, and contract hash as structured identity;
6. fail closed when any stage fails and never report `dispatched` without a real
   Dispatch receipt.

## Scope

The automation repair Worker may write only:

- `scripts/fleet.py`
- `scripts/tests/**`
- `docs/operations/FLEET_WORKER_START_RECOVERY.md`

No product code, root dependency, lockfile, CI, installed Orca binary, or
`app.asar` change is authorized.

## Acceptance Criteria

1. New-top-level startup no longer depends on composed selector resolution.
2. The implementation uses the complete worktree ID and one exact terminal
   handle returned by Orca; it does not search by ambiguous display name.
3. Run and sender identity are explicit on dispatch.
4. Partial failure receipts record the actual completed stages and residual
   resources; state never claims a Dispatch that does not exist.
5. Existing non-new-top-level behavior remains compatible unless a focused test
   proves a change is required.
6. Regression tests cover success plus failures at worktree creation, terminal
   readiness, and dispatch.
7. Unit tests, Python compilation, plan validation, and Fleet doctor pass.
8. A disposable canary creates a new Run, Task, top-level worktree, and Dispatch;
   reaches ready; sends `worker_done`; is accepted; and releases the exact Worker.
9. Read-only live checks prove `task_6a6c81796edb`, `task_901149216cb7`, and
   `task_45f46286189c` still have no Dispatch.

## Risks and Controls

| Risk | Control |
|---|---|
| Worktree exists but dispatch fails | Persist the exact residual resource receipt and fail closed. |
| Setup and agent startup race | Wait on the returned agent handle with a bounded `tui-idle` timeout. |
| Ambiguous selector reappears | Use the full `<repoId>::<absolutePath>` worktree identity. |
| Duplicate dispatch after retry | Treat Task/Dispatch receipts as authoritative and never redispatch an accepted Task. |
| Old product attempts are accidentally reused | Hard-code their IDs in recovery invariants and test only through new Runs and Tasks. |
| Repair broadens into Orca binary modification | Prohibit restart, upgrade, installed application edits, and `app.asar` changes. |

## Verification

The Worker must run focused unit tests and compilation. The coordinator then runs
the complete automation test suite, plan validation, Fleet doctor, remote-SHA and
scope checks, followed by the disposable canary. Product execution remains blocked
until all of those checks pass.
