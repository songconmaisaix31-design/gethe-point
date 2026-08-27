import { z } from "zod";

import { ActorRefSchema } from "./actors";
import {
  CareEventStateSchema,
  CareResolutionSchema,
  SharedVisibilitySchema,
  VisibilitySchema,
} from "./entities";
import {
  CorrelationIdSchema,
  EntityIdSchema,
  IdempotencyKeySchema,
  RecordVersionSchema,
  ShortTextSchema,
  TimestampSchema,
} from "./primitives";

export const AuditActionSchema = z.enum([
  "private_message_created",
  "signal_draft_created",
  "consent_decided",
  "shared_signal_confirmed",
  "task_attribution_corrected",
  "handover_transitioned",
  "handover_accepted",
  "care_rule_confirmed",
  "care_event_transitioned",
  "evidence_deleted",
  "analysis_consent_revoked",
  "personal_data_exported",
  "space_deleted",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

const NON_RESOLUTION_AUDITED_FIELDS = [
  "status",
  "ownerId",
  "reminderOwnerId",
  "discoveredBy",
  "deadlineKeptBy",
  "scheduledBy",
  "executedBy",
  "followedUpBy",
  "visibility",
  "evidenceState",
  "reviewState",
  "analysisConsent",
  "escalationLevel",
] as const;

const NonResolutionAuditedFieldSchema = z.enum(
  NON_RESOLUTION_AUDITED_FIELDS,
);

export const AuditedFieldSchema = z.enum([
  ...NON_RESOLUTION_AUDITED_FIELDS,
  "resolution",
]);

const AuditIdValueSchema = z.strictObject({
  kind: z.literal("id"),
  value: EntityIdSchema.nullable(),
});
const AuditStateValueSchema = z.strictObject({
  kind: z.literal("state"),
  value: ShortTextSchema.nullable(),
});
const AuditCountValueSchema = z.strictObject({
  kind: z.literal("count"),
  value: z.number().int().nonnegative(),
});
const AuditBooleanValueSchema = z.strictObject({
  kind: z.literal("boolean"),
  value: z.boolean(),
});

const NonResolutionAuditValueSchema = z.discriminatedUnion("kind", [
  AuditIdValueSchema,
  AuditStateValueSchema,
  AuditCountValueSchema,
  AuditBooleanValueSchema,
]);

export const AuditResolutionValueSchema = z.strictObject({
  kind: z.literal("resolution"),
  value: CareResolutionSchema.nullable(),
});

export const AuditValueSchema = z.discriminatedUnion("kind", [
  AuditIdValueSchema,
  AuditStateValueSchema,
  AuditCountValueSchema,
  AuditBooleanValueSchema,
  AuditResolutionValueSchema,
]);

export const AuditChangeSchema = z.union([
  z.strictObject({
    field: NonResolutionAuditedFieldSchema,
    before: NonResolutionAuditValueSchema,
    after: NonResolutionAuditValueSchema,
  }),
  z.strictObject({
    field: z.literal("resolution"),
    before: AuditResolutionValueSchema,
    after: AuditResolutionValueSchema,
  }),
]);

export const AuditEntrySchema = z.strictObject({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  actor: ActorRefSchema,
  action: AuditActionSchema,
  targetType: z.enum([
    "message",
    "signal",
    "consent",
    "task",
    "domain",
    "handover",
    "care_rule",
    "care_event",
    "evidence",
    "member",
    "export",
    "space",
  ]),
  targetId: EntityIdSchema,
  beforeVersion: RecordVersionSchema.nullable(),
  afterVersion: RecordVersionSchema.nullable(),
  changes: z.array(AuditChangeSchema).max(20),
  visibility: VisibilitySchema,
  occurredAt: TimestampSchema,
  retention: z.literal("until_space_deleted"),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

const EventBaseSchema = z.strictObject({
  eventId: EntityIdSchema,
  spaceId: EntityIdSchema,
  occurredAt: TimestampSchema,
  actor: ActorRefSchema,
  correlationId: CorrelationIdSchema,
  causationId: EntityIdSchema.nullable(),
  idempotencyKey: IdempotencyKeySchema.nullable(),
});

export const PrivateMessageCreatedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("private_message.created"),
  payload: z.strictObject({
    messageId: EntityIdSchema,
    conversationId: EntityIdSchema,
    authorId: EntityIdSchema,
  }),
});

export const SignalDraftCreatedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("signal_draft.created"),
  payload: z.strictObject({
    signalDraftId: EntityIdSchema,
    speakerId: EntityIdSchema,
    kind: z.enum(["potential_task", "discussion_only", "high_risk"]),
    promptVersion: z.string().min(1).max(80),
  }),
});

