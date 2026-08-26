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

## Secret handling

- Do not read or record secret values. Record only the name and approved configuration location of any future secret.
