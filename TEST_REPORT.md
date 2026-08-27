# Test Report

Generated: 2026-08-27

## Result

```text
Source archive SHA-256: PASS
Source package manifest: 32 / 32 payload files PASS before customization
Python syntax compilation: 9 files PASS
Automated unit/integration tests: 26 / 26 PASS
Plan validation: PASS
Fleet doctor against live Orca Runtime: PASS
Directory ownership overlap: 0
Current plan: 7 Waves / 19 Tasks
Execution mode: child-agents-only
Required Worktree mode: new-top-level
Completion task: INT-002
Launch authorization: false
```

## Verified controls

### Plan and product boundaries

- The first product implementation task is `DATA-001`. It owns only `packages/db/**` and `supabase/**`; every later Wave transitively depends on it.
- `DATA-001` requires applying migrations to a disposable PostgreSQL instance and inspecting the resulting catalog. SQL text matching alone is not accepted as database proof.
- The plan records exactly four product Agent boundaries: Witness, Responsibility, Handover, and Boundary.
- Product Agent boundaries are separate from execution isolation: every Task Attempt still receives a fresh top-level Worktree.
- Care escalation forbids LLM calls. The care track consumes a validated `CareRuleDraft` but cannot depend on an AI package.
- Report rendering forbids LLM calls and permits only versioned human-authored templates with allowlisted literal substitution.
- The plan is intentionally `draft`, `launch_authorized=false`, and uses `BLOCKED_UNTIL_KIT_IS_IN_SHARED_BASE`.

### Plan and ownership

- Directory glob matching, containment, and overlap detection pass.
- Concurrent tasks with overlapping write paths are rejected.
- A Task cannot downgrade or override `worktree_mode=new-top-level`.
- The plan must declare `child-agents-only`, `worktree_per_task=true`, `reuse_worker=false`, and `coordinator_role=control-only`.
- `control` tasks and coordinator-executed implementation tasks are rejected.
- The final completion task is an integration task in the final Wave and transitively depends on every other Task.
- `.agents/fleet.json` uses the explicit Orca repository ID for this checkout.

### Worktree isolation and Windows behavior

- The main Git worktree is distinguished from a linked Worker worktree.
- `gate.py init` accepts a correctly named linked Worker worktree and rejects the main worktree.
- Workspace names include Run token and Attempt, and change on every retry.
- Orca's optional owner-prefixed branch form is accepted without allowing nested or unrelated branch names.
- Worker completion verifies scope, checks, clean status, commit Task IDs, upstream state, remote SHA, immutable identity, and Proof Hash.
- The Worker completion test mocks only the Orca message send in-process; it still uses real temporary Git repositories and never falls through to the installed Orca CLI on Windows.
- Subprocess decoding is explicitly UTF-8 with replacement for invalid bytes.

### Shared-state safeguards

- `orca.yaml` runs plan validation only.
- `scripts/install_hooks.py` remains available but opt-in because `core.hooksPath` is shared across worktrees.
- Local and global `core.hooksPath` were both unset after validation.
- The launch and start-coordinator paths reject the current non-authorized plan before creating any Run, Task, Dispatch, Coordinator, or Worker.

### Integration and release

- Clean two-parent no-ff merges of exact accepted dependency SHAs pass.
- Direct integration edits to Worker-owned paths are rejected.
- Manually altered or conflicting merge trees are rejected.
- Release checks run in a fresh detached verification worktree, which is removed afterward.
- Strict finalize requires every Task to be completed, verifies remote branch drift, proves every accepted Task SHA is an ancestor of the release SHA, revalidates the integration tree, and writes a hashed completion proof.

## Current environment

- Orca Desktop/runtime `1.4.188` was reachable and ready during validation.
- `python scripts/fleet.py doctor --plan .agents/plans/current.json --json` passed against the live runtime and installed orchestration skill.
- Docker Engine `29.5.3` was reachable for the future disposable PostgreSQL migration check.
- `psql` and the Supabase CLI were not installed globally; `DATA-001` therefore owns a self-contained Docker-backed migration verifier under `packages/db/**`.

## Deliberate limitation

No real Fleet Run or child Agent was launched. The control plane exists only on the local branch `songconmaisaix31-design/we-remember-fleet-kit`; the protected `main` and `origin/main` remain at `70ca3dce63e137902274c14c101e69e47a84f1cb`.

The original `PACKAGE_MANIFEST.json` remains source-archive provenance. Customized files intentionally no longer match its payload hashes; the installed tree is verified by Git diff, tests, plan validation, and the local commit instead.
