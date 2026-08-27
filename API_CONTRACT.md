# We Remember MVP API Contract

Status: Corrected by `CONTRACT-CORR-002`

Executable source: `packages/contracts/src/index.ts`

## 1. Boundary rules

This document names the public operation types. The executable Zod schemas are authoritative for exact fields and validation.

- Every operation receives `actor` separately from `request`; request bodies cannot choose their own authority.
- All object schemas are strict. Unknown keys, unknown enum values, malformed IDs, invalid timestamps, and missing required keys return `invalid_request` before a handler runs.
- IDs are UUIDs. Times are offset-aware ISO-8601 strings. Versions are non-negative integers.
- Errors are content-free and non-enumerating. `not_found` may represent absent or unauthorized records.
- Every mutation result is an explicit status variant. Missing information never becomes success.
- `fixture_demo` actors are fictional inputs to the same authorization boundary; they are not production authentication.
- Public consumers import from `@we-remember/contracts` only. There are no supported deep imports.
- `AcknowledgeCareEvent` and `HandleCareEvent` do not accept caller timestamps. Each command samples `Clock.now()` once and reuses that instant for transition decisions, deadline comparison, persisted transition time, the idempotency claim, and the audit entry.

## 2. Common public types

| Type | Purpose |
| --- | --- |
| `MemberActor` | Explicit member identity, space, P0 role, and authentication evidence level |
| `SystemActor` | Narrow deterministic service identity for handover, care, expiry, or privacy execution |
| `Visibility` | `self`, `space`, `care_related`, or an explicit member set |
| `ContractError<Code>` | Safe error containing code, request ID, retryability, and a non-sensitive message |
| `Task` | Stored task with all five required responsibility keys |
| `Domain` | Responsibility domain whose `ownerId` is the current active owner |
| `Handover` | State-specific handover union with blocked and terminal invariants |
| `CareRule` / `CareEvent` | Human-confirmed rule and deterministic event records |
| `CareResolution` | Bounded persisted handling outcome; `legacy_unknown` is migration-only history |
| `AuditEntry` | Content-free structured audit fact retained only for the space lifetime |
| `IdempotencyKey` | Retry identity scoped by space, command, and actor |

## 3. Command contracts

The 18 commands named by ADR 0001 are required. `DeclineHandover` and `ExpireHandover` are the minimum additional commands needed to reach the ADR's approved terminal handover states.

