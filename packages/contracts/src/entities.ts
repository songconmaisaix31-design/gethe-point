import { z } from "zod";

import { MemberRoleSchema } from "./actors";
import {
  DetailTextSchema,
  EntityIdSchema,
  PageInfoSchema,
  PrivateContentSchema,
  RecordMetadataSchema,
  RedactedExcerptSchema,
  ShortTextSchema,
  TimeOfDaySchema,
  TimeRangeSchema,
  TimestampSchema,
} from "./primitives";

export const SpaceSchema = RecordMetadataSchema.extend({
  name: ShortTextSchema,
  createdBy: EntityIdSchema,
  status: z.enum(["active", "deleting"]),
});
export type Space = z.infer<typeof SpaceSchema>;

export const MemberSchema = RecordMetadataSchema.extend({
  role: MemberRoleSchema,
  displayName: ShortTextSchema,
  status: z.enum(["active", "inactive"]),
  joinedAt: TimestampSchema,
  analysisConsent: z.enum(["enabled", "revoked"]),
});
export type Member = z.infer<typeof MemberSchema>;

export const ConversationSchema = RecordMetadataSchema.extend({
  type: z.enum(["agent_dm", "family_group"]),
  participantMemberIds: z.array(EntityIdSchema).min(1).max(3),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const SelfVisibilitySchema = z.strictObject({
  kind: z.literal("self"),
  memberId: EntityIdSchema,
});
export type SelfVisibility = z.infer<typeof SelfVisibilitySchema>;

export const SpaceVisibilitySchema = z.strictObject({
  kind: z.literal("space"),
});
export type SpaceVisibility = z.infer<typeof SpaceVisibilitySchema>;

export const MembersVisibilitySchema = z.strictObject({
  kind: z.literal("members"),
  memberIds: z.array(EntityIdSchema).min(1).max(3),
});
export type MembersVisibility = z.infer<typeof MembersVisibilitySchema>;

export const CareRelatedVisibilitySchema = z.strictObject({
  kind: z.literal("care_related"),
  subjectId: EntityIdSchema,
  memberIds: z.array(EntityIdSchema).min(1).max(3),
});
export type CareRelatedVisibility = z.infer<
  typeof CareRelatedVisibilitySchema
>;

export const SharedVisibilitySchema = z.discriminatedUnion("kind", [
  SpaceVisibilitySchema,
  MembersVisibilitySchema,
  CareRelatedVisibilitySchema,
]);
export type SharedVisibility = z.infer<typeof SharedVisibilitySchema>;

export const VisibilitySchema = z.discriminatedUnion("kind", [
  SelfVisibilitySchema,
  SpaceVisibilitySchema,
  MembersVisibilitySchema,
  CareRelatedVisibilitySchema,
]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const PrivateMessageSchema = RecordMetadataSchema.extend({
  conversationId: EntityIdSchema,
  authorId: EntityIdSchema,
  clientMessageId: EntityIdSchema,
  content: PrivateContentSchema,
  occurredAt: TimestampSchema,
  visibility: SelfVisibilitySchema,
});
export type PrivateMessage = z.infer<typeof PrivateMessageSchema>;

export const EvidenceSourceTypeSchema = z.enum([
  "agent_dm",
  "family_group",
  "screenshot",
  "voice",
  "forward",
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const EvidenceStateSchema = z.enum(["available", "deleted"]);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

export const EvidenceSchema = RecordMetadataSchema.extend({
  sourceType: EvidenceSourceTypeSchema,
  speakerId: EntityIdSchema,
  occurredAt: TimestampSchema,
  rawRef: z.string().min(1).max(512),
  visibility: SelfVisibilitySchema,
  state: EvidenceStateSchema,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RawEvidenceViewSchema = z.strictObject({
  evidence: EvidenceSchema,
  rawContent: PrivateContentSchema,
});
export type RawEvidenceView = z.infer<typeof RawEvidenceViewSchema>;

export const EvidenceProvenanceSchema = z.strictObject({
  evidenceId: EntityIdSchema,
  sourceType: EvidenceSourceTypeSchema,
  speakerId: EntityIdSchema,
  occurredAt: TimestampSchema,
  state: EvidenceStateSchema,
});
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const AuthorizedEvidenceViewSchema = z.discriminatedUnion("view", [
  z.strictObject({
    view: z.literal("raw"),
    evidence: RawEvidenceViewSchema,
  }),
  z.strictObject({
    view: z.literal("provenance"),
    evidence: EvidenceProvenanceSchema,
  }),
]);
export type AuthorizedEvidenceView = z.infer<
  typeof AuthorizedEvidenceViewSchema
>;

export const SignalDraftKindSchema = z.enum([
  "potential_task",
  "discussion_only",
  "high_risk",
]);
export type SignalDraftKind = z.infer<typeof SignalDraftKindSchema>;

export const SignalDraftSchema = RecordMetadataSchema.extend({
  speakerId: EntityIdSchema,
  sourceMessageId: EntityIdSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(10),
  kind: SignalDraftKindSchema,
  redactedExcerpt: RedactedExcerptSchema,
  proposedConclusion: DetailTextSchema,
  candidateDomainId: EntityIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(ShortTextSchema).max(20),
  promptVersion: z.string().min(1).max(80),
  source: z.enum(["fixture", "validated_ai", "human"]),
});
export type SignalDraft = z.infer<typeof SignalDraftSchema>;

const ConsentDecisionBaseSchema = RecordMetadataSchema.extend({
  signalDraftId: EntityIdSchema,
  speakerId: EntityIdSchema,
  decidedAt: TimestampSchema,
});

export const ActiveShareConsentSchema = ConsentDecisionBaseSchema.extend({
  recordState: z.literal("active"),
  outcome: z.literal("share"),
  visibility: SharedVisibilitySchema,
  expiresAt: TimestampSchema.nullable(),
  revokedAt: z.null(),
});
export type ActiveShareConsent = z.infer<typeof ActiveShareConsentSchema>;

export const RevokedShareConsentSchema = ConsentDecisionBaseSchema.extend({
  recordState: z.literal("revoked"),
  outcome: z.literal("share"),
  visibility: SharedVisibilitySchema,
  expiresAt: TimestampSchema.nullable(),
  revokedAt: TimestampSchema,
});

export const ExpiredShareConsentSchema = ConsentDecisionBaseSchema.extend({
  recordState: z.literal("expired"),
  outcome: z.literal("share"),
  visibility: SharedVisibilitySchema,
  expiresAt: TimestampSchema,
  revokedAt: z.null(),
});

export const DiscardedConsentSchema = ConsentDecisionBaseSchema.extend({
  recordState: z.literal("discarded"),
  outcome: z.literal("discard"),
  visibility: z.null(),
  expiresAt: z.null(),
  revokedAt: z.null(),
});

export const ConsentDecisionSchema = z.discriminatedUnion("recordState", [
  ActiveShareConsentSchema,
  RevokedShareConsentSchema,
  ExpiredShareConsentSchema,
  DiscardedConsentSchema,
]);
export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>;

export const SharedSignalPurposeSchema = z.enum([
  "responsibility",
  "care_information",
  "family_information",
]);
export type SharedSignalPurpose = z.infer<typeof SharedSignalPurposeSchema>;

export const SharedSignalSchema = RecordMetadataSchema.extend({
  speakerId: EntityIdSchema,
  consentDecisionId: EntityIdSchema,
  redactedExcerpt: RedactedExcerptSchema,
  conclusion: DetailTextSchema,
  purpose: SharedSignalPurposeSchema,
  visibility: SharedVisibilitySchema,
  provenance: z.array(EvidenceProvenanceSchema).min(1).max(10),
  evidenceState: z.enum(["available", "evidence_missing"]),
});
export type SharedSignal = z.infer<typeof SharedSignalSchema>;

export const DomainSchema = RecordMetadataSchema.extend({
  name: ShortTextSchema,
  ownerId: EntityIdSchema.nullable(),
  status: z.enum(["active", "needs_review", "archived"]),
  nextAction: ShortTextSchema.nullable(),
  visibility: SharedVisibilitySchema,
  evidenceIds: z.array(EntityIdSchema).max(50),
});
export type Domain = z.infer<typeof DomainSchema>;

export const ResponsibilityStageSchema = z.enum([
  "discoveredBy",
  "deadlineKeptBy",
  "scheduledBy",
  "executedBy",
  "followedUpBy",
]);
export type ResponsibilityStage = z.infer<typeof ResponsibilityStageSchema>;

export const ResponsibilityAttributionSchema = z.strictObject({
  discoveredBy: EntityIdSchema.nullable(),
  deadlineKeptBy: EntityIdSchema.nullable(),
  scheduledBy: EntityIdSchema.nullable(),
  executedBy: EntityIdSchema.nullable(),
  followedUpBy: EntityIdSchema.nullable(),
});
export type ResponsibilityAttribution = z.infer<
  typeof ResponsibilityAttributionSchema
>;

export const TaskSchema = RecordMetadataSchema.extend({
  domainId: EntityIdSchema,
  title: ShortTextSchema,
  dueAt: TimestampSchema.nullable(),
  status: z.enum(["open", "completed", "cancelled"]),
  reviewState: z.enum(["current", "needs_review"]),
  visibility: SharedVisibilitySchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(20),
  discoveredBy: EntityIdSchema.nullable(),
  deadlineKeptBy: EntityIdSchema.nullable(),
  scheduledBy: EntityIdSchema.nullable(),
  executedBy: EntityIdSchema.nullable(),
  followedUpBy: EntityIdSchema.nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const HandoverContactSchema = z.strictObject({
  label: ShortTextSchema,
  redactedValue: ShortTextSchema,
});

export const HandoverPacketSchema = z.strictObject({
  scope: DetailTextSchema,
  history: z.array(DetailTextSchema).max(20),
  constraints: z.array(DetailTextSchema).max(20),
  contacts: z.array(HandoverContactSchema).max(20),
  knownInformation: z.array(DetailTextSchema).max(50),
  nextAction: DetailTextSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(50),
});
export type HandoverPacket = z.infer<typeof HandoverPacketSchema>;

export const HandoverMissingInfoSchema = z.strictObject({
  id: EntityIdSchema,
  label: ShortTextSchema,
  reason: DetailTextSchema,
});
export type HandoverMissingInfo = z.infer<typeof HandoverMissingInfoSchema>;

const HandoverBaseSchema = RecordMetadataSchema.extend({
  domainId: EntityIdSchema,
  fromMemberId: EntityIdSchema,
  toMemberId: EntityIdSchema,
  packet: HandoverPacketSchema,
  expiresAt: TimestampSchema,
});

const NonTerminalUnconfirmedFields = {
  fromConfirmedAt: z.null(),
  toConfirmedAt: z.null(),
  acceptedAt: z.null(),
  terminalAt: z.null(),
  declinedBy: z.null(),
  declineReason: z.null(),
} as const;

export const DraftHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("draft"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(20),
  ...NonTerminalUnconfirmedFields,
});

export const ProposedHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("proposed"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(20),
  ...NonTerminalUnconfirmedFields,
});

export const BlockedHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("blocked"),
  missingInfo: z.array(HandoverMissingInfoSchema).min(1).max(20),
  ...NonTerminalUnconfirmedFields,
});
export type BlockedHandover = z.infer<typeof BlockedHandoverSchema>;

export const AwaitingConfirmationsHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("awaiting_confirmations"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(0),
  fromConfirmedAt: TimestampSchema.nullable(),
  toConfirmedAt: TimestampSchema.nullable(),
  acceptedAt: z.null(),
  terminalAt: z.null(),
  declinedBy: z.null(),
  declineReason: z.null(),
});
export type AwaitingConfirmationsHandover = z.infer<
  typeof AwaitingConfirmationsHandoverSchema
>;

export const AcceptedHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("accepted"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(0),
  fromConfirmedAt: TimestampSchema,
  toConfirmedAt: TimestampSchema,
  acceptedAt: TimestampSchema,
  terminalAt: TimestampSchema,
  declinedBy: z.null(),
  declineReason: z.null(),
});
export type AcceptedHandover = z.infer<typeof AcceptedHandoverSchema>;

export const DeclinedHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("declined"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(20),
  fromConfirmedAt: TimestampSchema.nullable(),
  toConfirmedAt: TimestampSchema.nullable(),
  acceptedAt: z.null(),
  terminalAt: TimestampSchema,
  declinedBy: EntityIdSchema,
  declineReason: DetailTextSchema,
});
export type DeclinedHandover = z.infer<typeof DeclinedHandoverSchema>;

export const ExpiredHandoverSchema = HandoverBaseSchema.extend({
  status: z.literal("expired"),
  missingInfo: z.array(HandoverMissingInfoSchema).max(20),
  fromConfirmedAt: TimestampSchema.nullable(),
  toConfirmedAt: TimestampSchema.nullable(),
  acceptedAt: z.null(),
  terminalAt: TimestampSchema,
  declinedBy: z.null(),
  declineReason: z.null(),
});
export type ExpiredHandover = z.infer<typeof ExpiredHandoverSchema>;

export const HandoverSchema = z.discriminatedUnion("status", [
  DraftHandoverSchema,
  ProposedHandoverSchema,
  BlockedHandoverSchema,
  AwaitingConfirmationsHandoverSchema,
  AcceptedHandoverSchema,
  DeclinedHandoverSchema,
  ExpiredHandoverSchema,
]);
export type Handover = z.infer<typeof HandoverSchema>;

export const CareScheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("one_time"),
    at: TimestampSchema,
  }),
  z.strictObject({
    kind: z.literal("daily"),
    timezone: z.string().min(1).max(80),
    times: z.array(TimeOfDaySchema).min(1).max(8),
  }),
]);
export type CareSchedule = z.infer<typeof CareScheduleSchema>;

