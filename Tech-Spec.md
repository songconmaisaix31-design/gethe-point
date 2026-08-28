# We Remember Timetable Agents MVP Technical Specification

## Architecture

Keep the existing single Next.js application, strict TypeScript contracts, Zod boundary validation, and Node SQLite persistence. Extend the current Fixture service instead of introducing a second data layer or application.

## Routes

- `/`: timetable-first family home.
- `/demo`: existing accepted V1.1 demonstration.
- `GET /api/demo/state?role=<role>`: existing role-safe projection plus `timetableItems`.
- `POST /api/demo/action?role=<role>`: existing actions plus timetable creation and completion.
- `POST /api/demo/agent?role=<role>`: bounded read-only member Agent query.
- `POST /api/demo/reset`: restores the canonical Fixture, including timetable seed data.

## Persistence

Add one table only:

```sql
CREATE TABLE timetable_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  category TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  domain_id TEXT,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```

The service validates enum values, member and domain references, bounded Fixture dates, duration, title length, authorization, and current state inside the mutation boundary.

## Member Agent

The Agent endpoint accepts a target member and a bounded message. A deterministic Chinese keyword router maps the message to one of:

- `schedule`
- `responsibilities`
- `care`
- `help`

The deterministic response is composed only from the caller's `RoleSafeProjection`; targeting another member cannot grant additional access. It selects the intent, referenced timetable item IDs, and fixed UI suggestions, and it never returns raw evidence text or performs a mutation.

When `STEPFUN_API_KEY` is configured, a small provider adapter may rewrite only the answer text through StepFun Chat Completions. It uses native `fetch`, the fixed HTTPS endpoint `https://api.stepfun.com/v1/chat/completions`, and `STEPFUN_MODEL` with the low-latency default `step-2-mini`. The outbound allowlist contains only the deterministic answer, target display name, deterministic intent, visible timetable titles/times/categories/statuses, and visible responsibility/care counts from the caller's role-safe projection. It explicitly excludes the raw user question, private Evidence, messages, notifications, identifiers, and conversation transcripts.

The provider has a short timeout, bounded output, strict unknown-response narrowing, and no retries. Any missing configuration, timeout, network error, non-success response, or invalid output silently returns the deterministic text without logging secrets or provider bodies. The API reports `engine: "stepfun"` only for a validated provider answer and otherwise reports `engine: "fixture_intent_router"`.

## Authorization

- Subject may create timetable items owned by self.
- Primary and partner may create family or care items for household members.
- Only the current owner may complete an item.
- Existing consent, handover, and care authorization rules remain unchanged.
- All mutation actions use explicit structured payloads; free-text Agent messages are read-only.
- StepFun never receives a mutation capability and never determines authorization, item references, or suggested actions.

## UI Structure

- `FamilyHome`: role switch, week heading, filters, timetable, and member Agent rail.
- `FamilyTimetable`: seven columns on desktop and chronological day sections on mobile.
- `MemberAgentPanel`: selected member context, quick queries, bounded message input, structured add form, and response.
- `DemoApp`: retained under `/demo` without changing its product behavior.

Local component state is sufficient. Server state is refreshed from the real API after every successful mutation.

## Verification

- Contract and domain unit tests for validation, authorization, persistence, intent routing, provider success/fallback, bounded redaction, and privacy.
- Browser tests for timetable rendering/filtering, persisted creation, owner-only completion, Agent queries, non-leakage, `/demo` regression, and mobile behavior.
- Accessibility tests for both `/` and `/demo`.
- Final checks: frozen install, unit, typecheck, lint, build, E2E, accessibility, and visual inspection at desktop and mobile widths.
