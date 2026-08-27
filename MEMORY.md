# Project Memory

## Project identity

- Product: `gethe-point` / 都记得 (We Remember).
- Repository: `https://github.com/songconmaisaix31-design/gethe-point`.
- Default branch: `main`.
- The repository was documentation-only when the fleet kit was introduced on 2026-08-26.

## Durable product decisions

- The product transfers ownership of complete family responsibility domains; it is not a flat household task list.
- `agent_dm` content is private by default. Shared-family writes require explicit speaker consent and must enforce the selected visibility scope.
- `Task.discoveredBy`, `deadlineKeptBy`, `scheduledBy`, `executedBy`, and `followedUpBy` are first-class persisted fields.
- Handover is blocked until information is complete and both parties confirm. Ownership must never move optimistically.
- AI handles ambiguous interpretation and produces validated drafts. Deterministic code owns authorization, state transitions, reminders, care escalation, deletion, and audit.
- Care rules require human activation. Care escalation must not depend on an LLM.
- Reports describe responsibility distribution neutrally; they must not score, rank, diagnose, or blame family members.

## Fleet-kit deployment

- The initial local deployment worktree is `C:\Users\DW\orca\workspaces\gethe-point\fleet-kit-setup` on branch `songconmaisaix31-design/fleet-kit-setup`, based on `origin/main` at `70ca3dce63e137902274c14c101e69e47a84f1cb`.
- Source archive: `C:\Users\DW\Downloads\orca-directory-fleet-kit.zip`, SHA-256 `FAC74080BF7517527743BE7ED3CB0EA9CB8A71039EF83B0E952BF8000B42678E`.
- Keep hook installation opt-in: `scripts/install_hooks.py` changes repository-level `core.hooksPath`, which is shared by all worktrees.
- Treat commands configured under track `checks` as trusted repository code because the runner uses a shell.
- Safe preflight commands are unit tests, Python compilation, plan validation, and `fleet.py doctor`. Do not launch real runs or workers without a concrete reviewed objective.
- Local verification on 2026-08-26 passed Python compilation, 11 unit/integration tests, plan validation, and live `fleet.py doctor`; both local and global `core.hooksPath` remained unset.
- Orca creates GitHub-owned branches with a username prefix on this machine. Branch rules therefore accept both `trk-*` / `fleet-control-*` and a single optional `<owner>/` prefix.
- The bootstrap may be committed locally for a clean review boundary, but it is not a runnable shared fleet baseline until the control plane is available from the configured base ref.
- On 2026-08-27, the requested `orca-directory-fleet-kit.zip` was revalidated at SHA-256 `FAC74080BF7517527743BE7ED3CB0EA9CB8A71039EF83B0E952BF8000B42678E` in `fleet-control-mvp-planning-v2`; 11 tests, seven Python syntax checks, plan validation, and live doctor passed, with shared hooks still unset.
- A separate remote control plane at `origin/songconmaisaix31-design/we-remember-fleet-kit` comes from a different archive and recorded a Run that failed before Worker dispatch. Do not merge its authorization or evidence into the requested-archive planning lineage without an explicit control-plane selection decision.
- Before the 2026-08-27 hardening, the requested kit did not read `plan_status` or `launch_authorized`; the unresolved base ref was then its only machine-enforced launch block.
- On 2026-08-27, `scripts/fleet.py` was hardened to reject any plan unless `plan_status` is `approved` and `launch_authorized` is exactly `true`, before fetch, Orca mutation, or run-directory creation. Targeted regression tests prove both fail-closed paths.
- The selected requested-archive control lineage is `origin/songconmaisaix31-design/we-remember-requested-fleet-v2`; the alternate `we-remember-fleet-kit` branch and its failed Runs remain read-only historical input.
- The approved implementation order is `FOUND-001 -> CONTRACT-001 -> DATA-001 -> seven parallel core tasks -> INT-001 -> seven parallel hardening tasks -> INT-002`. Serializing contracts before migrations prevents unresolved responsibility and privacy semantics from being persisted.
- The implementation uses a single root `pnpm` dependency manifest and lockfile owned only by the `foundation` track. Feature tracks use locked dependencies and non-overlapping paths; new dependencies require a separate foundation task.
- Fixture mode is the acceptance baseline. Demo role switching is not production authentication, raw `agent_dm` evidence remains self-only, consent is per signal, handover acceptance is terminal and atomic, care execution is deterministic, and space deletion removes all in-space product and audit content.
- Orca 1.4.188 returns supervised Dispatch IDs as `ctx_*` in `result.dispatchId` and also returns an effect named `dispatch_input`. Fleet must read the exact key and validate the ID shape; generic `dispatch_` prefix scanning can corrupt state by selecting the effect name.
- The first `FOUND-001` attempt in `run_5644dc3389a9` exposed that a root `.gitignore` is a required foundation artifact: a frozen pnpm install creates `node_modules/` and checks create build/test artifacts. The shared control base now carries reproducible Node, Python, coverage, and build-output rules; keep `.gitignore` in the foundation allowlist and task scope and never rely on local Git exclude to fake a clean checkout.
- Preserve failed Worker worktrees as evidence and use an explicit validated `workspace_suffix` for retries. The second approved attempt uses suffix `v2`, producing names such as `trk-foundation-found-001-v2` without rewriting historical Orca state.
- Current supervised Orca completion requires Dispatch-preamble sender context and a capability that must never be copied into repository automation. Workers run `worker_finish.py --verify-only` to produce a non-secret verified payload, then use the exact injected preamble command once to send `worker_done`.
- Worker resource cleanup is operational bookkeeping, not product acceptance. Record `release_unknown` or other cleanup failures in acceptance evidence while preserving the independently verified task outcome and Run state.
- In `run_a6e82cb7623f`, `FOUND-001` was accepted at remote SHA `bede795a127ef5baa48fc4bd01752c2f3c408c65`. The locked Node 24 / pnpm 11 harness, strict checks, native Sharp and Drizzle smoke tests, and full dependency audit passed; the execution policy prevented physical removal of `node_modules`, so clean-install evidence used both forced and ordinary frozen reinstalls without weakening the clean-HEAD gate.
- Persist an Orca Task ID immediately after `task-create` and before `worker-start`. If launch fails, recover the ID from the task-create evidence receipt and reuse it; otherwise a retry can create duplicate logical work while the external Orca Task remains ready.
- Canonicalize portable `path:` repo selectors to Orca's runtime repository ID for Worker placement, and pass the resolved immutable base SHA as `worker-start --base-branch`. Repository defaults and symbolic refs alone can still fail with `selector_not_found` even when read-only discovery succeeds.
- After coordinator recovery increments the Run generation, every `worker-start` must carry the explicit current `--run` and coordinator `--from` handle. Query `dispatch-show` first and adopt an existing active Dispatch so a lost or manually recovered launch receipt cannot start duplicate work.
- A wave is `dispatched` only when every task is `dispatched` or `completed`. A partially launched wave must remain `planned` so `advance` can resume it after a Worker failure.
- A failed Worker launch must not block its independent siblings. Persist the failed Dispatch receipt and Task ID, continue the rest of the parallel wave, then recover the failed task only after querying its exact Dispatch, terminal, setup, and worktree state.
- `agent_prompt_stalled` can be caused by Codex startup prompts, MCP startup latency, or a long-lived TUI transcript rather than repository code. Clear only an idle unsent composer, reuse the exact task and worktree, and use `--retry-of`; never replay a mutation after `runtime_unavailable` before querying state.
- In `run_a6e82cb7623f`, the seven core tracks were launched from DATA SHA `b5ce8994ddc233ec086c1e9059b8c921e63e1cf7`. CARE required `task-update --status ready` plus `dispatch --inject` after repeated supervised startup stalls; its active Dispatch is live but appears as `unsupervised` in `worker-read`, so preserve that limitation in acceptance evidence and do not describe it as a normal supervised Worker launch.

## Secret handling

- Do not read or record secret values. Record only the name and approved configuration location of any future secret.
