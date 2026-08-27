# Deterministic State-Machine Contract

Status: Frozen by `CONTRACT-001`

The executable tables are `HANDOVER_TRANSITION_TABLE` and `CARE_TRANSITION_TABLE`. Each is a Cartesian table: every possible `from` and `to` state pair has exactly one `allowed` or `denied` rule. An omitted pair cannot be interpreted as allowed.

## Handover

### States

| State | Meaning | Ownership effect |
| --- | --- | --- |
| `draft` | private construction of a handover packet | none |
| `proposed` | proposal submitted for deterministic completeness evaluation | none |
| `blocked` | required operational information is missing | none; current owner/reminders unchanged |
| `awaiting_confirmations` | information complete; waiting for independent source and recipient confirmations | none; current owner/reminders unchanged |
| `accepted` | both confirmations exist and atomic migration succeeded | owner/defaults/reminders/audit changed together |
| `declined` | an involved member declined | none; terminal |
| `expired` | deterministic expiry time reached | none; terminal |

### Allowed transitions

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| `draft` | `proposed` | `ProposeHandover` | proposer is current owner; recipient is a different active same-space member |
| `proposed` | `blocked` | proposal evaluation | `missingInfo.length > 0` |
| `proposed` | `awaiting_confirmations` | proposal evaluation | `missingInfo.length === 0` |
| `blocked` | `awaiting_confirmations` | `SupplyHandoverInfo` | every required item resolved and packet revalidated |
| `blocked` | `declined` | `DeclineHandover` | actor is source or recipient |
| `blocked` | `expired` | `ExpireHandover` | injected clock is at or after expiry |
| `awaiting_confirmations` | `accepted` | `AcceptHandover` | both confirmations exist; versions current; one atomic migration succeeds |
| `awaiting_confirmations` | `declined` | `DeclineHandover` | actor is source or recipient |
| `awaiting_confirmations` | `expired` | `ExpireHandover` | injected clock is at or after expiry |

Every other pair is denied. `accepted`, `declined`, and `expired` have no outgoing transitions. A same-request retry is handled by idempotency and returns the original result; it is not another transition.

### Acceptance atomicity

The data track must expose one transaction boundary whose success result proves all four facts:

1. `Domain.ownerId` is the recipient;
2. future task ownership defaults point to the recipient;
3. active domain reminders point to the recipient and no longer notify the source;
4. one structured acceptance audit entry exists.

If any write, notification-intent migration, optimistic version check, or audit write fails, the transaction rolls back and the handover remains `awaiting_confirmations` with the prior owner and reminders.

## Care rule lifecycle

`draft` rules are inert. `ConfirmCareRule` produces `active` only after a human confirms the subject, schedule, acknowledgement requirement/window, ordered escalation chain, primary caregiver, source evidence, and terminal behavior. `paused` and `archived` rules do not produce new events. Care execution never calls an LLM.

## Care event

### States

| State | Meaning |
| --- | --- |
| `scheduled` | one occurrence exists and is waiting for its due instant |
| `notified` | subject notification intent was durably created |
| `acknowledged` | subject acknowledged before closure |
| `timed_out` | acknowledgement deadline passed without acknowledgement |
| `escalated` | one or more confirmed escalation levels were durably notified |
| `handled` | an authorized escalation recipient recorded a safe resolution |
| `closed` | terminal completed outcome |
| `unresolved` | terminal visible outcome after recipients/retries/escalation are exhausted |

### Allowed transitions

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| `scheduled` | `notified` | `TickCareScheduler` | active confirmed rule; due instant reached; subject notification intent persisted |
| `scheduled` | `unresolved` | `TickCareScheduler` | deterministic terminal recipient/delivery failure after the bounded retry policy |
| `notified` | `acknowledged` | `AcknowledgeCareEvent` | actor is subject and acknowledgement is allowed |
| `notified` | `timed_out` | `TickCareScheduler` | `requireAck` and injected time is at or after the deadline |
| `notified` | `closed` | `TickCareScheduler` | `requireAck` is false and notification audit is persisted |
| `notified` | `unresolved` | `TickCareScheduler` | bounded delivery retry is exhausted |
| `timed_out` | `escalated` | `TickCareScheduler` | next confirmed escalation level has at least one valid target |
| `timed_out` | `unresolved` | `TickCareScheduler` | no valid escalation target remains |
| `escalated` | `escalated` | `TickCareScheduler` | next level exists; level strictly increases; level-scoped key is new |
| `escalated` | `acknowledged` | `AcknowledgeCareEvent` | subject sends a late acknowledgement before terminal handling |
| `escalated` | `handled` | `HandleCareEvent` | actor is a current escalation recipient |
| `escalated` | `unresolved` | `TickCareScheduler` | final escalation and retry policy are exhausted |
| `acknowledged` | `closed` | deterministic close | acknowledgement audit is persisted |
| `handled` | `closed` | deterministic close | handling audit is persisted |

Every other pair is denied. `closed` and `unresolved` are terminal.

### Boundary-time rule

The timeout comparison is inclusive: `now >= acknowledgementDeadline` permits the deterministic timeout transition. An acknowledgement request that wins the optimistic-version write first succeeds; a concurrent tick with the stale version fails. A tick that wins first moves to `timed_out`; a later acknowledgement follows only an explicitly allowed late-ack path. No path relies on process sleep or arrival-order assumptions.

### Idempotency

| Operation | Scope | Replay result |
| --- | --- | --- |
| create scheduled occurrence | care rule + occurrence instant | original event ID |
| subject notification | care event + `subject` level | original notification intent ID |
| escalation notification | care event + escalation level + target | original notification intent ID |
| acknowledgement | care event + actor | original acknowledged result |
| handling | care event + actor | original handled result |

The same key with a different canonical request hash returns `idempotency_conflict`. It never creates a second event or advances twice.
