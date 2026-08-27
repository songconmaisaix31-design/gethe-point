# Security, Authorization, and Deletion Contract

Status: Frozen by `CONTRACT-001`

## Security objective

The primary security property is that private family evidence cannot cross into shared family state without the speaker's explicit, current, per-item consent. The second property is that consequential state changes fail closed: ambiguous authority, missing information, invalid AI output, stale state, and replay conflicts never imply success.

## Threat model

| Threat | Boundary | Required response | User impact |
| --- | --- | --- | --- |
| A member guesses another member's private message or evidence ID | query authorization | return the same non-enumerating denial used for an absent record | private conversations remain private even inside one family space |
| A request body supplies another member as actor | actor boundary | ignore body authority; use the separately authenticated actor and deny mismatch | clients cannot impersonate another role by changing JSON |
| A stale, revoked, expired, wrong-speaker, or replayed consent is reused | consent boundary | reject the shared write; keep raw content self-only | prior consent cannot become a blanket authorization |
| A shared conclusion embeds raw private content | visibility and schema boundary | strict schema rejects raw fields; allow only a bounded redacted excerpt and provenance IDs | shared activity cannot reveal the full private conversation |
| Prompt-injection text changes policy or creates a task | AI boundary | treat content only as data; validate output; require deterministic consent/confirmation | model text cannot authorize an action |
| Provider timeout or invalid structured output occurs twice | AI attempt boundary | return `needs_human_review`; write no consequential state | AI failure is visible and safe rather than silently guessed |
| One party tries to accept an incomplete handover | state and authorization boundary | remain blocked; preserve owner and reminders | responsibility cannot fall between people |
| Replayed scheduler tick or webhook duplicates a notification | idempotency boundary | return the stored result for the exact scoped request | older subjects and family members are not spammed |
| Evidence is deleted while derived facts still exist | deletion transaction | invalidate every dependent projection and exclude it from reports | reports stop presenting unsupported facts |
| Space deletion leaves audit or derived content behind | deletion transaction | cascade all in-space product and audit content | the user's deletion right is complete within the MVP store |
| Error or telemetry captures private content | logging boundary | emit IDs, typed outcomes, timing, and counts only | diagnostics do not create a second privacy leak |

## Fail-closed input rules

- Trust-boundary values enter as `unknown` and pass the exact exported Zod schema.
- Object schemas are strict; extra fields are invalid.
- Unsupported actor kind, role, visibility, state, command, query, event, or error code is invalid.
- `self` visibility can never satisfy a shared-signal schema.
- Invalid identifiers and timestamps are rejected before authorization checks.
- After syntactic validation, authorization and current-state checks still run; a valid shape is not permission.
- Absence and lack of visibility may return the same `not_found` error to avoid record enumeration.

## Authorization matrix

The executable `AUTHORIZATION_MATRIX` is the source for later handlers. `allow` rows still require all listed relationship and state guards; every unlisted relation is denied.

| Action | Allowed relationship | Required state/guard | Denial behavior |
| --- | --- | --- | --- |
| create private message | actor is the conversation participant and message author | same space; active member | `not_found` or `forbidden`; no write |
| read private conversation | actor is the conversation participant | same space | non-enumerating `not_found` |
| read raw evidence | actor is evidence speaker | evidence exists and is not deleted | non-enumerating `not_found` |
| delete raw evidence | actor is evidence speaker | expected version and idempotency match | non-enumerating denial; no cascade |
| decide signal consent | actor is draft speaker | decision is pending and one item only | `consent_invalid`; no shared write |
| confirm shared signal | actor is draft speaker | active unexpired share decision; supported shared visibility | `consent_required` / `consent_invalid`; no shared write |
| read shared signal | actor is included by its visibility predicate | same space | non-enumerating `not_found` |
| correct task attribution | actor can see the task and belongs to its space | evidence is current; expected version matches | denial or conflict; no correction |
| propose handover | actor is current domain owner | recipient differs; same space; domain current | denial; owner unchanged |
| confirm handover from | actor is `fromMemberId` | packet complete and non-terminal | blocked/denied; no confirmation |
| confirm handover to | actor is `toMemberId` | packet complete and non-terminal | blocked/denied; no confirmation |
| accept handover | actor is `handover_service` | complete, both confirmations, versions current | blocked/denied/failure; owner and reminders unchanged |
| decline handover | actor is source or recipient | state is blocked or awaiting confirmations | transition denied for any other state |
| expire handover | actor is `handover_expiry_service` | expiry instant reached | transition denied before expiry |
| confirm care rule | actor is subject or named primary caregiver | exact rule facts reviewed; evidence current | denial; rule remains inactive |
| tick care scheduler | actor is `care_scheduler` | rule active; deterministic due time | denial/inactive; no notification intent |
| acknowledge care event | actor is care subject | event allows acknowledgement | denial/terminal; no transition |
| handle care event | actor is a current escalation recipient | event is escalated | denial; no transition |
| export personal data | actor requests self | include only currently authorized records | `export_not_authorized`; no bundle |
| read audit trail | actor matches entry visibility | same space | filter hidden entries and deny cross-space access |
| delete space | actor is space creator | exact name confirmation; version and idempotency match | confirmation/authorization error; no deletion |