export const EscalationStepSchema = z.strictObject({
  level: z.number().int().min(1).max(10),
  delaySec: z.number().int().nonnegative().max(86_400),
  targetMemberIds: z.array(EntityIdSchema).min(1).max(3),
  action: z.enum(["notify", "request_in_person_check"]),
});
export type EscalationStep = z.infer<typeof EscalationStepSchema>;

const CareRuleBaseSchema = RecordMetadataSchema.extend({
  subjectId: EntityIdSchema,
  title: ShortTextSchema,
  schedule: CareScheduleSchema,
  requireAck: z.boolean(),
  ackTimeoutSec: z.number().int().min(1).max(86_400),
  escalationChain: z.array(EscalationStepSchema).min(1).max(10),
  primaryCaregiverId: EntityIdSchema,
  createdFromEvidenceId: EntityIdSchema,
  terminalBehavior: z.enum([
    "close_on_ack",
    "close_on_handle",
    "unresolved_after_chain",
  ]),
});

export const DraftCareRuleSchema = CareRuleBaseSchema.extend({
  status: z.literal("draft"),
  confirmedBy: z.null(),
  confirmedAt: z.null(),
});
export type DraftCareRule = z.infer<typeof DraftCareRuleSchema>;

export const ActiveCareRuleSchema = CareRuleBaseSchema.extend({
  status: z.literal("active"),
  confirmedBy: EntityIdSchema,
  confirmedAt: TimestampSchema,
});
export type ActiveCareRule = z.infer<typeof ActiveCareRuleSchema>;

