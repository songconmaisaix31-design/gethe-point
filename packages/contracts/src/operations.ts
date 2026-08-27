import { z } from "zod";

import {
  CareSchedulerActorSchema,
  HandoverExpiryActorSchema,
  HandoverServiceActorSchema,
  MemberActorSchema,
  type CareSchedulerActor,
  type HandoverExpiryActor,
  type HandoverServiceActor,
  type MemberActor,
} from "./actors";
import {
  AcceptedHandoverSchema,
  AcknowledgedCareEventSchema,
  ActiveCareRuleSchema,
  ActiveShareConsentSchema,
  AwaitingConfirmationsHandoverSchema,
  BlockedHandoverSchema,
  CareEventSchema,
  CareScheduleSchema,
  DeclinedHandoverSchema,
  DiscardedConsentSchema,
  DomainWithEvidenceSchema,
  EscalationStepSchema,
  ExpiredHandoverSchema,
  ExportBundleSchema,
  HandoverMissingInfoSchema,
  HandoverPacketSchema,
  HandleCareEventResolutionSchema,
  NewHandledCareEventSchema,
  PrivateConversationPageSchema,
  PrivateMessageSchema,
  ProposedHandoverSchema,
  ResponsibilityAttributionSchema,
  ResponsibilityReportSchema,
  SharedSignalSchema,
  SharedVisibilitySchema,
  SignalDraftSchema,
  TaskSchema,
} from "./entities";
import type { ContractError, ContractErrorCode } from "./errors";
import { ContractErrorSchema } from "./errors";
import { AuditEntrySchema } from "./events";
import {
  AIExecutionMetadataSchema,
  NeedsHumanReviewSchema,
} from "./ports";
import {
  DetailTextSchema,
  EntityIdSchema,
  IdempotencyKeySchema,
  PageInfoSchema,
  PageRequestSchema,
  PrivateContentSchema,
  RecordVersionSchema,
  RequestIdSchema,
  ShortTextSchema,
  TargetReferenceSchema,
  TimeRangeSchema,
  TimestampSchema,
} from "./primitives";

export interface OperationContractDefinition {
  readonly kind: "command" | "query";
  readonly name: string;
  readonly actorSchema: z.ZodType;
  readonly requestSchema: z.ZodType;
  readonly resultSchema: z.ZodType;
  readonly errorSchema: typeof ContractErrorSchema;
  readonly errorCodes: readonly ContractErrorCode[];
}

const defineOperation = <const Definition extends OperationContractDefinition>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    errorSchema: ContractErrorSchema.extend({
      code: z.enum(definition.errorCodes),
    }),
  });

type ErrorFromCodes<Codes extends readonly ContractErrorCode[]> = ContractError<
  Codes[number]
>;

const RequestContextSchema = z.strictObject({ requestId: RequestIdSchema });
const IdempotentRequestContextSchema = RequestContextSchema.extend({
  idempotencyKey: IdempotencyKeySchema,
});

const BASIC_MEMBER_MUTATION_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

const STATEFUL_MUTATION_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_version",
  "transition_denied",
  "terminal_state",
  "idempotency_conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

const QUERY_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

export const CreatePrivateMessageRequestSchema = RequestContextSchema.extend({
  conversationId: EntityIdSchema,
  clientMessageId: EntityIdSchema,
  content: PrivateContentSchema,
  occurredAt: TimestampSchema,
});
export type CreatePrivateMessageRequest = z.infer<
  typeof CreatePrivateMessageRequestSchema
>;
export type CreatePrivateMessageActor = MemberActor;

export const CreatePrivateMessageResultSchema = z.strictObject({
  status: z.literal("created"),
  message: PrivateMessageSchema,
});
export type CreatePrivateMessageResult = z.infer<
  typeof CreatePrivateMessageResultSchema
>;
export type CreatePrivateMessageError = ErrorFromCodes<
  typeof BASIC_MEMBER_MUTATION_ERRORS
>;

export const CreatePrivateMessageContract = defineOperation({
  kind: "command",
  name: "CreatePrivateMessage",
  actorSchema: MemberActorSchema,
  requestSchema: CreatePrivateMessageRequestSchema,
  resultSchema: CreatePrivateMessageResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: BASIC_MEMBER_MUTATION_ERRORS,
});

export const CreateSignalDraftRequestSchema = RequestContextSchema.extend({
  privateMessageId: EntityIdSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(10),
  purpose: z.literal("signal_draft"),
  promptVersion: z.string().min(1).max(80),
});
export type CreateSignalDraftRequest = z.infer<
  typeof CreateSignalDraftRequestSchema
>;
export type CreateSignalDraftActor = MemberActor;

export const CreateSignalDraftResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("draft_created"),
    draft: SignalDraftSchema,
    metadata: AIExecutionMetadataSchema,
  }),
  NeedsHumanReviewSchema,
]);
export type CreateSignalDraftResult = z.infer<
  typeof CreateSignalDraftResultSchema
>;

const CREATE_SIGNAL_DRAFT_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "provider_timeout",
  "provider_invalid_output",
  "provider_unavailable",
  "needs_human_review",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];
export type CreateSignalDraftError = ErrorFromCodes<
  typeof CREATE_SIGNAL_DRAFT_ERRORS
>;

