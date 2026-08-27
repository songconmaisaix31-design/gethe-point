import { z } from "zod";

import {
  DomainSchema,
  EntityIdSchema,
  EvidenceStateSchema,
  MemberSchema,
  RecordVersionSchema,
  SharedSignalSchema,
  SignalDraftKindSchema,
  SpaceSchema,
  TaskSchema,
} from "../../../packages/contracts/src/index";

export const PersistedEvidenceSnapshotSchema = z.strictObject({
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  speakerId: EntityIdSchema,
  state: EvidenceStateSchema,
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

export const ReportSignalRecordSchema = z.strictObject({
  signal: SharedSignalSchema,
  sourceKind: SignalDraftKindSchema,
  taskIds: z.array(EntityIdSchema).max(100),
  domainIds: z.array(EntityIdSchema).max(50),
});
export type ReportSignalRecord = z.infer<typeof ReportSignalRecordSchema>;

export const ResponsibilityReportContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  domains: z.array(DomainSchema).max(100),
  tasks: z.array(TaskSchema).max(500),
  signals: z.array(ReportSignalRecordSchema).max(500),
  evidence: z.array(PersistedEvidenceSnapshotSchema).max(1_000),
});
export type ResponsibilityReportContext = z.infer<
  typeof ResponsibilityReportContextSchema
>;

export const VersionGuardEntrySchema = z.strictObject({
  id: EntityIdSchema,
  version: RecordVersionSchema,
});
export type VersionGuardEntry = z.infer<typeof VersionGuardEntrySchema>;

export const AttributionCorrectionGuardSchema = z.strictObject({
  space: VersionGuardEntrySchema,
  actorMember: VersionGuardEntrySchema,
  domain: VersionGuardEntrySchema,
  task: VersionGuardEntrySchema,
  members: z.array(VersionGuardEntrySchema).min(1).max(3),
  evidence: z.array(VersionGuardEntrySchema).min(1).max(20),
});
export type AttributionCorrectionGuard = z.infer<
  typeof AttributionCorrectionGuardSchema
>;
