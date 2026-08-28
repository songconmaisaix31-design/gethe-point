# Orca Lite Worktree Protocol

## Structure

```text
Coordinator
  |-- Owns one-page plan, task cards, decisions, and acceptance
  |-- Dispatches 2-3 long-lived workers with non-overlapping write paths
  `-- Dispatches one integration worker after development passes

Each development track
  `-- 1 agent + 1 worktree + 1 branch + exclusive write paths
```

## Rules

1. The PRD defines the outcome and acceptance. Do not turn the MVP into a platform.
2. Inspect file conflicts before splitting work. Use fewer agents when boundaries overlap.
3. Keep the same agent and worktree for implementation, tests, and corrections.
4. Workers may read the repository but write only assigned paths; cross-track needs become handoffs.
5. Tests belong to the task, not a later hardening phase.
6. The coordinator does not write product code.
7. The integration worker adds only small wiring/configuration glue; domain defects return to the original worker.
8. Git, focused tests, build, and the runnable core path are sufficient evidence.
9. Do not create custom orchestration, attempt, hash, manifest, or proof systems.
10. Do not claim completion while the core path or applicable checks fail.

## Completion

- The four-minute Fixture demo path runs end to end.
- Applicable typecheck, lint, unit, build, E2E, and accessibility checks pass.
- No undisclosed critical placeholder remains.
- The integration branch is pushed and the README is reproducible.
