# Coordinator Context Brief — run_6f548c6156cc

- Objective: repair Fleet new-top-level Worker startup through explicit worktree creation and exact terminal dispatch, prove it with a disposable canary, then create a new product Run that dispatches `DATA-001` only.
- Coordinator terminal: `term_5eafc3f3-3648-43a3-b4f1-052e2277ff5a`
- Coordinator worktree: `14e93d48-5336-4dbf-a84d-88325f8f3d77::C:/Users/DW/orca/workspaces/gethe-point/fleet-control-selector-recovery-20260827T014449Z`
- Recovery status: planning.
- Repair task: `AUTO-RECOVERY-001`, Task ID pending.
- Product execution: blocked until repair acceptance and canary completion.

## Immutable legacy boundary

Run `run_262bccf7adb3` and Tasks `task_6a6c81796edb`,
`task_901149216cb7`, and `task_45f46286189c` are permanently read-only.
Live baseline inspection shows all three Dispatch lookups are null and the old Run
has no Worker records.

## Next actions

1. Commit and push this control bootstrap.
2. Freeze the pushed SHA in a new automation repair Task.
3. Create one independent top-level Worker through the supported low-level path.
4. Supervise through structured `worker_done`, remote acceptance, and release.
