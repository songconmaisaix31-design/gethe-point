# AUTO-REPAIR-005 Handoff

## Objective

Resolve amendment replacement chains to their final accepted task so a failed replacement can itself be superseded without leaving the original source permanently unresolved.

## Incident evidence

- Active Run: `run_a6e82cb7623f`
- Accepted setup merge: `0a85a0ce6f84dcaa178bb4c70780f7e369fd2451`; the worker base must contain this commit.
- Existing immutable chain prefix: `CONTRACT-001 corrected_by CONTRACT-CORR-001`
- `CONTRACT-CORR-001` is failed and must be replaced by a fresh `CONTRACT-CORR-002` Attempt.
- The current `resolution_view()` inspects only the direct replacement. Even after `CONTRACT-CORR-002` succeeds, it would keep `CONTRACT-001` unresolved because `CONTRACT-CORR-001` has no accepted SHA.
- User impact: every product repair could succeed while the final release manifest still fails permanently.

Do not edit, apply, accept, reject, advance, or settle the active product Run. This task repairs only the control-plane resolution reader.

## Exact ownership

- `scripts/fleet.py`
- `scripts/tests/test_amendment.py`

Do not modify configuration, prompts, plans, Run state or evidence, product code, dependencies, lockfiles, or `MEMORY.md`.

## Required behavior

1. Preserve the exact output and behavior of every valid one-hop resolution.
2. Follow `corrected_by` and `superseded_by` edges iteratively with a visited set until the terminal referenced task has no later resolution.
3. Preserve the first source edge's `relation` and `amendment_id`; expose the terminal task and terminal SHA as `replacement_task` and `replacement_sha`.
4. Accept only a terminal task whose status is `completed` and whose `head_sha` is exactly 40 hexadecimal characters.
5. Fail closed, deterministically and without recursion errors, for:
   - a missing referenced task;
   - a non-object or ambiguous edge;
   - an empty or non-string target;
   - a relationship incompatible with the source lifecycle (`corrected_by` requires completed, `superseded_by` requires failed);
   - a planned, dispatched, pending, or failed terminal;
   - a missing, short, long, or non-hex terminal SHA;
   - self-cycles and multi-task cycles;
   - malformed top-level `tasks` or `resolutions` mappings.
6. Do not change amendment or journal schemas and do not add a resolution-chain output field.
7. Keep status Markdown and release-manifest behavior compatible for one-hop resolutions. Multi-hop status and manifests must use the accepted terminal task and SHA.

## Required regression coverage

- Exact one-hop compatibility.
- `completed -> failed -> completed + 40-hex SHA` resolves both sources to the terminal task.
- The failed intermediate task has effective status `resolved_failure`; the original completed task remains completed.
- Pending, failed, missing, malformed, invalid-SHA, self-cycle, and multi-node-cycle chains remain unresolved and fail closed.
- STATUS Markdown renders the terminal replacement without crashing.
- Finalization rejects every unresolved chain even with incomplete overrides and writes no manifest.
- A successful manifest contains no unresolved resolutions and records the terminal replacement SHA.

## Required checks

- `python -B -m py_compile scripts/fleet.py scripts/tests/test_amendment.py`
- `python -B -m unittest discover -s scripts/tests -p "test_amendment.py" -v`
- `python -B -m unittest discover -s scripts/tests -v`
- `python -B scripts/fleet.py validate .agents/plans/current.json --json`
- `python -B scripts/fleet.py doctor --json`
- `git diff --check`

## Commit and provenance

- Start from the exact latest control SHA supplied by the coordinator in a fresh top-level worktree with setup explicitly skipped; prove that `0a85a0ce6f84dcaa178bb4c70780f7e369fd2451` is an ancestor.
- Create one commit with subject `fix(fleet): resolve chained amendment replacements [AUTO-REPAIR-005]`.
- Push without history rewrite and prove `HEAD == upstream == remote` with a clean worktree.
- Run `worker_finish.py --verify-only`, then send exactly one supervised `worker_done` for the injected Task and Dispatch.

## Acceptance boundary

Acceptance proves only chain-aware control-plane resolution. It does not create or apply the second product amendment and does not accept any failed product Attempt.