export const CreateSignalDraftContract = defineOperation({
  kind: "command",
  name: "CreateSignalDraft",
  actorSchema: MemberActorSchema,
  requestSchema: CreateSignalDraftRequestSchema,
  resultSchema: CreateSignalDraftResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: CREATE_SIGNAL_DRAFT_ERRORS,
});

export const DecideConsentRequestSchema = z.discriminatedUnion("decision", [
  RequestContextSchema.extend({
    signalDraftId: EntityIdSchema,
    decision: z.literal("share"),
    visibility: SharedVisibilitySchema,
    decidedAt: TimestampSchema,
    expiresAt: TimestampSchema.nullable(),
  }),
  RequestContextSchema.extend({
    signalDraftId: EntityIdSchema,
    decision: z.literal("discard"),
    visibility: z.null(),
    decidedAt: TimestampSchema,
    expiresAt: z.null(),
  }),
]);
export type DecideConsentRequest = z.infer<typeof DecideConsentRequestSchema>;
export type DecideConsentActor = MemberActor;

export const DecideConsentResultSchema = z.strictObject({
  status: z.literal("decision_recorded"),
  decision: z.union([ActiveShareConsentSchema, DiscardedConsentSchema]),
});
export type DecideConsentResult = z.infer<typeof DecideConsentResultSchema>;

const DECIDE_CONSENT_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "consent_invalid",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];
export type DecideConsentError = ErrorFromCodes<typeof DECIDE_CONSENT_ERRORS>;

export const DecideConsentContract = defineOperation({
  kind: "command",
  name: "DecideConsent",
  actorSchema: MemberActorSchema,
  requestSchema: DecideConsentRequestSchema,
  resultSchema: DecideConsentResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: DECIDE_CONSENT_ERRORS,
});

export const ConfirmSignalRequestSchema = IdempotentRequestContextSchema.extend({
  signalDraftId: EntityIdSchema,
  consentDecisionId: EntityIdSchema,
  expectedDraftVersion: RecordVersionSchema,
});
export type ConfirmSignalRequest = z.infer<typeof ConfirmSignalRequestSchema>;
export type ConfirmSignalActor = MemberActor;

export const ConfirmSignalResultSchema = z.strictObject({
  status: z.literal("confirmed"),
  signal: SharedSignalSchema,
});
export type ConfirmSignalResult = z.infer<typeof ConfirmSignalResultSchema>;

const CONFIRM_SIGNAL_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_version",
  "consent_required",
  "consent_invalid",
  "visibility_denied",
  "idempotency_conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];
export type ConfirmSignalError = ErrorFromCodes<typeof CONFIRM_SIGNAL_ERRORS>;

export const ConfirmSignalContract = defineOperation({
  kind: "command",
  name: "ConfirmSignal",
  actorSchema: MemberActorSchema,
  requestSchema: ConfirmSignalRequestSchema,
  resultSchema: ConfirmSignalResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: CONFIRM_SIGNAL_ERRORS,
});

export const CorrectTaskAttributionRequestSchema =
  IdempotentRequestContextSchema.extend({
    taskId: EntityIdSchema,
    attribution: ResponsibilityAttributionSchema,
    reason: DetailTextSchema,
    expectedVersion: RecordVersionSchema,
  });
export type CorrectTaskAttributionRequest = z.infer<
  typeof CorrectTaskAttributionRequestSchema
>;
export type CorrectTaskAttributionActor = MemberActor;

export const CorrectTaskAttributionResultSchema = z.strictObject({
  status: z.literal("corrected"),
  task: TaskSchema,
  auditEntryId: EntityIdSchema,
});
export type CorrectTaskAttributionResult = z.infer<
  typeof CorrectTaskAttributionResultSchema
>;

const CORRECT_TASK_ATTRIBUTION_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "evidence_missing",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type CorrectTaskAttributionError = ErrorFromCodes<
  typeof CORRECT_TASK_ATTRIBUTION_ERRORS
>;

export const CorrectTaskAttributionContract = defineOperation({
  kind: "command",
  name: "CorrectTaskAttribution",
  actorSchema: MemberActorSchema,
  requestSchema: CorrectTaskAttributionRequestSchema,
  resultSchema: CorrectTaskAttributionResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: CORRECT_TASK_ATTRIBUTION_ERRORS,
});

export const ProposeHandoverRequestSchema =
  IdempotentRequestContextSchema.extend({
    domainId: EntityIdSchema,
    toMemberId: EntityIdSchema,
    packet: HandoverPacketSchema,
    missingInfo: z.array(HandoverMissingInfoSchema).max(20),
    expiresAt: TimestampSchema,
    expectedDomainVersion: RecordVersionSchema,
  });
export type ProposeHandoverRequest = z.infer<
  typeof ProposeHandoverRequestSchema
>;
export type ProposeHandoverActor = MemberActor;

export const ProposeHandoverResultSchema = z.strictObject({
  status: z.literal("proposal_recorded"),
  handover: z.union([
    BlockedHandoverSchema,
    AwaitingConfirmationsHandoverSchema,
  ]),
});
export type ProposeHandoverResult = z.infer<
  typeof ProposeHandoverResultSchema
>;

const PROPOSE_HANDOVER_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "visibility_denied",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type ProposeHandoverError = ErrorFromCodes<
  typeof PROPOSE_HANDOVER_ERRORS
>;