| Command | Actor type | Request type | Result type | Error type |
| --- | --- | --- | --- | --- |
| `CreatePrivateMessage` | `CreatePrivateMessageActor` (`MemberActor`) | `CreatePrivateMessageRequest`: conversation, client message ID, content, occurred time | `CreatePrivateMessageResult`: private message created | `CreatePrivateMessageError`: invalid request, unauthenticated, forbidden, conflict, internal failure |
| `CreateSignalDraft` | `CreateSignalDraftActor` (`MemberActor`) | `CreateSignalDraftRequest`: private message/evidence IDs and drafting purpose | `CreateSignalDraftResult`: validated draft or `needs_human_review` | `CreateSignalDraftError`: invalid request, forbidden, not found, provider timeout/unavailable/invalid output, internal failure |
| `DecideConsent` | `DecideConsentActor` (`MemberActor`) | `DecideConsentRequest`: signal draft plus `share` visibility or `discard` | `DecideConsentResult`: one immutable decision record | `DecideConsentError`: invalid request, forbidden, not found, conflict, consent invalid |
| `ConfirmSignal` | `ConfirmSignalActor` (`MemberActor`) | `ConfirmSignalRequest`: draft ID, active decision ID, expected version, idempotency key | `ConfirmSignalResult`: minimum redacted shared signal | `ConfirmSignalError`: invalid request, forbidden/not found, consent required/invalid, visibility denied, conflict, idempotency conflict |
| `CorrectTaskAttribution` | `CorrectTaskAttributionActor` (`MemberActor`) | `CorrectTaskAttributionRequest`: task ID, complete five-field attribution, reason, expected version, idempotency key | `CorrectTaskAttributionResult`: corrected task and audit ID | `CorrectTaskAttributionError`: invalid request, forbidden/not found, evidence missing, conflict, idempotency conflict |
| `ProposeHandover` | `ProposeHandoverActor` (`MemberActor`) | `ProposeHandoverRequest`: domain, recipient, complete packet draft, expected domain version, idempotency key | `ProposeHandoverResult`: `blocked` or `awaiting_confirmations` handover | `ProposeHandoverError`: invalid request, forbidden/not found, visibility denied, conflict, idempotency conflict |
| `SupplyHandoverInfo` | `SupplyHandoverInfoActor` (`MemberActor`) | `SupplyHandoverInfoRequest`: handover, resolved missing items, expected version, idempotency key | `SupplyHandoverInfoResult`: still blocked or awaiting confirmations | `SupplyHandoverInfoError`: invalid request, forbidden/not found, transition denied/terminal, conflict, idempotency conflict |
| `ConfirmHandoverFrom` | `ConfirmHandoverFromActor` (`MemberActor`) | `ConfirmHandoverFromRequest`: handover, expected version, idempotency key | `ConfirmHandoverFromResult`: awaiting-confirmations handover | `ConfirmHandoverFromError`: invalid request, forbidden/not found, handover blocked, transition denied/terminal, conflict, idempotency conflict |
| `ConfirmHandoverTo` | `ConfirmHandoverToActor` (`MemberActor`) | `ConfirmHandoverToRequest`: handover, expected version, idempotency key | `ConfirmHandoverToResult`: awaiting-confirmations handover | `ConfirmHandoverToError`: invalid request, forbidden/not found, handover blocked, transition denied/terminal, conflict, idempotency conflict |
| `AcceptHandover` | `AcceptHandoverActor` (`handover_service`) | `AcceptHandoverRequest`: handover, expected handover/domain versions, idempotency key | `AcceptHandoverResult`: accepted record plus atomic migration receipt | `AcceptHandoverError`: invalid request, forbidden/not found, handover blocked, confirmation required, transition denied/terminal, conflict, idempotency conflict, internal failure |
| `DeclineHandover` | `DeclineHandoverActor` (`MemberActor`) | `DeclineHandoverRequest`: handover, reason, expected version, idempotency key | `DeclineHandoverResult`: terminal declined handover | `DeclineHandoverError`: invalid request, forbidden/not found, transition denied/terminal, conflict, idempotency conflict |
| `ExpireHandover` | `ExpireHandoverActor` (`handover_expiry_service`) | `ExpireHandoverRequest`: handover, observed time, expected version, idempotency key | `ExpireHandoverResult`: terminal expired handover | `ExpireHandoverError`: invalid request, forbidden/not found, transition denied/terminal, conflict, idempotency conflict |
| `ConfirmCareRule` | `ConfirmCareRuleActor` (`MemberActor`) | `ConfirmCareRuleRequest`: draft rule, exact confirmed trigger/ack/escalation facts, expected version, idempotency key | `ConfirmCareRuleResult`: active care rule | `ConfirmCareRuleError`: invalid request, forbidden/not found, evidence missing, conflict, idempotency conflict |
| `TickCareScheduler` | `TickCareSchedulerActor` (`care_scheduler`) | `TickCareSchedulerRequest`: observed time, bounded batch size, scheduler idempotency key | `TickCareSchedulerResult`: event/notification intents and replay marker | `TickCareSchedulerError`: invalid request, forbidden, care rule inactive, idempotency conflict, internal failure |
| `AcknowledgeCareEvent` | `AcknowledgeCareEventActor` (`MemberActor`) | `AcknowledgeCareEventRequest`: event, expected version, idempotency key; no caller time | `AcknowledgeCareEventResult`: acknowledged event stamped from `Clock.now()` | `AcknowledgeCareEventError`: invalid request, forbidden/not found, transition denied/terminal, conflict, idempotency conflict |
| `HandleCareEvent` | `HandleCareEventActor` (`MemberActor`) | `HandleCareEventRequest`: escalated event, selectable safe resolution, expected version, idempotency key; no caller time | `HandleCareEventResult`: handled event stamped from `Clock.now()` | `HandleCareEventError`: invalid request, forbidden/not found, transition denied/terminal, conflict, idempotency conflict |
| `DeleteEvidence` | `DeleteEvidenceActor` (`MemberActor`) | `DeleteEvidenceRequest`: evidence, expected version, idempotency key | `DeleteEvidenceResult`: deterministic invalidation receipt | `DeleteEvidenceError`: invalid request, forbidden/not found, conflict, idempotency conflict, internal failure |
| `RevokeAnalysisConsent` | `RevokeAnalysisConsentActor` (`MemberActor`) | `RevokeAnalysisConsentRequest`: effective time, expected version, idempotency key | `RevokeAnalysisConsentResult`: future analysis disabled | `RevokeAnalysisConsentError`: invalid request, forbidden/not found, conflict, idempotency conflict |
| `ExportMyData` | `ExportMyDataActor` (`MemberActor`) | `ExportMyDataRequest`: JSON format, requested time, idempotency key | `ExportMyDataResult`: actor-authorized export bundle | `ExportMyDataError`: invalid request, forbidden, export not authorized, idempotency conflict, internal failure |
| `DeleteSpace` | `DeleteSpaceActor` (`MemberActor`) | `DeleteSpaceRequest`: space, exact name confirmation, expected version, idempotency key | `DeleteSpaceResult`: ephemeral non-content deletion receipt | `DeleteSpaceError`: invalid request, forbidden/not found, deletion confirmation required, conflict, idempotency conflict, internal failure |

