# Test Report

Generated: 2026-08-22

## gethe-point local deployment verification

Verified: 2026-08-26

- Parsed both fleet JSON files and compiled all 7 Python files in memory.
- Passed 11 unit/integration tests, including Windows-safe subprocess decoding and Orca username-prefixed branch recognition.
- Validated the project-specific example plan with `ok: true` and no errors.
- Passed `fleet.py doctor` against the live local Orca runtime with all 11 tracks recognized.
- Confirmed local and global `core.hooksPath` remain unset.
- Did not launch a coordinator, run, task, dispatch, or worker, and did not push remote state.

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
