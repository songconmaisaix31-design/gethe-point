# Test Report

Generated: 2026-08-27

## gethe-point local deployment verification

Verified: 2026-08-27

- Parsed the active Fleet config and 19-task overall plan and compiled all 9 Python files.
- Passed 23 unit/integration tests, including fail-closed launch authorization, exact current/legacy Dispatch receipt parsing and worker completion validation, rejection of the `dispatch_input` effect name, non-overlapping track ownership, active-base consistency, required root `.gitignore` ownership, Windows-safe subprocess decoding, branch recognition, active/example plan validation, and integration merge gates.
- Proved that both a draft plan and an approved-but-unauthorized plan are rejected before repository selection, fetch, or any Orca call.
- Validated `.agents/plans/current.json` with `ok: true` and no errors.
- Passed `fleet.py doctor` against the live local Orca runtime with all 14 tracks recognized and no plan errors.
- Confirmed local and global `core.hooksPath` remain unset.
- This section is control-plane preflight evidence only; Run, Task, Dispatch, Worker, product, browser, database, deployment, and official-acceptance evidence must be recorded separately when produced.

## Upstream archive baseline

The following results describe the source archive before the project-specific changes above.

### Passed

- Python syntax compilation for all automation scripts and tests.
- 8 unit/integration tests:
  - directory glob matching;
  - ownership containment and overlap detection;
  - example Wave plan validation;
  - concurrent write-overlap rejection;
  - clean two-parent no-ff integration merges accepted;
  - direct integration edits to Worker-owned paths rejected;
  - manually edited/conflicting merge trees rejected.
- Clean temporary Git repository smoke test:
  - example plan validated;
  - coordinator dry-run created a Run state;
  - only the dependency-free foundation Wave was dispatched;
  - dependent Waves remained planned.
- Normal Worker end-to-end test with a fake Orca transport:
  - task context initialized;
  - allowed Web path passed;
  - API path modification was rejected;
  - commit + push/upstream verification passed;
  - `worker_done` was emitted once;
  - duplicate completion for the same Dispatch was rejected.
- Integration Worker end-to-end test with a fake Orca transport:
  - exact dependency SHAs were merged with clean no-ff commits;
  - merge trees were recomputed and matched;
  - integration-owned README change passed;
  - first-parent commit IDs were checked;
  - pushed integration branch emitted `worker_done` successfully.

### Environment limitation

The build container does not include a running Orca desktop/runtime, so live Orca Run/Task/Dispatch creation was not executed here. The repository-side state machine, Git gates, completion checks, fake transport, and dry-run command generation were tested. On the target machine, run `python scripts/fleet.py doctor` before the first real Run; it verifies the Orca runtime, orchestration skill, CLI access, and required Git merge-tree support.