export const ProposeHandoverContract = defineOperation({
  kind: "command",
  name: "ProposeHandover",
  actorSchema: MemberActorSchema,
  requestSchema: ProposeHandoverRequestSchema,
  resultSchema: ProposeHandoverResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: PROPOSE_HANDOVER_ERRORS,
});

export const HandoverResolvedItemSchema = z.strictObject({
  missingInfoId: EntityIdSchema,
  value: DetailTextSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(10),
});
export type HandoverResolvedItem = z.infer<
  typeof HandoverResolvedItemSchema
>;

export const SupplyHandoverInfoRequestSchema =
  IdempotentRequestContextSchema.extend({
    handoverId: EntityIdSchema,
    resolvedItems: z.array(HandoverResolvedItemSchema).min(1).max(20),
    expectedVersion: RecordVersionSchema,
  });
export type SupplyHandoverInfoRequest = z.infer<
  typeof SupplyHandoverInfoRequestSchema
>;
export type SupplyHandoverInfoActor = MemberActor;

export const SupplyHandoverInfoResultSchema = z.strictObject({
  status: z.literal("information_recorded"),
  handover: z.union([
    BlockedHandoverSchema,
    AwaitingConfirmationsHandoverSchema,
  ]),
});
export type SupplyHandoverInfoResult = z.infer<
  typeof SupplyHandoverInfoResultSchema
>;
export type SupplyHandoverInfoError = ErrorFromCodes<
  typeof STATEFUL_MUTATION_ERRORS
>;

export const SupplyHandoverInfoContract = defineOperation({
  kind: "command",
  name: "SupplyHandoverInfo",
  actorSchema: MemberActorSchema,
  requestSchema: SupplyHandoverInfoRequestSchema,
  resultSchema: SupplyHandoverInfoResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: STATEFUL_MUTATION_ERRORS,
});

const HandoverConfirmationRequestSchema = IdempotentRequestContextSchema.extend({
  handoverId: EntityIdSchema,
  confirmedAt: TimestampSchema,
  expectedVersion: RecordVersionSchema,
});

const HandoverFromConfirmationResultSchema = z.strictObject({
  status: z.literal("confirmation_recorded"),
  handover: AwaitingConfirmationsHandoverSchema.extend({
    fromConfirmedAt: TimestampSchema,
  }),
});

const HandoverToConfirmationResultSchema = z.strictObject({
  status: z.literal("confirmation_recorded"),
  handover: AwaitingConfirmationsHandoverSchema.extend({
    toConfirmedAt: TimestampSchema,
  }),
});

const HANDOVER_CONFIRMATION_ERRORS = [
  ...STATEFUL_MUTATION_ERRORS,
  "handover_blocked",
] as const satisfies readonly ContractErrorCode[];

export const ConfirmHandoverFromRequestSchema =
  HandoverConfirmationRequestSchema;
export type ConfirmHandoverFromRequest = z.infer<
  typeof ConfirmHandoverFromRequestSchema
>;
export type ConfirmHandoverFromActor = MemberActor;
export const ConfirmHandoverFromResultSchema =
  HandoverFromConfirmationResultSchema;
export type ConfirmHandoverFromResult = z.infer<
  typeof ConfirmHandoverFromResultSchema
>;
export type ConfirmHandoverFromError = ErrorFromCodes<
  typeof HANDOVER_CONFIRMATION_ERRORS
>;

export const ConfirmHandoverFromContract = defineOperation({
  kind: "command",
  name: "ConfirmHandoverFrom",
  actorSchema: MemberActorSchema,
  requestSchema: ConfirmHandoverFromRequestSchema,
  resultSchema: ConfirmHandoverFromResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: HANDOVER_CONFIRMATION_ERRORS,
});

export const ConfirmHandoverToRequestSchema = HandoverConfirmationRequestSchema;
export type ConfirmHandoverToRequest = z.infer<
  typeof ConfirmHandoverToRequestSchema
>;
export type ConfirmHandoverToActor = MemberActor;
export const ConfirmHandoverToResultSchema = HandoverToConfirmationResultSchema;
export type ConfirmHandoverToResult = z.infer<
  typeof ConfirmHandoverToResultSchema
>;
export type ConfirmHandoverToError = ErrorFromCodes<
  typeof HANDOVER_CONFIRMATION_ERRORS
>;

export const ConfirmHandoverToContract = defineOperation({
  kind: "command",
  name: "ConfirmHandoverTo",
  actorSchema: MemberActorSchema,
  requestSchema: ConfirmHandoverToRequestSchema,
  resultSchema: ConfirmHandoverToResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: HANDOVER_CONFIRMATION_ERRORS,
});

export const AcceptHandoverRequestSchema = IdempotentRequestContextSchema.extend({
  handoverId: EntityIdSchema,
  expectedHandoverVersion: RecordVersionSchema,
  expectedDomainVersion: RecordVersionSchema,
});
export type AcceptHandoverRequest = z.infer<
  typeof AcceptHandoverRequestSchema
>;
export type AcceptHandoverActor = HandoverServiceActor;

export const HandoverMigrationReceiptSchema = z.strictObject({
  domainId: EntityIdSchema,
  previousOwnerId: EntityIdSchema,
  newOwnerId: EntityIdSchema,
  futureTaskDefaultsUpdated: z.literal(true),
  migratedReminderIds: z.array(EntityIdSchema),
  auditEntryId: EntityIdSchema,
});
export type HandoverMigrationReceipt = z.infer<
  typeof HandoverMigrationReceiptSchema
