import { z } from "zod";

import {
  AuditEntrySchema,
  ConsentDecisionSchema,
  CorrectTaskAttributionRequestSchema,
  CorrectTaskAttributionResultSchema,
  DomainSchema,
  EntityIdSchema,
  EvidenceSchema,
  MemberActorSchema,
  MemberSchema,
  RequestHashSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  TaskSchema,
} from "../../../packages/contracts/src/index";

export const CreateResponsibilityRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  sourceSignalId: EntityIdSchema,
});
export type CreateResponsibilityRequest = z.infer<
  typeof CreateResponsibilityRequestSchema
>;

/** Complete persisted source graph; every relationship is rechecked by the service. */
export const ResponsibilitySourceContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  speaker: MemberSchema,
  draft: SignalDraftSchema,
  consent: ConsentDecisionSchema,
  signal: SharedSignalSchema,
  evidence: z.array(EvidenceSchema).min(1).max(10),
  members: z.array(MemberSchema).min(1).max(3),
});
export type ResponsibilitySourceContext = z.infer<
  typeof ResponsibilitySourceContextSchema
>;

export const ResponsibilityDraftInputSchema = z.strictObject({
  signal: SharedSignalSchema,
  sourceDraft: SignalDraftSchema,
});
export type ResponsibilityDraftInput = z.infer<
  typeof ResponsibilityDraftInputSchema
>;

export const ReadyResponsibilityDraftSchema = z.strictObject({
  status: z.literal("ready"),
  source: z.literal("fixture"),
  consequentialMutationAllowed: z.literal(false),
  domain: DomainSchema,
  task: TaskSchema,
});
export type ReadyResponsibilityDraft = z.infer<
  typeof ReadyResponsibilityDraftSchema
>;

export const ResponsibilityDraftReviewSchema = z.strictObject({
  status: z.literal("needs_human_review"),
  reason: z.enum([
    "not_fixture_source",
    "unsupported_fixture",
    "source_incomplete",
  ]),
  consequentialMutationAllowed: z.literal(false),
});
export type ResponsibilityDraftReview = z.infer<
  typeof ResponsibilityDraftReviewSchema
>;

export const ResponsibilityDraftResultSchema = z.discriminatedUnion("status", [
  ReadyResponsibilityDraftSchema,
  ResponsibilityDraftReviewSchema,
]);
export type ResponsibilityDraftResult = z.infer<
  typeof ResponsibilityDraftResultSchema
>;

export const VersionGuardEntrySchema = z.strictObject({
  id: EntityIdSchema,
  version: z.number().int().nonnegative(),
});
export type VersionGuardEntry = z.infer<typeof VersionGuardEntrySchema>;

export const ResponsibilitySourceGuardSchema = z.strictObject({
  space: VersionGuardEntrySchema,
  actorMember: VersionGuardEntrySchema,
  speaker: VersionGuardEntrySchema,
  draft: VersionGuardEntrySchema,
  consent: VersionGuardEntrySchema,
  signal: VersionGuardEntrySchema,
  evidence: z.array(VersionGuardEntrySchema).min(1).max(10),
  members: z.array(VersionGuardEntrySchema).min(1).max(3),
});
export type ResponsibilitySourceGuard = z.infer<
  typeof ResponsibilitySourceGuardSchema
>;

export const ResponsibilityCreationCommandSchema = z.strictObject({
  actor: MemberActorSchema,
  requestId: RequestIdSchema,
  sourceSignalId: EntityIdSchema,
  sourceDraftId: EntityIdSchema,
  consentDecisionId: EntityIdSchema,
  guard: ResponsibilitySourceGuardSchema,
  domain: DomainSchema,
  task: TaskSchema,
});
export type ResponsibilityCreationCommand = z.infer<
  typeof ResponsibilityCreationCommandSchema
>;

export const ResponsibilityCreationResultSchema = z.strictObject({
  status: z.enum(["created", "replayed"]),
  sourceSignalId: EntityIdSchema,
  domain: DomainSchema,
  task: TaskSchema,
});
export type ResponsibilityCreationResult = z.infer<
  typeof ResponsibilityCreationResultSchema
>;

export const ResponsibilityReportTaskRecordSchema = z.strictObject({
  task: TaskSchema,
  sourceSignalId: EntityIdSchema,
});
export type ResponsibilityReportTaskRecord = z.infer<
  typeof ResponsibilityReportTaskRecordSchema
>;

export const ResponsibilityReportSnapshotSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  domains: z.array(DomainSchema).max(100),
  tasks: z.array(ResponsibilityReportTaskRecordSchema).max(500),
  sources: z.array(ResponsibilitySourceContextSchema).max(500),
});
export type ResponsibilityReportSnapshot = z.infer<
  typeof ResponsibilityReportSnapshotSchema
>;

export const AttributionCorrectionContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  domain: DomainSchema,
  task: TaskSchema,
  evidence: z.array(EvidenceSchema).min(1).max(20),
});
export type AttributionCorrectionContext = z.infer<
  typeof AttributionCorrectionContextSchema
>;

export const AttributionCorrectionGuardSchema = z.strictObject({
  space: VersionGuardEntrySchema,
  actorMember: VersionGuardEntrySchema,
  members: z.array(VersionGuardEntrySchema).min(1).max(3),
  domain: VersionGuardEntrySchema,
  task: VersionGuardEntrySchema,
  evidence: z.array(VersionGuardEntrySchema).min(1).max(20),
});
export type AttributionCorrectionGuard = z.infer<
  typeof AttributionCorrectionGuardSchema
>;

export const AttributionCorrectionResolutionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("miss") }),
    z.strictObject({
      status: z.literal("replay"),
      result: CorrectTaskAttributionResultSchema,
    }),
    z.strictObject({ status: z.literal("conflict") }),
  ],
);
export type AttributionCorrectionResolution = z.infer<
  typeof AttributionCorrectionResolutionSchema
>;

export const AttributionCorrectionCommandSchema = z.strictObject({
  actor: MemberActorSchema,
  request: CorrectTaskAttributionRequestSchema,
  requestHash: RequestHashSchema,
  guard: AttributionCorrectionGuardSchema,
  task: TaskSchema,
  audit: AuditEntrySchema,
});
export type AttributionCorrectionCommand = z.infer<
  typeof AttributionCorrectionCommandSchema
>;

export const AttributionCorrectionCommitResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.enum(["committed", "replayed"]),
      result: CorrectTaskAttributionResultSchema,
    }),
    z.strictObject({ status: z.literal("stale") }),
    z.strictObject({ status: z.literal("conflict") }),
  ],
);
export type AttributionCorrectionCommitResult = z.infer<
  typeof AttributionCorrectionCommitResultSchema
>;
