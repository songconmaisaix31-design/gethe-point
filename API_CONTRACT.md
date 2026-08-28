# We Remember Timetable Agents MVP API Contract

All request bodies reject unknown keys. External input is parsed as `unknown` and narrowed with Zod before use.

## Timetable Projection

```ts
type TimetableCategory = "responsibility" | "care" | "family";
type TimetableStatus = "planned" | "completed";

interface TimetableItemProjection {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  category: TimetableCategory;
  ownerId: string;
  domainId: string | null;
  status: TimetableStatus;
  visibility: "household" | "self";
  canComplete: boolean;
}
```

`GET /api/demo/state?role=<role>` adds `timetableItems: TimetableItemProjection[]` to the existing `RoleSafeProjection`.

## Timetable Actions

Create:

```json
{
  "type": "create_timetable_item",
  "ownerId": "member_subject",
  "title": "晚间用药",
  "startsAt": "2026-08-29T19:00:00+08:00",
  "durationMinutes": 30,
  "category": "care",
  "domainId": "domain_health"
}
```

Complete:

```json
{
  "type": "complete_timetable_item",
  "itemId": "timetable_medicine"
}
```

Rules:

- `title`: 1-80 trimmed characters.
- `startsAt`: valid ISO date-time within the bounded Fixture week.
- `durationMinutes`: integer from 15 through 480.
- `domainId`: optional valid Fixture domain.
- Subject can create only for self; primary and partner can create household family/care items.
- Only the item owner may complete a planned item.

Successful actions use the existing action response shape and return the refreshed role-safe projection. Validation and authorization failures use the existing safe error envelope.

## Member Agent Query

`POST /api/demo/agent?role=<role>`

Request:

```ts
interface AgentQueryRequest {
  targetMemberId: string;
  message: string; // 1-240 trimmed characters
  intentHint?: "schedule" | "responsibilities" | "care" | "help";
}
```

Response:

```ts
interface AgentQueryResponse {
  intent: "schedule" | "responsibilities" | "care" | "help";
  targetMemberId: string;
  text: string;
  referencedItemIds: string[];
  suggestedActions: Array<"view_timetable" | "add_item" | "open_demo">;
  engine: "stepfun" | "fixture_intent_router";
}
```

Rules:

- The query is read-only and cannot trigger a state change.
- The caller is derived from the validated `role` query parameter, not the body.
- Responses are composed only from the caller's current `RoleSafeProjection`.
- Selecting a target member never increases visibility.
- Raw evidence content is never returned.
- Unsupported or ambiguous text returns the `help` intent with supported examples.
- Intent, referenced IDs, and suggested actions are deterministic server decisions. StepFun may rewrite only `text` from an already role-safe bounded summary.
- Missing or failed StepFun configuration falls back to `fixture_intent_router`; provider errors and bodies are not exposed in the response.