>;

export const AcceptHandoverResultSchema = z.strictObject({
  status: z.literal("accepted"),
  handover: AcceptedHandoverSchema,
  migration: HandoverMigrationReceiptSchema,
});
export type AcceptHandoverResult = z.infer<
  typeof AcceptHandoverResultSchema
>;

const ACCEPT_HANDOVER_ERRORS = [
  ...STATEFUL_MUTATION_ERRORS,
  "handover_blocked",
  "confirmation_required",
] as const satisfies readonly ContractErrorCode[];
export type AcceptHandoverError = ErrorFromCodes<
  typeof ACCEPT_HANDOVER_ERRORS
>;

export const AcceptHandoverContract = defineOperation({
  kind: "command",
  name: "AcceptHandover",
  actorSchema: HandoverServiceActorSchema,
  requestSchema: AcceptHandoverRequestSchema,
  resultSchema: AcceptHandoverResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: ACCEPT_HANDOVER_ERRORS,
});

export const DeclineHandoverRequestSchema =
  IdempotentRequestContextSchema.extend({
    handoverId: EntityIdSchema,
    reason: DetailTextSchema,
    declinedAt: TimestampSchema,
    expectedVersion: RecordVersionSchema,
  });
export type DeclineHandoverRequest = z.infer<
  typeof DeclineHandoverRequestSchema
>;
export type DeclineHandoverActor = MemberActor;

export const DeclineHandoverResultSchema = z.strictObject({
  status: z.literal("declined"),
  handover: DeclinedHandoverSchema,
});
export type DeclineHandoverResult = z.infer<
  typeof DeclineHandoverResultSchema
>;
export type DeclineHandoverError = ErrorFromCodes<
  typeof STATEFUL_MUTATION_ERRORS
>;

export const DeclineHandoverContract = defineOperation({
  kind: "command",
  name: "DeclineHandover",
  actorSchema: MemberActorSchema,
  requestSchema: DeclineHandoverRequestSchema,
  resultSchema: DeclineHandoverResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: STATEFUL_MUTATION_ERRORS,
});

export const ExpireHandoverRequestSchema =
  IdempotentRequestContextSchema.extend({
    handoverId: EntityIdSchema,
    observedAt: TimestampSchema,
    expectedVersion: RecordVersionSchema,
  });
export type ExpireHandoverRequest = z.infer<
  typeof ExpireHandoverRequestSchema
>;
export type ExpireHandoverActor = HandoverExpiryActor;

export const ExpireHandoverResultSchema = z.strictObject({
  status: z.literal("expired"),
  handover: ExpiredHandoverSchema,
});
export type ExpireHandoverResult = z.infer<
  typeof ExpireHandoverResultSchema
>;
export type ExpireHandoverError = ErrorFromCodes<
  typeof STATEFUL_MUTATION_ERRORS
>;

export const ExpireHandoverContract = defineOperation({
  kind: "command",
  name: "ExpireHandover",
  actorSchema: HandoverExpiryActorSchema,
  requestSchema: ExpireHandoverRequestSchema,
  resultSchema: ExpireHandoverResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: STATEFUL_MUTATION_ERRORS,
});

export const ConfirmCareRuleRequestSchema =
  IdempotentRequestContextSchema.extend({
    careRuleId: EntityIdSchema,
    schedule: CareScheduleSchema,
    requireAck: z.boolean(),
    ackTimeoutSec: z.number().int().min(1).max(86_400),
    escalationChain: z.array(EscalationStepSchema).min(1).max(10),
    terminalBehavior: z.enum([
      "close_on_ack",
      "close_on_handle",
      "unresolved_after_chain",
    ]),
    confirmedAt: TimestampSchema,
    expectedVersion: RecordVersionSchema,
  });
export type ConfirmCareRuleRequest = z.infer<
  typeof ConfirmCareRuleRequestSchema
>;
export type ConfirmCareRuleActor = MemberActor;

export const ConfirmCareRuleResultSchema = z.strictObject({
  status: z.literal("active"),
  careRule: ActiveCareRuleSchema,
});
export type ConfirmCareRuleResult = z.infer<
  typeof ConfirmCareRuleResultSchema
>;

const CONFIRM_CARE_RULE_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "evidence_missing",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type ConfirmCareRuleError = ErrorFromCodes<
  typeof CONFIRM_CARE_RULE_ERRORS
>;

export const ConfirmCareRuleContract = defineOperation({
  kind: "command",
  name: "ConfirmCareRule",
  actorSchema: MemberActorSchema,
  requestSchema: ConfirmCareRuleRequestSchema,
  resultSchema: ConfirmCareRuleResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: CONFIRM_CARE_RULE_ERRORS,
});

export const TickCareSchedulerRequestSchema =
  IdempotentRequestContextSchema.extend({
    observedAt: TimestampSchema,
    batchSize: z.number().int().min(1).max(100),
  });
export type TickCareSchedulerRequest = z.infer<
  typeof TickCareSchedulerRequestSchema
>;
export type TickCareSchedulerActor = CareSchedulerActor;

