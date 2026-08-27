# AUTO-REPAIR-003 Handoff

## Objective

Replace rejected automation Attempt `AUTO-REPAIR-002` with the smallest fail-closed repair for amendment journal uniqueness and applied-contract validation. The active Run must remain unchanged until this Attempt passes independent acceptance.

## Frozen base and evidence

- Base SHA: `782f754bfae6c8e7981da4b37e349c40c33d9e41`
- Rejected Dispatch: `ctx_f122daeef5d3`
- Preserve AUTO-REPAIR-001 and AUTO-REPAIR-002 branches, commits, transcripts, journals used by tests, and acceptance outcomes unchanged.

## Exact ownership

- `scripts/fleet.py`
- `scripts/common.py`
- `scripts/tests/**`
- `.agents/fleet.json`
- `.agents/prompts/coordinator.md`
- `MEMORY.md`

Do not modify `.agents/runs/**`, `.agents/plans/**`, product code, fixtures, deployment files, or existing acceptance evidence. Do not apply an amendment to the active Run.

## Required implementation

1. Claim one immutable artifact identity per `amendment_id` before any new journal, receipt, state, STATUS, or Orca mutation. A journal or receipt for the same ID but another source hash must fail closed instead of creating a second hash-derived path.
2. Detect duplicate, orphaned, malformed, or conflicting journal and receipt artifacts for the same amendment ID. Keep filename matching bounded to the validated ID and exact Fleet amendment artifact schema; unrelated evidence must not be consumed.
3. Preserve deterministic replay of the one valid journal after a crash. Changing any source field, including description, after journal publication must not create or apply another transaction under the same ID.
4. Before returning `already_applied`, verify every journal-owned immutable contract field in the current state, not only wave/task identity. This includes appended wave structure, appended task contract fields, every explicit existing-wave patch, and every explicit existing-task patch.
5. Treat a later valid append-only amendment as the only allowed explanation for a journal-owned contract field changing. Validate the ordered later amendment records and their immutable journals before overlaying their explicit contract patches; lifecycle fields may continue to evolve normally.
6. Fail closed on an unexplained or forged state contract change, a missing/corrupt/conflicting later journal, or an amendment record that does not match its journal. Never repair primary state from derived evidence and never report `already_applied` in these cases.
7. Preserve every accepted AUTO-REPAIR-002 property: one byte snapshot for parse/hash, bounded shared Run lock, journal-first recovery, no duplicate Orca mutations, transitive downstream enforcement, strict resolution relations, unique acceptance evidence, and immutable failed Attempts.
8. Update coordinator guidance or `MEMORY.md` only if a new durable non-secret rule is necessary; do not duplicate the rules already recorded.

## Acceptance

- Publish a journal and inject a failure before state replacement; changing the same amendment ID's description or any other source content then fails before a second journal, receipt, state, STATUS, or Orca mutation.
- Duplicate or cross-hash journals and receipts for one amendment ID fail closed; the evidence directory still contains exactly the original immutable artifact.
- After application, changing an appended task contract, an updated task contract, or an updated wave contract causes replay to fail without `already_applied`.
- A later valid amendment may explicitly update an earlier journal-owned field, and replay of the earlier amendment succeeds only after both ordered records and journals validate and the current field equals the latest explicit value.
- Missing, corrupt, reordered, or mismatched later amendment records/journals cannot excuse a changed contract.
- All prior concurrency, crash-boundary, CAS, authorization, downstream, resolution, acceptance, finalization, launch recovery, and integration tests remain green.
- `python -B -m unittest discover -s scripts/tests -v`, `python -B -m compileall -q scripts`, `python -B scripts/fleet.py validate .agents/plans/current.json --json`, `python -B scripts/fleet.py doctor --json`, and `git diff --check` pass.
- The branch is clean, pushed, and its upstream SHA equals HEAD.

## Evidence boundary

Passing this task proves only the replacement control-plane mechanism. It does not amend the active Run, accept a product replacement, start product repair workers, or prove a release candidate.
