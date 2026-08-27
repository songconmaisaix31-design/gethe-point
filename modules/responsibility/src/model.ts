import { z } from "zod";

import {
  DomainSchema,
  EntityIdSchema,
  EvidenceSourceTypeSchema,
  MemberSchema,
  RecordVersionSchema,
  SharedSignalSchema,
  SignalDraftKindSchema,
  SpaceSchema,
  TaskSchema,
  TimestampSchema,
} from "../../../packages/contracts/src/index";

import { hasUniqueIds } from "./visibility";

export const VersionGuardEntrySchema = z.strictObject({
  id: EntityIdSchema,
  version: RecordVersionSchema,
});
export type VersionGuardEntry = z.infer<typeof VersionGuardEntrySchema>;

export const PersistedEvidenceSnapshotSchema = z.strictObject({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  sourceType: EvidenceSourceTypeSchema,
  speakerId: EntityIdSchema,
  occurredAt: TimestampSchema,
  state: z.enum(["available", "deleted"]),
  version: RecordVersionSchema,
});
export type PersistedEvidenceSnapshot = z.infer<
  typeof PersistedEvidenceSnapshotSchema
>;

export const AttributionCorrectionContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  domain: DomainSchema,
  task: TaskSchema,
  evidence: z.array(PersistedEvidenceSnapshotSchema).min(1).max(20),
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

export const CorrectionStoredResultSchema = z.strictObject({
  task: TaskSchema,
  auditEntryId: EntityIdSchema,
  auditOccurredAt: TimestampSchema,
});
export type CorrectionStoredResult = z.infer<
  typeof CorrectionStoredResultSchema
>;

export const CorrectionIdempotencyResolutionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("miss") }),
    z.strictObject({
      status: z.literal("replayed"),
      result: CorrectionStoredResultSchema,
    }),
    z.strictObject({ status: z.literal("conflict") }),
  ],
);
export type CorrectionIdempotencyResolution = z.infer<
  typeof CorrectionIdempotencyResolutionSchema
>;

export const CorrectionCommitResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["corrected", "replayed"]),
    result: CorrectionStoredResultSchema,
  }),
  z.strictObject({
    status: z.enum([
      "not_found",
      "forbidden",
      "stale_version",
      "evidence_missing",
      "idempotency_conflict",
      "conflict",
    ]),
  }),
]);
export type CorrectionCommitResult = z.infer<
  typeof CorrectionCommitResultSchema
>;

const UniqueEntityIdsSchema = z
  .array(EntityIdSchema)
  .min(1)
  .max(20)
  .refine(hasUniqueIds, "Identifiers must be unique.");

export const ReportSignalRecordSchema = z.strictObject({
  signal: SharedSignalSchema,
  sourceKind: SignalDraftKindSchema,
});
export type ReportSignalRecord = z.infer<typeof ReportSignalRecordSchema>;

export const ReportTaskRecordSchema = z.strictObject({
  task: TaskSchema,
  sourceSignalIds: UniqueEntityIdsSchema,
});
export type ReportTaskRecord = z.infer<typeof ReportTaskRecordSchema>;

export const ResponsibilityReportContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  domains: z.array(DomainSchema).max(100),
  tasks: z.array(ReportTaskRecordSchema).max(500),
  signals: z.array(ReportSignalRecordSchema).max(500),
  evidence: z.array(PersistedEvidenceSnapshotSchema).max(1_000),
});
export type ResponsibilityReportContext = z.infer<
  typeof ResponsibilityReportContextSchema
>;