export const NotificationIntentSchema = z.strictObject({
  id: EntityIdSchema,
  careEventId: EntityIdSchema,
  targetMemberId: EntityIdSchema,
  channel: z.literal("agent_dm"),
  escalationLevel: z.number().int().nonnegative().max(10),
  idempotencyKey: IdempotencyKeySchema,
  status: z.enum(["pending", "already_recorded"]),
});
export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;

export const TickCareSchedulerResultSchema = z.strictObject({
  status: z.literal("processed"),
  replayed: z.boolean(),
  events: z.array(CareEventSchema).max(100),
  notificationIntents: z.array(NotificationIntentSchema).max(300),
});
export type TickCareSchedulerResult = z.infer<
  typeof TickCareSchedulerResultSchema
>;

const TICK_CARE_SCHEDULER_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "care_rule_inactive",
  "idempotency_conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];
export type TickCareSchedulerError = ErrorFromCodes<
  typeof TICK_CARE_SCHEDULER_ERRORS
>;

export const TickCareSchedulerContract = defineOperation({
  kind: "command",
  name: "TickCareScheduler",
  actorSchema: CareSchedulerActorSchema,
  requestSchema: TickCareSchedulerRequestSchema,
  resultSchema: TickCareSchedulerResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: TICK_CARE_SCHEDULER_ERRORS,
});

export const AcknowledgeCareEventRequestSchema =
  IdempotentRequestContextSchema.extend({
    careEventId: EntityIdSchema,
    expectedVersion: RecordVersionSchema,
  });
export type AcknowledgeCareEventRequest = z.infer<
  typeof AcknowledgeCareEventRequestSchema
>;
export type AcknowledgeCareEventActor = MemberActor;

export const AcknowledgeCareEventResultSchema = z.strictObject({
  status: z.literal("acknowledged"),
  careEvent: AcknowledgedCareEventSchema,
});
export type AcknowledgeCareEventResult = z.infer<
  typeof AcknowledgeCareEventResultSchema
>;
export type AcknowledgeCareEventError = ErrorFromCodes<
  typeof STATEFUL_MUTATION_ERRORS
>;

export const AcknowledgeCareEventContract = defineOperation({
  kind: "command",
  name: "AcknowledgeCareEvent",
  actorSchema: MemberActorSchema,
  requestSchema: AcknowledgeCareEventRequestSchema,
  resultSchema: AcknowledgeCareEventResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: STATEFUL_MUTATION_ERRORS,
});

export const HandleCareEventRequestSchema =
  IdempotentRequestContextSchema.extend({
    careEventId: EntityIdSchema,
    resolution: HandleCareEventResolutionSchema,
    expectedVersion: RecordVersionSchema,
  });
export type HandleCareEventRequest = z.infer<
  typeof HandleCareEventRequestSchema
>;
export type HandleCareEventActor = MemberActor;

export const HandleCareEventResultSchema = z.strictObject({
  status: z.literal("handled"),
  careEvent: NewHandledCareEventSchema,
});
export type HandleCareEventResult = z.infer<
  typeof HandleCareEventResultSchema
>;
export type HandleCareEventError = ErrorFromCodes<
  typeof STATEFUL_MUTATION_ERRORS
>;

export const HandleCareEventContract = defineOperation({
  kind: "command",
  name: "HandleCareEvent",
  actorSchema: MemberActorSchema,
  requestSchema: HandleCareEventRequestSchema,
  resultSchema: HandleCareEventResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: STATEFUL_MUTATION_ERRORS,
});

export const DeleteEvidenceRequestSchema =
  IdempotentRequestContextSchema.extend({
    evidenceId: EntityIdSchema,
    expectedVersion: RecordVersionSchema,
  });
export type DeleteEvidenceRequest = z.infer<
  typeof DeleteEvidenceRequestSchema
>;
export type DeleteEvidenceActor = MemberActor;

export const EvidenceDeletionReceiptSchema = z.strictObject({
  evidenceId: EntityIdSchema,
  invalidatedSignalIds: z.array(EntityIdSchema),
  needsReviewTaskIds: z.array(EntityIdSchema),
  needsReviewDomainIds: z.array(EntityIdSchema),
  preservedAcceptedHandoverIds: z.array(EntityIdSchema),
  excludedFromFutureReports: z.literal(true),
  acceptedHandoversReversed: z.literal(false),
  auditEntryId: EntityIdSchema,
});
export type EvidenceDeletionReceipt = z.infer<
  typeof EvidenceDeletionReceiptSchema
>;

export const DeleteEvidenceResultSchema = z.strictObject({
  status: z.literal("deleted"),
  receipt: EvidenceDeletionReceiptSchema,
});
export type DeleteEvidenceResult = z.infer<
  typeof DeleteEvidenceResultSchema
>;

const DELETE_EVIDENCE_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type DeleteEvidenceError = ErrorFromCodes<
  typeof DELETE_EVIDENCE_ERRORS
>;

export const DeleteEvidenceContract = defineOperation({
  kind: "command",
  name: "DeleteEvidence",
  actorSchema: MemberActorSchema,
  requestSchema: DeleteEvidenceRequestSchema,
  resultSchema: DeleteEvidenceResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: DELETE_EVIDENCE_ERRORS,
});

