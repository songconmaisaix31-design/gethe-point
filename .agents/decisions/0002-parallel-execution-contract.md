# ADR 0002: Parallel Execution and Integration Contract

- Status: Approved
- Date: 2026-08-27
- Active plan: `.agents/plans/current.json`
- Shared base: `origin/songconmaisaix31-design/we-remember-requested-fleet-v2`

## Decision

Use the requested Fleet Kit as the only control-plane lineage for this run. The remote branches and failed Runs created from `we-remember-orca-fleet-kit-worktree-enforced.zip` are historical input only; their Run IDs, authorization, dispatches, and evidence are not reused.

The active plan launches only after its own control-plane branch is fetched by exact ref and the plan contains both `plan_status: approved` and `launch_authorized: true`. `scripts/fleet.py` must reject any other plan before fetch, Orca state mutation, or run-directory creation.

## Worktree and ownership rules

1. Every task attempt uses `--worktree new-top-level` with a unique `trk-<track>-<task>` workspace.
2. A worker starts from the exact accepted base SHA recorded in the Fleet state.
3. A worker writes only the task's exact `write_paths`; read access does not grant ownership.
4. A worker does not switch branches, merge, rebase, hard reset, force push, or modify another track.
5. A failed retry receives a new task attempt and worktree. Failed retained worktrees are evidence, not reusable baselines.
6. Each successful worker runs its required checks and scope gate, commits with `[LOGICAL_TASK_ID]`, pushes, verifies `HEAD == upstream`, sends exactly one `worker_done`, and stops.
7. The coordinator writes only control-plane state, decisions, plans, and handoffs.

## Dependency and integration rules

- `FOUND-001`, `CONTRACT-001`, and `DATA-001` are serial gates.
- The seven `*-001` core tasks all start from the accepted `DATA-001` SHA.
- `INT-001` starts from `DATA-001` and merges every accepted core SHA with one clean `--no-ff` merge per dependency.
- Integration conflicts fail closed and return to the owning track. The integrator does not repair module files inside a merge commit.
- Each `*-002` hardening task starts from the accepted `INT-001` SHA.
- `INT-002` starts from `INT-001`, merges every accepted hardening SHA exactly, runs the full detached acceptance suite, and emits the release manifest.
- No task is considered accepted from local files, an unpushed commit, a screenshot alone, or an HTTP 200 response.

## Evidence levels

Every receipt labels one of these levels:

- `Static Review`
- `Unit or Contract Test`
- `Disposable Database Test`
- `Local Runtime`
- `Browser E2E`
- `Fixture Demo`
- `Public Deployment`
- `Official Acceptance`

Higher levels are never inferred from lower levels. In particular, fixture and local runtime evidence do not prove a public deployment, and a deployment does not prove official acceptance.

## Failure policy

- Missing base SHA, missing consent, missing confirmation, invalid AI output, failed authorization, merge conflict, scope violation, or failed check blocks advancement.
- A worker sends a structured question or escalation instead of making an out-of-scope repair.
- Release scope cuts remove P1 first, then optional live AI, then deployment automation. Privacy, authorization, five responsibility fields, blocked handover, atomic reminder migration, deterministic care, evidence invalidation, and role-specific home experiences are not cut silently.
