# AUTO-SETUP-001 Handoff

## Objective

Prevent Orca's agent-first worker setup from mutating tracked workspace files after a worker has already passed preflight. Future directory-owner workers must start from a byte-clean frozen base and bootstrap JavaScript dependencies without changing `pnpm-lock.yaml`.

## Incident evidence

- Active Run: `run_a6e82cb7623f`
- Affected Dispatch: `ctx_0efe18da2039` (`CONTRACT-CORR-001`)
- Frozen base: `b5ce8994ddc233ec086c1e9059b8c921e63e1cf7`
- Orca repository policy: setup runs by default with `start-immediately` agent startup.
- Observed setup drift: four lines were added to the unowned root `pnpm-lock.yaml`, creating empty `packages/contracts` and `packages/db` importers after the worker started.
- User impact: a product worker can pass preflight on a clean base and later fail scope or accidentally commit a lockfile it does not own.

Do not modify, accept, reject, stop, release, or otherwise settle the active product Dispatch. This task repairs only the future worker bootstrap policy.

## Exact ownership

- `.agents/fleet.json`
- `.agents/prompts/worker.md`
- `scripts/tests/test_fleet.py`
- `MEMORY.md`

Do not modify product code, plans, active Run state/evidence, dependency manifests, lockfiles, setup hooks, or any other prompt.

## Required implementation

1. Change only `worker_defaults.setup` from `run` to `skip`. Leave coordinator setup and explicit per-task setup overrides unchanged.
2. Add a concise worker-prompt rule for JavaScript dependency bootstrap:
   - run the injected gate initialization and clean preflight first;
   - only when required JavaScript tools are unavailable, run `pnpm install --no-lockfile --offline --ignore-scripts`;
   - rerun `python scripts/gate.py check --preflight` before editing;
   - if bootstrap changes any tracked file, stop and escalate; never restore, stage, or commit an unowned file.
3. Add a focused regression proving repository worker dispatch uses `--setup skip` from the checked-in configuration while an explicit task-level setup value still takes precedence.
4. Record the durable setup-race rule in `MEMORY.md` without storing any capability or secret.
5. Do not add a helper, dependency, configuration switch, or abstraction unless the focused test demonstrates it is required.

## Required checks

- `python -B -m unittest discover -s scripts/tests -v`
- `python -B -m compileall -q scripts`
- `python -B scripts/fleet.py validate .agents/plans/current.json --json`
- `python -B scripts/fleet.py doctor --json`
- `git diff --check`

## Commit and provenance

- Start from the exact control SHA supplied by the coordinator in a fresh top-level worktree.
- Create one commit with subject `fix(fleet): make worker bootstrap lock-preserving [AUTO-SETUP-001]`.
- Push without history rewrite and prove `HEAD == upstream == remote` with a clean worktree.
- Run `worker_finish.py --verify-only`, then send exactly one supervised `worker_done` for the injected Task and Dispatch.

## Acceptance boundary

Acceptance proves only that future Fleet launches default to a lock-preserving bootstrap. It does not repair or accept the already-dispatched `CONTRACT-CORR-001` Attempt and does not authorize any active Run state edit.