export const PausedCareRuleSchema = CareRuleBaseSchema.extend({
  status: z.literal("paused"),
  confirmedBy: EntityIdSchema,
  confirmedAt: TimestampSchema,
});

export const ArchivedCareRuleSchema = CareRuleBaseSchema.extend({
  status: z.literal("archived"),
  confirmedBy: EntityIdSchema,
  confirmedAt: TimestampSchema,
});

export const CareRuleSchema = z.discriminatedUnion("status", [
  DraftCareRuleSchema,
  ActiveCareRuleSchema,
  PausedCareRuleSchema,
  ArchivedCareRuleSchema,
]);
export type CareRule = z.infer<typeof CareRuleSchema>;

export const CareEventStateSchema = z.enum([
  "scheduled",
  "notified",
  "acknowledged",
  "timed_out",
  "escalated",
  "handled",
  "closed",
  "unresolved",
]);
export type CareEventState = z.infer<typeof CareEventStateSchema>;

const CareEventBaseSchema = RecordMetadataSchema.extend({
  careRuleId: EntityIdSchema,
  subjectId: EntityIdSchema,
  occurrenceKey: z.string().min(1).max(160),
  scheduledFor: TimestampSchema,
  acknowledgementDeadline: TimestampSchema.nullable(),
  notificationIntentIds: z.array(EntityIdSchema).max(40),
});

