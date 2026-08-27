# CONV-REPAIR-001 Conversation Safety Specification

## Outcome

Provide private `agent_dm` messaging and explicitly consented shared signals while
ensuring that authorization, high-risk routing, provider output, and confirmation
state all fail closed.

## Security invariants

1. A provider is called only after the actor, active space, persisted role, active
   membership, analysis consent, private conversation, source message, evidence
   ownership, evidence availability, and source linkage are authorized.
2. Self-harm, domestic-violence, and acute-medical content is classified by
   deterministic application code. It bypasses the provider and produces only a
   private, non-diagnostic guidance draft.
3. Provider output is limited to enums and bounded numbers. Human-authored
   application templates produce every text field that can reach a draft or shared
   signal.
4. Every provider-derived field and rendered template is checked against every
   private input after Unicode, case, whitespace, and punctuation normalization.
   Exact, contained, and one-edit variants fail closed.
5. A private-message write creates no draft, consent, shared signal, ordinary task,
   report fact, or cross-member query visibility.
6. Raw evidence and private conversation reads are self-only and return the same
   non-enumerating denial for missing, cross-space, and wrong-owner identifiers.
7. Source versions are captured before provider execution and revalidated in the
   draft-write transaction. Any source, consent, visibility, or actor drift prevents
   persistence.
8. `ConfirmSignal` revalidates the actor, draft version, source snapshot, current
   evidence, active per-draft consent, expiry, speaker, and visibility in one
   transaction before the single shared write.
9. Provider failures, timeouts, and invalid outputs receive at most two attempts and
   return `needs_human_review` without a draft or shared mutation.
10. Errors and telemetry contain stable codes, identifiers, counts, durations, and
    bounded outcomes only. They never include private or provider content.

## Implementation boundaries

- `modules/boundary` owns deterministic risk classification, provider-input
  redaction, disclosure comparison, safe errors, and content-free telemetry.
- `modules/ai-witness` owns the bounded provider schema, deterministic templates,
  two-attempt execution policy, fixture provider, and OpenAI-compatible adapter.
- `modules/conversation` owns command/query authorization, transactional source
  snapshots, per-signal consent, idempotent confirmation, and a reference in-memory
  store.
- Frozen contracts under `packages/contracts` remain the public operation and entity
  source of truth. This track does not modify database or contract ownership.

## Verification plan

- Unit-test all three frozen high-risk categories with zero provider calls.
- Test every pre-provider denial category and assert provider call count stays zero.
- Test exact and near-verbatim variants across every publishable derived text field.
- Mutate consent, evidence, actor, space, message, and versions during provider work
  and assert zero draft/shared writes.
- Test self-only private conversation and raw-evidence queries with guessed IDs.
- Test timeout, thrown failure, invalid response envelopes, and two invalid outputs.
- Run `pnpm run check:conversation`, the repository scope gate, the forbidden-ancestor
  gate, and `git diff --check` from the final commit.