export const RevokeAnalysisConsentRequestSchema =
  IdempotentRequestContextSchema.extend({
    effectiveAt: TimestampSchema,
    expectedMemberVersion: RecordVersionSchema,
  });
export type RevokeAnalysisConsentRequest = z.infer<
  typeof RevokeAnalysisConsentRequestSchema
>;
export type RevokeAnalysisConsentActor = MemberActor;

export const RevokeAnalysisConsentResultSchema = z.strictObject({
  status: z.literal("revoked"),
  memberId: EntityIdSchema,
  effectiveAt: TimestampSchema,
  futureAnalysisEnabled: z.literal(false),
  priorAuthorizedEventsPreserved: z.literal(true),
  auditEntryId: EntityIdSchema,
});
export type RevokeAnalysisConsentResult = z.infer<
  typeof RevokeAnalysisConsentResultSchema
>;

const REVOKE_ANALYSIS_CONSENT_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type RevokeAnalysisConsentError = ErrorFromCodes<
  typeof REVOKE_ANALYSIS_CONSENT_ERRORS
>;

export const RevokeAnalysisConsentContract = defineOperation({
  kind: "command",
  name: "RevokeAnalysisConsent",
  actorSchema: MemberActorSchema,
  requestSchema: RevokeAnalysisConsentRequestSchema,
  resultSchema: RevokeAnalysisConsentResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: REVOKE_ANALYSIS_CONSENT_ERRORS,
});

export const ExportMyDataRequestSchema =
  IdempotentRequestContextSchema.extend({
    format: z.literal("json"),
    requestedAt: TimestampSchema,
  });
export type ExportMyDataRequest = z.infer<typeof ExportMyDataRequestSchema>;
export type ExportMyDataActor = MemberActor;

export const ExportMyDataResultSchema = z.strictObject({
  status: z.literal("exported"),
  exportId: EntityIdSchema,
  bundle: ExportBundleSchema,
  auditEntryId: EntityIdSchema,
});
export type ExportMyDataResult = z.infer<typeof ExportMyDataResultSchema>;

const EXPORT_MY_DATA_ERRORS = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "export_not_authorized",
  "idempotency_conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];
export type ExportMyDataError = ErrorFromCodes<typeof EXPORT_MY_DATA_ERRORS>;

export const ExportMyDataContract = defineOperation({
  kind: "command",
  name: "ExportMyData",
  actorSchema: MemberActorSchema,
  requestSchema: ExportMyDataRequestSchema,
  resultSchema: ExportMyDataResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: EXPORT_MY_DATA_ERRORS,
});

export const DeleteSpaceRequestSchema = IdempotentRequestContextSchema.extend({
  spaceId: EntityIdSchema,
  expectedSpaceName: ShortTextSchema,
  typedSpaceName: ShortTextSchema,
  expectedVersion: RecordVersionSchema,
}).refine(({ expectedSpaceName, typedSpaceName }) => expectedSpaceName === typedSpaceName, {
  message: "typedSpaceName must exactly match expectedSpaceName",
  path: ["typedSpaceName"],
});
export type DeleteSpaceRequest = z.infer<typeof DeleteSpaceRequestSchema>;
export type DeleteSpaceActor = MemberActor;

export const DeleteSpaceResultSchema = z.strictObject({
  status: z.literal("deleted"),
  deletionReceiptId: EntityIdSchema,
  deletedAt: TimestampSchema,
  persistedAfterDeletion: z.literal(false),
  containsProductContent: z.literal(false),
});
export type DeleteSpaceResult = z.infer<typeof DeleteSpaceResultSchema>;

const DELETE_SPACE_ERRORS = [
  ...BASIC_MEMBER_MUTATION_ERRORS,
  "stale_version",
  "deletion_confirmation_required",
  "idempotency_conflict",
] as const satisfies readonly ContractErrorCode[];
export type DeleteSpaceError = ErrorFromCodes<typeof DELETE_SPACE_ERRORS>;

export const DeleteSpaceContract = defineOperation({
  kind: "command",
  name: "DeleteSpace",
  actorSchema: MemberActorSchema,
  requestSchema: DeleteSpaceRequestSchema,
  resultSchema: DeleteSpaceResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: DELETE_SPACE_ERRORS,
});

export const GetRoleHomeRequestSchema = RequestContextSchema.extend({
  spaceId: EntityIdSchema,
});
export type GetRoleHomeRequest = z.infer<typeof GetRoleHomeRequestSchema>;
export type GetRoleHomeActor = MemberActor;

export const RoleHomeSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("primary"),
    dataMode: z.enum(["fixture", "runtime"]),
    rememberedItemCount: z.number().int().nonnegative(),
    domainIds: z.array(EntityIdSchema),
    pendingHandoverIds: z.array(EntityIdSchema),
    needsReviewCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    role: z.literal("partner"),
    dataMode: z.enum(["fixture", "runtime"]),
    ownedDomainIds: z.array(EntityIdSchema),
    pendingHandoverIds: z.array(EntityIdSchema),
    careInboxCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    role: z.literal("subject"),
    dataMode: z.enum(["fixture", "runtime"]),
    privateConversationId: EntityIdSchema,
    pendingCareEventIds: z.array(EntityIdSchema),
    oneStepAcknowledgement: z.literal(true),
  }),
]);
export type RoleHome = z.infer<typeof RoleHomeSchema>;