## 4. Query contracts

Queries never mutate state and still require an explicit actor. Every list request uses a bounded page size and an opaque nullable cursor.

| Query | Actor type | Request type | Result type | Error type |
| --- | --- | --- | --- | --- |
| `GetRoleHome` | `GetRoleHomeActor` (`MemberActor`) | `GetRoleHomeRequest`: space | `GetRoleHomeResult`: role-discriminated primary, partner, or subject home | `GetRoleHomeError`: invalid request, forbidden/not found, internal failure |
| `GetPrivateConversation` | `GetPrivateConversationActor` (`MemberActor`) | `GetPrivateConversationRequest`: conversation and page | `GetPrivateConversationResult`: self-visible private messages | `GetPrivateConversationError`: invalid request, forbidden/not found, internal failure |
| `GetVisibleSharedSignals` | `GetVisibleSharedSignalsActor` (`MemberActor`) | `GetVisibleSharedSignalsRequest`: space and page | `GetVisibleSharedSignalsResult`: only visibility-authorized shared signals | `GetVisibleSharedSignalsError`: invalid request, forbidden/not found, internal failure |
| `GetResponsibilityReport` | `GetResponsibilityReportActor` (`MemberActor`) | `GetResponsibilityReportRequest`: space and closed time interval | `GetResponsibilityReportResult`: exact stage counts, exclusions, and neutral narrative | `GetResponsibilityReportError`: invalid request, forbidden/not found, internal failure |
| `GetDomainWithEvidence` | `GetDomainWithEvidenceActor` (`MemberActor`) | `GetDomainWithEvidenceRequest`: domain | `GetDomainWithEvidenceResult`: domain, tasks, and authorized evidence views | `GetDomainWithEvidenceError`: invalid request, forbidden/not found, visibility denied, internal failure |
| `GetPendingHandovers` | `GetPendingHandoversActor` (`MemberActor`) | `GetPendingHandoversRequest`: space and page | `GetPendingHandoversResult`: actor-involved non-terminal handovers | `GetPendingHandoversError`: invalid request, forbidden/not found, internal failure |
| `GetCareInbox` | `GetCareInboxActor` (`MemberActor`) | `GetCareInboxRequest`: space and page | `GetCareInboxResult`: care events where actor is subject or escalation recipient | `GetCareInboxError`: invalid request, forbidden/not found, internal failure |
| `GetAuditTrail` | `GetAuditTrailActor` (`MemberActor`) | `GetAuditTrailRequest`: space, optional target reference, and page | `GetAuditTrailResult`: visibility-filtered content-free audit entries | `GetAuditTrailError`: invalid request, forbidden/not found, internal failure |

## 5. Result and error envelope

Operation definitions export separate schemas rather than a transport-specific HTTP envelope. A route adapter may serialize either the operation result or a `ContractError`; it must not add an implicit success state.

```ts
type TransportResult<Result, Error> =
  | { readonly ok: true; readonly result: Result }
  | { readonly ok: false; readonly error: Error };
```

HTTP status mapping is integration-owned, but it must preserve non-enumeration: a guessed target that is absent and a target the actor cannot see may both map to the same `not_found` response.

## 6. Event and audit contract

Domain events contain IDs and structured state facts, not message or evidence content. The public event union includes:

- `private_message.created`
- `signal_draft.created`
- `consent.decided`
- `shared_signal.confirmed`
- `task_attribution.corrected`
- `handover.transitioned`
- `handover.accepted`
- `care_rule.confirmed`
- `care_event.transitioned`
- `evidence.deleted`
- `analysis_consent.revoked`
- `personal_data.exported`
- `space.deleted`

Each event has `eventId`, `eventType`, `spaceId`, `occurredAt`, `actor`, `correlationId`, nullable `causationId`, nullable `idempotencyKey`, and a type-specific payload. `space.deleted` contains only the ephemeral receipt ID and deletion time; it is not persisted after the cascade.

Audit entries are in-space data. They include actor/target references, action, versions, structured changed field names, time, and visibility. A `resolution` change must use the dedicated bounded resolution audit value; the generic state/string value cannot be paired with that field. Audit changes never contain private message text, raw evidence, free-form care content, model input/output, secret values, or arbitrary error payloads. Space deletion removes them with every other in-space record.

## 7. Handover transition contract

