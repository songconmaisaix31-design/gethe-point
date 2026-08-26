# Repository Agent Constitution

This repository uses an Orca CLI-managed directory-ownership model for multi-agent development.

## Highest-priority rules

1. Features define acceptance; directories define write authority.
2. Modify only the `write_paths` explicitly assigned to the current task. Read access does not imply write ownership.
3. The current session is bound to one worktree, branch, and track. All tracks must not use `git switch`, `git checkout`, `git rebase`, `git reset --hard`, or `git push --force`. Only the integration track may perform reviewed `git merge --no-ff` operations under its dedicated prompt.
4. Escalate cross-track changes to the coordinator. Do not directly edit another track's files.
5. Do not modify shared contracts, root dependencies, lockfiles, deployment configuration, or CI unless the current track explicitly owns those paths.
6. Do not format the entire repository. Format only files in the assigned scope.
7. Commit and push each verifiable increment. Never rewrite pushed history.
8. Completion requires all of the following: scope gate passed, required checks passed, clean worktree, branch pushed, `HEAD` equal to upstream, and exactly one `worker_done` receipt.

These completion requirements apply after the fleet control plane is present in the shared base. A user-requested local-only bootstrap may be committed locally without push, but no coordinator or worker may start from it until the control plane is available from the selected base ref.

## Standard loop

```text
Preflight
-> initialize task context
-> implement only within allowed directories
-> run track checks
-> run scope gate
-> commit
-> push
-> worker_finish.py
```

## Blocking and escalation

Do not guess or make an out-of-scope repair. Send an Orca Orchestration `question` or `escalation` containing the logical task ID, Dispatch ID, blocker, owning track, requested change, and whether the current delivery is blocked.

## Repository-specific product boundaries

- Treat consent, visibility, authorization, deletion, and high-risk content handling as security boundaries.
- Private `agent_dm` content must not enter shared family data without the speaker's explicit consent.
- AI may draft interpretations; deterministic code controls authorization, state transitions, reminders, escalation, deletion, and audit.
- Missing information or confirmation must remain blocked. Never infer success for a consequential transition.
- Never store secrets in source, documentation, logs, fixtures, or `MEMORY.md`.
