# ADR-0004: Use Explicit Worktree Creation for Fleet New-Top-Level Workers

- Status: Accepted for recovery implementation
- Date: 2026-08-27
- Recovery Run: `run_6f548c6156cc`
- Supersedes: composed `worker-start --worktree new-top-level` inside Fleet only

## Context

Run `run_262bccf7adb3` exhausted three isolated `DATA-001` startup attempts.
Each attempt created a new Orca Task row, but the composed Worker start returned
`selector_not_found` before any Dispatch or Worker resource existed.

The public Orca CLI supports the same lifecycle as separate primitives. This
recovery must fix the Fleet automation path without modifying the installed Orca
application or rewriting the old Run.

## Decision

For Fleet tasks whose required placement is `new-top-level`, use this sequence:

1. `orca worktree create` with the exact repository ID, explicit frozen remote
   base, `--no-parent`, `--agent`, and `--setup run`;
2. retain the complete returned worktree ID and the single returned agent handle;
3. wait for that handle to reach `tui-idle`;
4. call `orca orchestration dispatch --inject` for the already-created new Task,
   with explicit `--run` and `--from` identities;
5. persist every receipt and mark the attempt dispatched only after the Dispatch
   receipt exists.

The implementation must be the smallest change that reuses existing command,
receipt, state, and failure-handling helpers. It must not add a second scheduler,
an unsupported selector fallback, or an Orca installation patch.

## Immutable Audit Boundary

The following records are permanently read-only and must never be dispatched,
updated, retried, adopted, or reused:

- Run `run_262bccf7adb3`
- Task `task_6a6c81796edb`
- Task `task_901149216cb7`
- Task `task_45f46286189c`

All repair and canary work uses new Runs, new Tasks, new worktrees, new branches,
new Dispatches, and new contract hashes.

## Consequences

The new path has more explicit stages, but every stage becomes independently
auditable. A partial failure may leave a worktree or live terminal that requires
an explicit recovery decision; it may not be hidden by claiming the Task was
dispatched. Destructive cleanup, Orca restart, or Orca upgrade remains outside
this Decision and requires escalation.