## Visibility predicates

| Scope | Read predicate | Shared family record? |
| --- | --- | --- |
| `self` | actor member ID equals owner member ID | no |
| `space` | actor is an active member of the same space | yes |
| `members` | actor member ID is in the complete explicit list | yes |
| `care_related` | actor is the subject, primary caregiver, or current escalation participant listed by the record | yes |

Role names alone never grant raw-evidence access. A `primary` actor cannot read another member's private evidence merely because of that role.

## Consent lifecycle

1. A private message and raw evidence are self-visible.
2. AI or fixture logic may produce a non-consequential candidate draft.
3. The speaker chooses `discard` or `share` and, for sharing, one supported shared visibility.
4. `ConfirmSignal` validates speaker, decision, status, expiry, visibility, versions, and idempotency.
5. The shared record contains only the bounded redacted excerpt, structured conclusion, purpose, decision ID, and evidence provenance IDs.
6. Revoking future analysis stops new drafting. It does not falsify the historical consent event or delete already shared facts.
7. Evidence deletion is the separate operation that invalidates dependent facts.

## Deletion and retention matrix

| Operation | Authorized actor | Removed | Invalidated or preserved | Audit and receipt |
| --- | --- | --- | --- | --- |
| delete one evidence item | evidence speaker | raw evidence record/content | dependent signals -> `evidence_missing`; dependent tasks/domains -> `needs_review`; reports exclude them; accepted handovers and current owner preserved | append in-space audit while space exists; return affected IDs |
| revoke analysis consent | same member | no historical product record | block future model analysis; prior authorized signals/events remain | append in-space audit |
| export my data | same member | nothing | include own private records and currently visible shared records only | append content-free export audit; bundle is caller-controlled output |
| delete family space | space creator after exact confirmation | all in-space product content, raw evidence, derived conclusions, handovers, reminders, care records, export records, and audit entries | nothing in the MVP store is preserved | return ephemeral receipt only; do not persist the receipt in the deleted store |

Evidence deletion is intentionally not a historical rewrite. Reversing an accepted handover could silently return responsibility to a person who no longer receives reminders. Instead, the current ownership remains and the affected domain becomes `needs_review`.

## AI and log safety

- Provider adapters receive only `redactedInput`, purpose, prompt version, output JSON Schema, timeout, and request ID.
- Provider credentials are read only by runtime adapters from approved environment variables. Contract examples and docs contain no secret values or secret file contents.
- Provider output begins as `unknown` and is validated before a draft result exists.
- Telemetry may contain token counts, latency, attempt number, provider outcome code, and IDs. It must not contain prompts, inputs, outputs, message text, evidence text, authorization data, or credentials.
- Ordinary application errors use stable safe messages. Debug context stays server-side and follows the same content-free rule.

## Remaining proof obligations

This contract does not prove database isolation, transactional cascades, route middleware, or concurrent deletion/read behavior. `DATA-001`, feature tracks, integration, and privacy hardening own those executable proofs against this frozen matrix.
