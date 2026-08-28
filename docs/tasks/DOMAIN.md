# Domain Task Card

## Goal

Implement the minimal persisted MVP behavior for consent, report, handover, deterministic care, notification deduplication, and A3 delivery.

## Write Paths

- `src/domain/**`
- `src/server/**`
- `src/app/api/**`

## Acceptance

1. SQLite stores the five stage-owner columns directly and handover acceptance is one transaction.
2. Private evidence cannot create shared state without speaker consent; deletion produces safe `needs_review` behavior.
3. Care activation and execution are deterministic, clock-injected, ordered, and LLM-free.
4. Notification/App/A3 behavior covers deduplication, disabled default, UTF-8 limit, timeout, safe parsing, and safe errors.
5. Focused unit tests pass; only assigned paths change; worktree is clean and pushed.

## Explicitly Do Not

- Add ORM/workflow/event-store abstractions, platform SDKs, UI, real provider calls, credentials, or production auth.

