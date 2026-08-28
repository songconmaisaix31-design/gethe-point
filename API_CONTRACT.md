# We Remember MVP API Contract

Status: Frozen for implementation

## Roles and Visibility

```ts
type Role = "primary" | "partner" | "subject";
type Visibility = "self" | "space" | "care_related" | { members: readonly string[] };
type Channel = "app" | "robot_a3";
type Priority = "normal" | "high" | "urgent";
```

Only `app` and `robot_a3` are implemented. Enterprise channels remain product roadmap text, not runtime enum members.

## Demo Actions

```ts
type DemoAction =
  | { type: "share_evidence"; evidenceId: string; visibility: Visibility }
  | { type: "add_handover_info"; handoverId: string; item: "last_report" }
  | { type: "confirm_handover"; handoverId: string; actorId: string; expectedVersion: number }
  | { type: "activate_care_rule"; careRuleId: string; actorId: string; expectedVersion: number }
  | { type: "trigger_care_reminder"; careRuleId: string }
  | { type: "advance_demo_clock"; seconds: number }
  | { type: "acknowledge_care"; careEventId: string; actorId: string }
  | { type: "handle_escalation"; careEventId: string; actorId: string }
  | { type: "delete_evidence"; evidenceId: string; actorId: string };
```

Every request rejects unknown keys and invalid identifiers. The server derives space/member authority from the Fixture session rather than accepting arbitrary scope IDs.

## Fixed State Rules

- Sharing `self` creates no shared signal/domain/task/report effect.
- Shared effects require the evidence speaker's explicit action.
- A handover is externally `blocked` until required information and both confirmations exist.
- Handover acceptance updates domain owner, open-task future reminder owner, handover state, and audit record in one SQLite transaction.
- A care rule remains inert until human activation.
- Care timeout equality counts as timed out. Escalation order is preserved exactly.
- Notification state `sent_to_provider` is never rendered as read, acknowledged, or completed.
- Deleting evidence marks dependent conclusions `needs_review` and excludes them from the report; accepted ownership does not silently roll back.

## Safe Errors

```text
invalid_request
forbidden
not_found
conflict
disabled
timeout
provider_unavailable
internal_failure
```

Errors never include private message text, external response bodies, endpoints, tokens, stack traces, or record-existence detail beyond the caller's authorized projection.