export const ConsentDecidedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("consent.decided"),
  payload: z.strictObject({
    consentDecisionId: EntityIdSchema,
    signalDraftId: EntityIdSchema,
    speakerId: EntityIdSchema,
    outcome: z.enum(["share", "discard"]),
    visibility: SharedVisibilitySchema.nullable(),
  }),
});

export const SharedSignalConfirmedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("shared_signal.confirmed"),
  payload: z.strictObject({
    signalId: EntityIdSchema,
    consentDecisionId: EntityIdSchema,
    visibility: SharedVisibilitySchema,
  }),
});

export const TaskAttributionCorrectedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("task_attribution.corrected"),
  payload: z.strictObject({
    taskId: EntityIdSchema,
    auditEntryId: EntityIdSchema,
    correctedFields: z
      .array(
        z.enum([
          "discoveredBy",
          "deadlineKeptBy",
          "scheduledBy",
          "executedBy",
          "followedUpBy",
        ]),
      )
      .min(1)
      .max(5),
  }),
});

export const HandoverTransitionedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("handover.transitioned"),
  payload: z.strictObject({
    handoverId: EntityIdSchema,
    fromState: z.enum([
      "draft",
      "proposed",
      "blocked",
      "awaiting_confirmations",
      "accepted",
      "declined",
      "expired",
    ]),
    toState: z.enum([
      "draft",
      "proposed",
      "blocked",
      "awaiting_confirmations",
      "accepted",
      "declined",
      "expired",
    ]),
  }),
});

export const HandoverAcceptedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("handover.accepted"),
  payload: z.strictObject({
    handoverId: EntityIdSchema,
    domainId: EntityIdSchema,
    previousOwnerId: EntityIdSchema,
    newOwnerId: EntityIdSchema,
    migratedReminderCount: z.number().int().nonnegative(),
    auditEntryId: EntityIdSchema,
  }),
});

export const CareRuleConfirmedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("care_rule.confirmed"),
  payload: z.strictObject({
    careRuleId: EntityIdSchema,
    subjectId: EntityIdSchema,
    confirmedBy: EntityIdSchema,
  }),
});

export const CareEventTransitionedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("care_event.transitioned"),
  payload: z.strictObject({
    careEventId: EntityIdSchema,
    fromState: CareEventStateSchema,
    toState: CareEventStateSchema,
    escalationLevel: z.number().int().nonnegative().max(10),
  }),
});

export const EvidenceDeletedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("evidence.deleted"),
  payload: z.strictObject({
    evidenceId: EntityIdSchema,
    invalidatedSignalIds: z.array(EntityIdSchema),
    needsReviewTaskIds: z.array(EntityIdSchema),
    needsReviewDomainIds: z.array(EntityIdSchema),
    preservedAcceptedHandoverIds: z.array(EntityIdSchema),
    auditEntryId: EntityIdSchema,
  }),
});

export const AnalysisConsentRevokedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("analysis_consent.revoked"),
  payload: z.strictObject({
    memberId: EntityIdSchema,
    effectiveAt: TimestampSchema,
    priorAuthorizedEventsPreserved: z.literal(true),
  }),
});

export const PersonalDataExportedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("personal_data.exported"),
  payload: z.strictObject({
    exportId: EntityIdSchema,
    memberId: EntityIdSchema,
    format: z.literal("json"),
  }),
});

export const SpaceDeletedEventSchema = EventBaseSchema.extend({
  eventType: z.literal("space.deleted"),
  payload: z.strictObject({
    deletionReceiptId: EntityIdSchema,
    deletedAt: TimestampSchema,
    persistedAfterDeletion: z.literal(false),
  }),
});

export const DomainEventSchema = z.discriminatedUnion("eventType", [
  PrivateMessageCreatedEventSchema,
  SignalDraftCreatedEventSchema,
  ConsentDecidedEventSchema,
  SharedSignalConfirmedEventSchema,
  TaskAttributionCorrectedEventSchema,
  HandoverTransitionedEventSchema,
  HandoverAcceptedEventSchema,
  CareRuleConfirmedEventSchema,
  CareEventTransitionedEventSchema,
  EvidenceDeletedEventSchema,
  AnalysisConsentRevokedEventSchema,
  PersonalDataExportedEventSchema,
  SpaceDeletedEventSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
