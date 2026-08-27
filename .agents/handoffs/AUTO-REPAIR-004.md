# AUTO-REPAIR-004 Handoff

## Objective

Reproduce the independently accepted AUTO-REPAIR-003 file tree on a fresh Attempt with correct immutable Git and Orca provenance. Do not change the accepted implementation or the active Run.

## Frozen identities

- Base SHA: `782f754bfae6c8e7981da4b37e349c40c33d9e41`
- Accepted-content source SHA: `7c44e2b53cf8c155d4b0d227aaa77db682ae24d5`
- Accepted-content tree SHA: `8f7ea366d611da2b87898b6491afa23cb3393281`
- Rejected Dispatch: `ctx_dd2c7d1866d4`
- Rejection reason: the pushed source commit used `[AUTO-REPAIR-003-V2]` instead of the exact Orca logical Task ID `[AUTO-REPAIR-003]`; pushed history is immutable and must not be amended, rebased, force-pushed, or treated as accepted provenance.

Preserve AUTO-REPAIR-001, AUTO-REPAIR-002, and AUTO-REPAIR-003 branches, commits, transcripts, tests, and rejection evidence unchanged.

## Exact ownership

- `scripts/fleet.py`
- `scripts/tests/test_amendment.py`
- `MEMORY.md`

Do not modify `.agents/runs/**`, `.agents/plans/**`, other automation files, product code, fixtures, deployment files, or existing evidence.

## Required execution

1. Start from the exact base SHA in a fresh top-level worktree and branch. Initialize the automation gate for logical Task `AUTO-REPAIR-004` before any file edit.
2. Fetch `trk-automation-auto-repair-003-v2` and prove its remote head is the exact accepted-content source SHA. Prove the source is a direct child of the frozen base.
3. Materialize only the three owned files from the exact source SHA without preserving its rejected commit metadata. A clean-worktree `git restore --source <source-sha> --staged --worktree -- <three-owned-files>` is authorized for this exact reproduction.
4. Before commit, prove the entire index/worktree tree equals the accepted-content tree SHA and the diff from the frozen base contains only the three owned paths. Do not make semantic, formatting, dependency, or documentation changes.
5. Run every required gate. The cross-`PYTHONHASHSEED` two-process journal crash/replay test must execute, not merely be present.
6. Create exactly one new commit with subject `fix(fleet): reproduce accepted amendment recovery [AUTO-REPAIR-004]`, push without history rewrite, and prove the commit has the frozen base as its only parent, its tree equals the accepted-content tree SHA, the worktree is clean, and `HEAD == upstream == remote`.
7. Run `worker_finish.py --verify-only` with logical Task `AUTO-REPAIR-004`, the injected Orca Task and Dispatch IDs, and the frozen base. Then send exactly one supervised `worker_done` using the injected non-exported capability.

## Required checks

- `python -B -m unittest discover -s scripts/tests -v`
- `python -B -m compileall -q scripts`
- `python -B scripts/fleet.py validate .agents/plans/current.json --json`
- `python -B scripts/fleet.py doctor --json`
- `git diff --check`

## Acceptance

- Remote source SHA and tree match the frozen identities before reproduction.
- The pre-commit index/worktree and final commit tree equal `8f7ea366d611da2b87898b6491afa23cb3393281` exactly.
- The final commit is a single direct child of the frozen base and contains `[AUTO-REPAIR-004]` in its subject.
- All 96 tests and every required check pass, including the real two-process cross-hash-seed crash/replay regression.
- Scope contains exactly the three owned paths; no untracked file remains.
- The active Run state hash remains `c8d7e5033110632f5f327c2c342506e503276592c87521479fb9a73313b3bb50`, with no amendment or resolution added.
- Branch is clean, pushed, and its upstream and remote SHA equal HEAD.

## Evidence boundary

Passing AUTO-REPAIR-004 proves only that the accepted control-plane content has valid immutable provenance. It does not amend the active Run, accept a product replacement, start product repair workers, or prove a release candidate.
