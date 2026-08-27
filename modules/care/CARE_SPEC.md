# Deterministic Care Module Specification

## Outcome

The module activates a care rule only after an authorized human confirms the
exact schedule, acknowledgement window, ordered escalation chain, and terminal
behavior. After activation, deterministic code owns scheduling, notification
intent creation, timeout, escalation, acknowledgement, handling, closure, and
the visible `unresolved` outcome. No execution dependency exposes an LLM.

## Boundaries

- Public actors, requests, results, entities, and transition rules come from
  `packages/contracts`.
- `Clock` is injected. Commands never sleep and never read wall-clock time.
- `CareRepository` is the persistence boundary. Its PostgreSQL adapter stores
  idempotency claims, command results, rules, events, and audit entries in one
  transaction.
- Notification delivery is outside this module. The scheduler returns stable
  notification intents; a replay marks them `already_recorded`.
- Notification IDs are derived from event, escalation level, and recipient.
  This preserves their identity even though DATA-001 does not store a separate
  notification-intent table.

## Deterministic scheduling

- A draft, paused, or archived rule cannot create or advance an operational
  event.
- A scheduler tick first advances existing actionable events, then creates a
  bounded set of missing schedule occurrences. A newly created occurrence is
  persisted as `scheduled` and can advance on a later tick.
- One event advances by at most one state per tick. Intermediate timeout and
  escalation states therefore remain observable and auditable.
- For a daily schedule, a tick considers the latest due occurrence and the
  next occurrence around the observed local date. The unique occurrence key
  prevents a second event for the same rule and instant.
- The acknowledgement deadline starts when the subject notification is
  persisted, so a late scheduler run does not shorten the human response
  window.

## Escalation semantics

The confirmed array order is authoritative and levels must be contiguous from
one. Timeout advances to level one. After a level is notified, its `delaySec`
is the exact wait before the next level. After the final level's delay expires,
the event becomes `unresolved`. An unavailable subject or escalation recipient
also becomes `unresolved`; the scheduler never skips, invents, or reorders a
confirmed target.

Acknowledgement by the subject before timeout moves the event to
`acknowledged`, suppressing timeout and escalation. A current escalation
recipient can move an escalated event to `handled`. A later scheduler tick
closes acknowledged or handled events after the corresponding audit fact is
persisted.

## Acceptance and verification

- Inactive draft: no event and no notification intent.
- Scheduled reminder: one occurrence and one stable subject intent.
- Replay: repeated tick, acknowledgement, or handling key returns the stored
  result without another mutation or intent.
- Timed out: deadline comparison is deterministic and uses no sleep.
- Escalated: targets and delays follow the confirmed chain exactly.
- Closed: acknowledged and handled paths terminate after audit persistence.
- Unresolved: exhausted or impossible delivery remains visible.
- `pnpm run check:care` type-checks, lints, and runs the module tests.

## Risks

- Native `Intl` timezone conversion rejects nonexistent local times during a
  daylight-saving jump instead of guessing. The next valid confirmed time is
  still considered.
- The MVP scheduler intentionally bounds catch-up rather than replaying an
  unbounded historical daily backlog. The persisted occurrence key and next
  future occurrence keep normal periodic ticks reliable.
