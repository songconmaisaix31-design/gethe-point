# Fleet Kit Deployment Specification

Status: Local installation and preflight
Date: 2026-08-26

## Objective

Install the Orca Directory Fleet Kit into an isolated `gethe-point` worktree so future agents can operate under explicit directory ownership, frozen baselines, machine-enforced scope gates, and auditable integration evidence.

The installation must not change the remote repository, launch a live multi-agent run, or alter the repository-wide Git hooks configuration.

## Baseline and provenance

- Repository: `https://github.com/songconmaisaix31-design/gethe-point`
- Base ref: `origin/main`
- Installation base SHA: `70ca3dce63e137902274c14c101e69e47a84f1cb`
- Local worktree: `C:\Users\DW\orca\workspaces\gethe-point\fleet-kit-setup`
- Local branch: `songconmaisaix31-design/fleet-kit-setup`
- Source archive SHA-256: `FAC74080BF7517527743BE7ED3CB0EA9CB8A71039EF83B0E952BF8000B42678E`

## Constraints

- Preserve the clean `main` checkout and all unrelated Orca worktrees.
- Do not push, open a pull request, or mutate any other remote state.
- Keep `scripts/install_hooks.py` available but opt-in. The default setup hook must not modify shared `core.hooksPath`.
- Do not launch `start-coordinator`, `launch`, or real worker commands without a separately reviewed objective and plan.
- Do not read or store credentials. Future secrets must be supplied through approved environment or platform secret configuration.
- Track checks are trusted repository commands because the runner invokes them through a shell.

## Initial directory ownership contract

The repository currently contains product documentation only. These paths establish a minimal, stack-neutral implementation boundary without adding application code:

| Track | Owned paths | Product responsibility |
| --- | --- | --- |
| `control` | `.agents/plans/**`, `.agents/runs/**`, `.agents/decisions/**`, `.agents/handoffs/**` | Plans, run state, decisions, and handoffs |
| `product` | `产品需求文档_都记得_PRD.md`, `docs/product/**` | Product scope and user-facing requirements |
| `architecture` | `contracts/**`, `schemas/**`, `docs/architecture/**`, `Tech-Spec.md`, `API_CONTRACT.md`, `FLEET_DEPLOYMENT_SPEC.md` | Shared contracts, schemas, and architecture decisions |
| `ai` | `services/ai/**` | Witness, responsibility-domain, handover, and boundary-agent implementations |
| `domain` | `services/domain/**` | Responsibility, task, consent, handover, audit, and deterministic domain rules |
| `care` | `services/care/**` | Human-confirmed care rules and deterministic escalation state machine |
| `api` | `services/api/**` | External API and application-service boundary |
| `web` | `apps/web/**`, `packages/ui/**` | Role-specific web experiences and accessible UI |
| `qa` | `tests/e2e/**`, `fixtures/**` | Representative fixtures and end-to-end acceptance |
| `integration` | `apps/demo-shell/**`, `deploy/**`, selected root build files | Assembly, release, and deployment |
| `automation` | Fleet scripts, prompts, CI, and governance files | Fleet control-plane maintenance |

Any implementation that needs a different physical layout must update this contract before workers are dispatched. Parallel tasks must never receive overlapping write paths.

## Acceptance criteria

1. Orca recognizes `gethe-point` and the independent top-level worktree based on `origin/main`.
2. `AGENTS.md` and `MEMORY.md` exist before other project files are changed.
3. The kit files are installed without overwriting the existing PRD or `LICENSE`.
4. `.agents/fleet.json` identifies `gethe-point`, uses `origin/main`, and binds to the explicit local repository selector.
5. The example plan reflects the product's contract-first, consent-first, deterministic-care architecture and passes validation.
6. All Python files compile and all unit/integration tests pass.
7. `fleet.py doctor` succeeds against the live local Orca runtime.
8. `core.hooksPath` remains unset after validation.
9. No live Orca run, coordinator, worker, remote branch, push, or pull request is created. One reviewed local bootstrap commit is allowed.

## Verification commands

```powershell
python -B -m compileall -q scripts
python -B -m unittest discover -s scripts/tests -v
python -B scripts/fleet.py validate .agents/plans/example.json --json
python -B scripts/fleet.py doctor --plan .agents/plans/example.json --json
git diff --check
git status --short --branch
git config --local --get core.hooksPath
```

## Known risks

- A real fleet launch creates Orca runs, tasks, branches, worktrees, and agent sessions. Validation and doctor checks do not prove a live run.
- Shell-based track checks are an execution boundary. Review every configured command before use.
- The initial directory contract is intentionally stack-neutral. It must be revised when the implementation stack and package layout are frozen.
- Local Orca repository selectors are machine-specific and must be changed if the checkout moves.
