# We Remember MVP Technical Specification

Status: Implementation baseline

## Why This Shape

The product risk is whether the responsibility-transfer story is credible, not whether the repository can support every future channel. A single Next.js application with a small SQLite data boundary is the shortest path that still proves persistence, atomic transitions, privacy, and a real browser experience.

## Stack

- Next.js App Router and React.
- Strict TypeScript.
- Node built-in SQLite API; no ORM and no external database service for the Fixture MVP.
- Zod only at external and action-input boundaries.
- Node test runner for domain tests and Playwright for browser/accessibility checks.

## Code Shape

```text
src/contracts.ts        Shared bounded types and action schemas
src/domain/             Pure transitions, reports, templates, and policies
src/server/             SQLite schema/repository, application service, LLM/A3 boundaries
src/app/api/            Fixture state/action/reset HTTP boundary
src/app/(ui)/           Role surfaces
src/components/         Small UI components
fixtures/               One fictional household seed
tests/                  Domain and browser acceptance
```

## Minimal Data Model

- `members`: three roles, capacity state, consent state, channel preferences.
- `evidence`: self-owned raw text, visibility, deletion state.
- `signals`: confirmed/dismissed/observed classification and evidence link.
- `domains`: owner, status, next action, visibility.
- `tasks`: five nullable stage-owner columns as first-class database fields.
- `handovers`: packet, missing information, both confirmations, state.
- `care_rules`: draft/active state, schedule, acknowledgement timeout, ordered escalation chain.
- `care_events`: deterministic state and timestamps.
- `notification_logs`: logical event, recipient, channel, template, safe status/code, timestamp.
- `audit_logs`: actor, bounded action, target, timestamp, safe metadata.

No generic event store, outbox framework, workflow engine, multi-tenant abstraction, or 21-table production schema.

## Runtime Boundaries

- Fixture actions are explicit commands, not free-form magic.
- Optional LLM calls accept redacted minimal context, validate structured output, retry once, and fall back to human review. Fixture mode remains deterministic.
- Care execution reads an injected clock and contains no LLM call.
- Notification deduplication uses `(logicalEventId, recipientId, channel)` plus a bounded window.
- A3 uses an injected `fetch`, timeout/abort, UTF-8 byte limit, safe response parsing, and `ENABLE_ROBOT=false` by default.

## API

- `GET /api/demo/state?role=<role>` returns a role-safe projection.
- `POST /api/demo/action` validates one discriminated action and returns the next role-safe projection.
- `POST /api/demo/reset` resets only the local Fixture database.
- Public errors contain bounded codes and no private content or raw provider response.

## Verification

- Domain tests cover consent denial/scoping, persisted attribution/report neutrality, blocked and accepted handover, exact owner/reminder transfer, care activation and timeout equality, deduplication, A3 disabled/success/failure, and deletion.
- Browser tests run the full demo path and check desktop/mobile overflow, subject target sizes/type, reduced motion, and key truth labels.
- Final verification runs from a clean integration HEAD.