export const ScheduledCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("scheduled"),
  notifiedAt: z.null(),
  acknowledgedAt: z.null(),
  timedOutAt: z.null(),
  escalationLevel: z.literal(0),
  escalatedAt: z.null(),
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: z.null(),
});

export const NotifiedCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("notified"),
  notifiedAt: TimestampSchema,
  acknowledgedAt: z.null(),
  timedOutAt: z.null(),
  escalationLevel: z.literal(0),
  escalatedAt: z.null(),
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: z.null(),
});

export const AcknowledgedCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("acknowledged"),
  notifiedAt: TimestampSchema,
  acknowledgedAt: TimestampSchema,
  timedOutAt: TimestampSchema.nullable(),
  escalationLevel: z.number().int().nonnegative().max(10),
  escalatedAt: TimestampSchema.nullable(),
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: z.null(),
});
export type AcknowledgedCareEvent = z.infer<
  typeof AcknowledgedCareEventSchema
>;

export const TimedOutCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("timed_out"),
  notifiedAt: TimestampSchema,
  acknowledgedAt: z.null(),
  timedOutAt: TimestampSchema,
  escalationLevel: z.literal(0),
  escalatedAt: z.null(),
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: z.null(),
});

export const EscalatedCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("escalated"),
  notifiedAt: TimestampSchema,
  acknowledgedAt: z.null(),
  timedOutAt: TimestampSchema,
  escalationLevel: z.number().int().min(1).max(10),
  escalatedAt: TimestampSchema,
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: z.null(),
});

