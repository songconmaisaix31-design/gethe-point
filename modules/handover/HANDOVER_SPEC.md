# HAND-001 Handover Implementation Specification

Status: Implementation scope for `HAND-001`

## Outcome

Provide a deterministic two-party handover workflow in which incomplete
operational information stays blocked, the source and recipient confirm
independently, and ownership moves only after one atomic persistence operation
succeeds.

## Scope

- `ProposeHandover`, `SupplyHandoverInfo`, `ConfirmHandoverFrom`,
  `ConfirmHandoverTo`, `DeclineHandover`, `ExpireHandover`, and
  `AcceptHandover` application handlers.
- An idempotent compare-and-set state port for proposal and non-acceptance
  mutations.
- One atomic acceptance port backed by the DATA-001 actor-bound transaction.
- Optional schema-validated AI question drafting for unresolved information.

The module does not add HTTP routes, UI state, schema migrations, dependencies,
or autonomous AI mutations.

## Acceptance rules

1. A proposal with any `missingInfo` is persisted as `blocked`.
2. Supplying only part of the missing information remains `blocked`; confirmation
   handlers reject every blocked record without writing a confirmation.
3. Source and recipient confirmations are separate mutations. Neither mutation
   invokes acceptance or changes ownership.
4. `accepted`, `declined`, and `expired` are terminal for every new command.
   Exact idempotent replays return their original result before transition logic
   runs.
5. Acceptance requires an `awaiting_confirmations` record with no missing items
   and both confirmations. It calls one transaction port that rechecks those
   invariants and changes the domain owner, future-task owner default, active
   reminder owners, handover, audit, and idempotency result together.
6. Any acceptance failure rolls back the entire transaction and leaves the prior
   owner, reminders, handover state, and audit unchanged.
7. AI output can contain only questions keyed to existing missing-information
   IDs. Provider failure returns `needs_human_review` and has no access to state,
   confirmation, acceptance, reminder, or audit ports.

## Port contracts

The state port owns idempotency ordering and optimistic concurrency. For a new
request it locks the relevant domain or handover, invokes the deterministic
planner, and commits the next record plus result. For an exact replay it returns
the stored result without invoking the planner; a reused key with a different
request hash fails with `idempotency_conflict`.

The atomic acceptance port is deliberately narrower. Its single `accept` method
is the only write path used by `AcceptHandover`, and implementations must enforce
the complete transaction defined by DATA-001 rather than composing independent
repository writes in application code.

## Risks and controls

| Risk | Control | User impact |
| --- | --- | --- |
| Stale or one-sided acceptance | Application precheck plus transactional recheck | Responsibility never falls between two people |
| Partial ownership migration | One atomic port and rollback-on-error contract | Old reminders cannot survive beside a new owner |
| Terminal record rewrite | Explicit terminal guard after idempotency replay lookup | Accepted or rejected decisions remain stable |
| Provider failure or prompt injection | Strict question-only schema and no mutation ports | AI cannot confirm, accept, or invent completion |
| Concurrent retries | Scoped request hash, replay-first semantics, and expected versions | Users receive one durable outcome without duplicate audit |

## Verification

- Unit tests cover blocked proposals, partial information supply, independent
  confirmations, decline, expiry, terminal-state rejection, exact acceptance
  replay, and injected transactional failure.
- AI tests cover validated question drafts, invalid output, and two-attempt
  provider failure with no consequential mutation capability.
- Required command: `pnpm run check:handover`.
- Scope and clean-head verification use `scripts/gate.py` and
  `scripts/worker_finish.py --verify-only`.