| From | Allowed destinations | Required guard |
| --- | --- | --- |
| `draft` | `proposed` | source actor owns the domain; recipient differs from source |
| `proposed` | `blocked` | at least one required operational item is missing |
| `proposed` | `awaiting_confirmations` | packet is complete |
| `blocked` | `awaiting_confirmations` | all required items are resolved |
| `blocked` | `declined`, `expired` | involved member declines, or deterministic expiry time is reached |
| `awaiting_confirmations` | `accepted` | information complete; independent source and recipient confirmations exist; atomic migration succeeds |
| `awaiting_confirmations` | `declined`, `expired` | involved member declines, or deterministic expiry time is reached |
| `accepted`, `declined`, `expired` | none | terminal |

Every unlisted pair is an explicit denied row in `HANDOVER_TRANSITION_TABLE`, including same-state writes. An exact idempotent replay returns the original result without attempting a state transition.

## 8. Care transition contract

| From | Allowed destinations | Required guard |
| --- | --- | --- |
| `scheduled` | `notified`, `unresolved` | confirmed active rule and due time; unresolved only after a deterministic delivery/recipient terminal failure |
| `notified` | `acknowledged`, `timed_out`, `closed`, `unresolved` | server `now` strictly before the deadline, server `now` at or after the deadline, no acknowledgement required, or retry policy exhausted |
| `timed_out` | `escalated`, `unresolved` | next confirmed escalation target exists, otherwise unresolved |
| `escalated` | `escalated`, `acknowledged`, `handled`, `unresolved` | next level, late subject acknowledgement, authorized human handling, or terminal exhaustion |
| `acknowledged` | `closed` | acknowledgement audit persisted |
| `handled` | `closed` | handling audit persisted and both `handledAt` and `resolution` are preserved |
| `closed`, `unresolved` | none | terminal |

Every unlisted pair is denied. The `escalated -> escalated` row requires a strictly increasing escalation level and a new level-scoped idempotency key.

### Authoritative care command time

`AcknowledgeCareEvent` and `HandleCareEvent` sample the injected server `Clock.now()` exactly once per non-replayed execution. Caller-supplied `acknowledgedAt` and `handledAt` keys are unknown fields and fail strict request validation. The sampled instant is the sole time used for the transition decision, acknowledgement deadline comparison where applicable, persisted `acknowledgedAt` or `handledAt`, idempotency claim time, domain-event time, and audit `occurredAt`; a replay returns the originally persisted result and times.

A notified event can be acknowledged on time only when `now < acknowledgementDeadline`. Equality belongs to the timeout side: `now >= acknowledgementDeadline` cannot produce a timely acknowledgement and permits the deterministic `timed_out` transition. The existing `escalated -> acknowledged` path remains an explicitly late acknowledgement and is never reclassified as timely.

### Persisted care resolution

New handling requests may select only `confirmed_safe`, `in_person_check_started`, or `professional_help_contacted`. A handled event requires exactly one persisted resolution, and closing it must copy that resolution unchanged. `legacy_unknown` is a bounded compatibility value for migrated pre-correction handled or handled-then-closed rows; it is visible when reading history but is rejected by `HandleCareEventRequestSchema` and cannot be written by a new handling command. Closed events that were never handled carry `handledAt: null` and `resolution: null`.

## 9. Privacy operations

### Evidence deletion

`DeleteEvidenceResult` returns affected IDs and records these deterministic effects:

1. delete the raw evidence;
2. set dependent signals to `evidence_missing`;
3. set dependent tasks and domains to `needs_review`;
4. exclude affected tasks/domains from future reports;
5. preserve accepted handover history and current owner;
6. append one in-space audit fact while the space exists.

### Consent revocation

`RevokeAnalysisConsent` disables future AI analysis for that member. It does not delete prior authorized shared signals, rewrite audit history, or imply evidence deletion.

### Personal export

The export contains the actor's private messages/evidence plus shared records the actor can currently see. It excludes other members' raw evidence, provider telemetry content, secret/runtime values, and hidden shared scopes.

### Space deletion

`DeleteSpace` requires the space creator and exact confirmation. The transaction removes spaces, members, conversations, messages, evidence, signals, consent records, domains, tasks, handovers, reminders, care rules/events, exports, and audit entries. The response is ephemeral and contains no name, member, message, evidence, or derived content.

## 10. Schema examples

`packages/contracts/src/examples.ts` exports fictional, stable examples for all commands and queries plus handled/closed persistence examples and representative invalid/failure outcomes. The examples cover valid acknowledgement, handling, and closure; rejection of caller acknowledgement/handling timestamps; missing and invalid resolution; and migrated `legacy_unknown` history. `packages/contracts/tests/contracts.test.ts` parses every operation example through the registry and every care/audit schema example through its public schema. No example contains a real person, address, account, credential, medical diagnosis, or copied private content.