export const HandledCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("handled"),
  notifiedAt: TimestampSchema.nullable(),
  acknowledgedAt: z.null(),
  timedOutAt: TimestampSchema,
  escalationLevel: z.number().int().min(1).max(10),
  escalatedAt: TimestampSchema,
  handledAt: TimestampSchema,
  closedAt: z.null(),
  unresolvedAt: z.null(),
});
export type HandledCareEvent = z.infer<typeof HandledCareEventSchema>;

export const ClosedCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("closed"),
  notifiedAt: TimestampSchema,
  acknowledgedAt: TimestampSchema.nullable(),
  timedOutAt: TimestampSchema.nullable(),
  escalationLevel: z.number().int().nonnegative().max(10),
  escalatedAt: TimestampSchema.nullable(),
  handledAt: TimestampSchema.nullable(),
  closedAt: TimestampSchema,
  unresolvedAt: z.null(),
});

export const UnresolvedCareEventSchema = CareEventBaseSchema.extend({
  state: z.literal("unresolved"),
  notifiedAt: TimestampSchema.nullable(),
  acknowledgedAt: z.null(),
  timedOutAt: TimestampSchema.nullable(),
  escalationLevel: z.number().int().nonnegative().max(10),
  escalatedAt: TimestampSchema.nullable(),
  handledAt: z.null(),
  closedAt: z.null(),
  unresolvedAt: TimestampSchema,
});

export const CareEventSchema = z.discriminatedUnion("state", [
  ScheduledCareEventSchema,
  NotifiedCareEventSchema,
  AcknowledgedCareEventSchema,
  TimedOutCareEventSchema,
  EscalatedCareEventSchema,
  HandledCareEventSchema,
  ClosedCareEventSchema,
  UnresolvedCareEventSchema,
]);
export type CareEvent = z.infer<typeof CareEventSchema>;

export const ResponsibilityStageCountSchema = z.strictObject({
  memberId: EntityIdSchema,
  count: z.number().int().nonnegative(),
});

export const ResponsibilityReportRowSchema = z.strictObject({
  stage: ResponsibilityStageSchema,
  counts: z.array(ResponsibilityStageCountSchema).min(1).max(3),
});

export const ResponsibilityReportSchema = z.strictObject({
  spaceId: EntityIdSchema,
  period: TimeRangeSchema,
  generatedAt: TimestampSchema,
  rows: z.array(ResponsibilityReportRowSchema).length(5),
  unownedDomainCount: z.number().int().nonnegative(),
  excludedNeedsReviewCount: z.number().int().nonnegative(),
  narrative: DetailTextSchema,
  source: z.literal("deterministic_template"),
});
export type ResponsibilityReport = z.infer<
  typeof ResponsibilityReportSchema
>;

export const PrivateConversationPageSchema = z.strictObject({
  conversation: ConversationSchema,
  messages: z.array(PrivateMessageSchema),
  page: PageInfoSchema,
});
export type PrivateConversationPage = z.infer<
  typeof PrivateConversationPageSchema
>;

export const DomainWithEvidenceSchema = z.strictObject({
  domain: DomainSchema,
  tasks: z.array(TaskSchema),
  evidence: z.array(AuthorizedEvidenceViewSchema),
});
export type DomainWithEvidence = z.infer<typeof DomainWithEvidenceSchema>;

export const ExportBundleSchema = z.strictObject({
  generatedAt: TimestampSchema,
  member: MemberSchema,
  privateMessages: z.array(PrivateMessageSchema),
  evidence: z.array(RawEvidenceViewSchema),
  visibleSignals: z.array(SharedSignalSchema),
  visibleDomains: z.array(DomainSchema),
  visibleTasks: z.array(TaskSchema),
  visibleHandovers: z.array(HandoverSchema),
  visibleCareRules: z.array(CareRuleSchema),
  visibleCareEvents: z.array(CareEventSchema),
});
export type ExportBundle = z.infer<typeof ExportBundleSchema>;
