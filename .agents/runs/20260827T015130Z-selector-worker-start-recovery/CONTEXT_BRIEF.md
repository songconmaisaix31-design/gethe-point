# Coordinator Context Brief — run_6f548c6156cc

- Objective: repair Fleet new-top-level Worker startup through explicit worktree creation and exact terminal dispatch, prove it with a disposable canary, then create a new product Run that dispatches `DATA-001` only.
- Coordinator terminal: `term_5eafc3f3-3648-43a3-b4f1-052e2277ff5a`
- Coordinator worktree: `14e93d48-5336-4dbf-a84d-88325f8f3d77::C:/Users/DW/orca/workspaces/gethe-point/fleet-control-selector-recovery-20260827T014449Z`
- Recovery status: repair dispatched.
- Repair task: `AUTO-RECOVERY-001` / `task_181fece3bd35` / Dispatch `ctx_c96266d59ef9`.
- Repair identity: Attempt 1, workspace `trk-automation-auto-recovery-001--6f548c6156cc-a1`, terminal `term_b2e3783b-8a86-48d8-b532-45eccb5dc3d2`.
- Frozen base: `origin/songconmaisaix31-design/fleet-control-selector-recovery-20260827T014449Z` at `e742b09a660a5ff8ab8cda5684240a9fbf8fe961`.
- Contract hash: `2e72b47777bf03c34e8558a9aa5c6bbfcebd3a048ebe492a8431d8dae91e916c`.
- Product execution: blocked until repair acceptance and canary completion.

## Immutable legacy boundary

Run `run_262bccf7adb3` and Tasks `task_6a6c81796edb`,
`task_901149216cb7`, and `task_45f46286189c` are permanently read-only.
Live baseline inspection shows all three Dispatch lookups are null and the old Run
has no Worker records.

## Next actions

1. Wait for one structured `worker_done`, `question`, or `escalation` from the repair Dispatch.
2. Verify scope, checks, clean remote branch, and exact remote SHA.
3. Release the settled low-level Dispatch through Orca's supported release command.
4. Run the disposable canary before authorizing a product Run.