export const GetRoleHomeResultSchema = z.strictObject({
  status: z.literal("ready"),
  home: RoleHomeSchema,
});
export type GetRoleHomeResult = z.infer<typeof GetRoleHomeResultSchema>;
export type GetRoleHomeError = ErrorFromCodes<typeof QUERY_ERRORS>;

export const GetRoleHomeContract = defineOperation({
  kind: "query",
  name: "GetRoleHome",
  actorSchema: MemberActorSchema,
  requestSchema: GetRoleHomeRequestSchema,
  resultSchema: GetRoleHomeResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetPrivateConversationRequestSchema =
  RequestContextSchema.extend({
    conversationId: EntityIdSchema,
    page: PageRequestSchema,
  });
export type GetPrivateConversationRequest = z.infer<
  typeof GetPrivateConversationRequestSchema
>;
export type GetPrivateConversationActor = MemberActor;

export const GetPrivateConversationResultSchema = z.strictObject({
  status: z.literal("ready"),
  conversation: PrivateConversationPageSchema,
});
export type GetPrivateConversationResult = z.infer<
  typeof GetPrivateConversationResultSchema
>;
export type GetPrivateConversationError = ErrorFromCodes<typeof QUERY_ERRORS>;

export const GetPrivateConversationContract = defineOperation({
  kind: "query",
  name: "GetPrivateConversation",
  actorSchema: MemberActorSchema,
  requestSchema: GetPrivateConversationRequestSchema,
  resultSchema: GetPrivateConversationResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetVisibleSharedSignalsRequestSchema =
  RequestContextSchema.extend({
    spaceId: EntityIdSchema,
    page: PageRequestSchema,
  });
export type GetVisibleSharedSignalsRequest = z.infer<
  typeof GetVisibleSharedSignalsRequestSchema
>;
export type GetVisibleSharedSignalsActor = MemberActor;

export const GetVisibleSharedSignalsResultSchema = z.strictObject({
  status: z.literal("ready"),
  signals: z.array(SharedSignalSchema),
  page: PageInfoSchema,
});
export type GetVisibleSharedSignalsResult = z.infer<
  typeof GetVisibleSharedSignalsResultSchema
>;
export type GetVisibleSharedSignalsError = ErrorFromCodes<
  typeof QUERY_ERRORS
>;

export const GetVisibleSharedSignalsContract = defineOperation({
  kind: "query",
  name: "GetVisibleSharedSignals",
  actorSchema: MemberActorSchema,
  requestSchema: GetVisibleSharedSignalsRequestSchema,
  resultSchema: GetVisibleSharedSignalsResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetResponsibilityReportRequestSchema =
  RequestContextSchema.extend({
    spaceId: EntityIdSchema,
    period: TimeRangeSchema,
  });
export type GetResponsibilityReportRequest = z.infer<
  typeof GetResponsibilityReportRequestSchema
>;
export type GetResponsibilityReportActor = MemberActor;

export const GetResponsibilityReportResultSchema = z.strictObject({
  status: z.literal("ready"),
  report: ResponsibilityReportSchema,
});
export type GetResponsibilityReportResult = z.infer<
  typeof GetResponsibilityReportResultSchema
>;
export type GetResponsibilityReportError = ErrorFromCodes<
  typeof QUERY_ERRORS
>;

export const GetResponsibilityReportContract = defineOperation({
  kind: "query",
  name: "GetResponsibilityReport",
  actorSchema: MemberActorSchema,
  requestSchema: GetResponsibilityReportRequestSchema,
  resultSchema: GetResponsibilityReportResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetDomainWithEvidenceRequestSchema = RequestContextSchema.extend({
  domainId: EntityIdSchema,
});
export type GetDomainWithEvidenceRequest = z.infer<
  typeof GetDomainWithEvidenceRequestSchema
>;
export type GetDomainWithEvidenceActor = MemberActor;

export const GetDomainWithEvidenceResultSchema = z.strictObject({
  status: z.literal("ready"),
  domain: DomainWithEvidenceSchema,
});
export type GetDomainWithEvidenceResult = z.infer<
  typeof GetDomainWithEvidenceResultSchema
>;

const GET_DOMAIN_WITH_EVIDENCE_ERRORS = [
  ...QUERY_ERRORS,
  "visibility_denied",
] as const satisfies readonly ContractErrorCode[];
export type GetDomainWithEvidenceError = ErrorFromCodes<
  typeof GET_DOMAIN_WITH_EVIDENCE_ERRORS
>;

export const GetDomainWithEvidenceContract = defineOperation({
  kind: "query",
  name: "GetDomainWithEvidence",
  actorSchema: MemberActorSchema,
  requestSchema: GetDomainWithEvidenceRequestSchema,
  resultSchema: GetDomainWithEvidenceResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: GET_DOMAIN_WITH_EVIDENCE_ERRORS,
});

export const GetPendingHandoversRequestSchema = RequestContextSchema.extend({
  spaceId: EntityIdSchema,
  page: PageRequestSchema,
});
export type GetPendingHandoversRequest = z.infer<
  typeof GetPendingHandoversRequestSchema
>;
export type GetPendingHandoversActor = MemberActor;

export const PendingHandoverSchema = z.union([
  ProposedHandoverSchema,
  BlockedHandoverSchema,
  AwaitingConfirmationsHandoverSchema,
]);

export const GetPendingHandoversResultSchema = z.strictObject({
  status: z.literal("ready"),
  handovers: z.array(PendingHandoverSchema),
  page: PageInfoSchema,
});
export type GetPendingHandoversResult = z.infer<
  typeof GetPendingHandoversResultSchema
>;
export type GetPendingHandoversError = ErrorFromCodes<typeof QUERY_ERRORS>;

export const GetPendingHandoversContract = defineOperation({
  kind: "query",
  name: "GetPendingHandovers",
  actorSchema: MemberActorSchema,
  requestSchema: GetPendingHandoversRequestSchema,
  resultSchema: GetPendingHandoversResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetCareInboxRequestSchema = RequestContextSchema.extend({
  spaceId: EntityIdSchema,
  page: PageRequestSchema,
});
export type GetCareInboxRequest = z.infer<typeof GetCareInboxRequestSchema>;
export type GetCareInboxActor = MemberActor;

export const GetCareInboxResultSchema = z.strictObject({
  status: z.literal("ready"),
  events: z.array(CareEventSchema),
  page: PageInfoSchema,
});
export type GetCareInboxResult = z.infer<typeof GetCareInboxResultSchema>;
export type GetCareInboxError = ErrorFromCodes<typeof QUERY_ERRORS>;

export const GetCareInboxContract = defineOperation({
  kind: "query",
  name: "GetCareInbox",
  actorSchema: MemberActorSchema,
  requestSchema: GetCareInboxRequestSchema,
  resultSchema: GetCareInboxResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const GetAuditTrailRequestSchema = RequestContextSchema.extend({
  spaceId: EntityIdSchema,
  target: TargetReferenceSchema.nullable(),
  page: PageRequestSchema,
});
export type GetAuditTrailRequest = z.infer<
  typeof GetAuditTrailRequestSchema
>;
export type GetAuditTrailActor = MemberActor;

export const GetAuditTrailResultSchema = z.strictObject({
  status: z.literal("ready"),
  entries: z.array(AuditEntrySchema),
  page: PageInfoSchema,
});
export type GetAuditTrailResult = z.infer<typeof GetAuditTrailResultSchema>;
export type GetAuditTrailError = ErrorFromCodes<typeof QUERY_ERRORS>;

export const GetAuditTrailContract = defineOperation({
  kind: "query",
  name: "GetAuditTrail",
  actorSchema: MemberActorSchema,
  requestSchema: GetAuditTrailRequestSchema,
  resultSchema: GetAuditTrailResultSchema,
  errorSchema: ContractErrorSchema,
  errorCodes: QUERY_ERRORS,
});

export const ADR_COMMAND_NAMES = [
  "CreatePrivateMessage",
  "CreateSignalDraft",
  "DecideConsent",
  "ConfirmSignal",
  "CorrectTaskAttribution",
  "ProposeHandover",
  "SupplyHandoverInfo",
  "ConfirmHandoverFrom",
  "ConfirmHandoverTo",
  "AcceptHandover",
  "ConfirmCareRule",
  "TickCareScheduler",
  "AcknowledgeCareEvent",
  "HandleCareEvent",
  "DeleteEvidence",
  "RevokeAnalysisConsent",
  "ExportMyData",
  "DeleteSpace",
] as const;

export const HANDOVER_COMPLETENESS_COMMAND_NAMES = [
  "DeclineHandover",
  "ExpireHandover",
] as const;

export const ADR_QUERY_NAMES = [
  "GetRoleHome",
  "GetPrivateConversation",
  "GetVisibleSharedSignals",
  "GetResponsibilityReport",
  "GetDomainWithEvidence",
  "GetPendingHandovers",
  "GetCareInbox",
  "GetAuditTrail",
] as const;

export const COMMAND_CONTRACTS = [
  CreatePrivateMessageContract,
  CreateSignalDraftContract,
  DecideConsentContract,
  ConfirmSignalContract,
  CorrectTaskAttributionContract,
  ProposeHandoverContract,
  SupplyHandoverInfoContract,
  ConfirmHandoverFromContract,
  ConfirmHandoverToContract,
  AcceptHandoverContract,
  ConfirmCareRuleContract,
  TickCareSchedulerContract,
  AcknowledgeCareEventContract,
  HandleCareEventContract,
  DeleteEvidenceContract,
  RevokeAnalysisConsentContract,
  ExportMyDataContract,
  DeleteSpaceContract,
  DeclineHandoverContract,
  ExpireHandoverContract,
] as const satisfies readonly OperationContractDefinition[];

export const QUERY_CONTRACTS = [
  GetRoleHomeContract,
  GetPrivateConversationContract,
  GetVisibleSharedSignalsContract,
  GetResponsibilityReportContract,
  GetDomainWithEvidenceContract,
  GetPendingHandoversContract,
  GetCareInboxContract,
  GetAuditTrailContract,
] as const satisfies readonly OperationContractDefinition[];

export const ALL_OPERATION_CONTRACTS = [
  ...COMMAND_CONTRACTS,
  ...QUERY_CONTRACTS,
] as const satisfies readonly OperationContractDefinition[];

export type CommandName = (typeof COMMAND_CONTRACTS)[number]["name"];
export type QueryName = (typeof QUERY_CONTRACTS)[number]["name"];
export type OperationName = CommandName | QueryName;
