# Project Memory

## Project identity

- Product: `gethe-point` / 都记得 (We Remember).
- Repository: `https://github.com/songconmaisaix31-design/gethe-point`.
- Default branch: `main`.
- The repository was documentation-only when the fleet kit was introduced on 2026-08-26.

## Durable product decisions

- The product transfers ownership of complete family responsibility domains; it is not a flat household task list.
- Four product Agents define domain and contract boundaries; Git isolation uses one fresh worktree for every Task Attempt rather than four long-lived worktrees.
- `agent_dm` content is private by default. Shared-family writes require explicit speaker consent and must enforce the selected visibility scope.
- `Task.discoveredBy`, `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy` are first-class persisted database fields and must be introduced by the first migration task before application scaffolding.
- Handover is blocked until information is complete and both parties confirm. Ownership must never move optimistically.
- AI handles ambiguous interpretation and produces validated drafts. Deterministic code owns authorization, state transitions, reminders, care escalation, deletion, audit, and report rendering.
- Care rules require human activation. Care escalation must not depend on an LLM.
- Reports use deterministic human-authored templates and variable substitution only. They describe responsibility distribution neutrally and must not score, rank, diagnose, or blame family members.

## Fleet-kit deployment

- The current isolated installation worktree is `C:\Users\DW\orca\workspaces\gethe-point\we-remember-fleet-kit` on branch `songconmaisaix31-design/we-remember-fleet-kit`, based on `origin/main` at `70ca3dce63e137902274c14c101e69e47a84f1cb`.
- Source archive: `C:\Users\DW\Downloads\we-remember-orca-fleet-kit-worktree-enforced.zip`, SHA-256 `E6E7E3CCC05D00245414D72E7B8E0A100B4497C64B3D4316154F9C8EDA73B1EC`.
- Keep hook installation opt-in: `scripts/install_hooks.py` changes repository-level `core.hooksPath`, which is shared by all worktrees.
- Treat commands configured under track `checks` as trusted repository code because the runner uses a shell.
- Safe preflight commands are unit tests, Python compilation, plan validation, and `fleet.py doctor`. Do not launch real runs or workers without a concrete reviewed objective and an approved shared base.
- The control plan must preserve the distinction between four product Agent boundaries and per-Attempt Git worktrees.
- The initial adapted plan was deliberately non-launchable. After the reviewed control commit `c2d8751` was published to `origin/songconmaisaix31-design/we-remember-fleet-kit`, the user explicitly authorized execution on 2026-08-27. The active plan uses that remote branch as its shared base and must still dispatch `DATA-001` alone before any later task.
- The executable DAG has 7 Waves and 19 Tasks. `DATA-001` is the first product implementation task and must apply the complete migration to disposable PostgreSQL before `FOUND-001` creates application scaffolding.
- Orca on this host prefixes Git branches with the GitHub owner. Branch identity accepts exactly one optional owner segment while retaining the unprefixed Orca workspace name as a separate immutable field.
- `orca.yaml` performs plan validation only. `scripts/install_hooks.py` remains opt-in because `core.hooksPath` is shared by all worktrees.
- Pre-execution validation on 2026-08-27 passed 26 unit/integration tests, syntax compilation for 9 Python files, current-plan validation, and live Fleet doctor against Orca 1.4.188. At that checkpoint no Run, Task, Dispatch, Coordinator, Worker, or remote branch existed; subsequent execution evidence belongs under `.agents/runs/**`.
- On Windows, do not use an extensionless fake `orca` executable in tests: command resolution can fall through to the installed `orca.exe`. Mock only the send boundary in-process while retaining real temporary Git operations.
- `PACKAGE_MANIFEST.json` is provenance for the untouched source archive, not a hash manifest for the customized installed tree.
- Run `run_262bccf7adb3` exhausted `DATA-001` Attempts 1-3: `orchestration worker-start` returned `selector_not_found` before any Dispatch, worktree, or branch even though read-only repo and coordinator-worktree selectors resolved. No product work began. Do not reuse or manually dispatch the three residual `ready` Task records: `task_6a6c81796edb`, `task_901149216cb7`, and `task_45f46286189c`.

## Secret handling

- Do not read or record secret values. Record only the name and approved configuration location of any future secret.
