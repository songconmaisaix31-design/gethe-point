import { z } from "zod";

import {
  DomainSchema,
  EntityIdSchema,
  IdempotencyKeySchema,
  MemberSchema,
  RecordVersionSchema,
  RequestHashSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SharedVisibilitySchema,
  ShortTextSchema,
  SignalDraftKindSchema,
  SpaceSchema,
  TaskSchema,
  TimestampSchema,
} from "../../../packages/contracts/src/index";

import {
  PersistedEvidenceSnapshotSchema,
  VersionGuardEntrySchema,
  hasUniqueIds,
} from "../../responsibility";

const boundedVersionReferences = (maximum: number) =>
  z
    .array(VersionGuardEntrySchema)
    .min(1)
    .max(maximum)
    .refine(
      (references) => hasUniqueIds(references.map(({ id }) => id)),
      "References must be unique.",
    );

export const DomainSuggestionRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  spaceId: EntityIdSchema,
  expectedSpaceVersion: RecordVersionSchema,
  expectedActorVersion: RecordVersionSchema,
  tasks: boundedVersionReferences(20),
  signals: boundedVersionReferences(20),
  evidence: boundedVersionReferences(50),
  promptVersion: z.string().trim().min(1).max(80),
  timeoutMs: z.number().int().min(100).max(10_000),
});
export type DomainSuggestionRequest = z.infer<
  typeof DomainSuggestionRequestSchema
>;

export const DomainSuggestionSelectionSchema = z.strictObject({
  spaceId: EntityIdSchema,
  expectedSpaceVersion: RecordVersionSchema,
  expectedActorVersion: RecordVersionSchema,
  tasks: boundedVersionReferences(20),
  signals: boundedVersionReferences(20),
  evidence: boundedVersionReferences(50),
});
export type DomainSuggestionSelection = z.infer<
  typeof DomainSuggestionSelectionSchema
>;

export const DomainSuggestionOutputSchema = z.strictObject({
  name: ShortTextSchema,
  nextAction: ShortTextSchema.nullable(),
});
export type DomainSuggestionOutput = z.infer<
  typeof DomainSuggestionOutputSchema
>;

export const DOMAIN_SUGGESTION_OUTPUT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["name", "nextAction"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    nextAction: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 160 },
        { type: "null" },
      ],
    },
  },
} as const);

export const DomainSuggestionSignalRecordSchema = z.strictObject({
  signal: SharedSignalSchema,
  sourceKind: SignalDraftKindSchema,
});
export type DomainSuggestionSignalRecord = z.infer<
  typeof DomainSuggestionSignalRecordSchema
>;

export const DomainSuggestionContextSchema = z.strictObject({
  space: SpaceSchema,
  actorMember: MemberSchema,
  members: z.array(MemberSchema).min(1).max(3),
  tasks: z.array(TaskSchema).min(1).max(20),
  signals: z.array(DomainSuggestionSignalRecordSchema).min(1).max(20),
  evidence: z.array(PersistedEvidenceSnapshotSchema).min(1).max(50),
});
export type DomainSuggestionContext = z.infer<
  typeof DomainSuggestionContextSchema
>;

export const DomainSuggestionGuardSchema = z.strictObject({
  space: VersionGuardEntrySchema,
  actorMember: VersionGuardEntrySchema,
  members: z.array(VersionGuardEntrySchema).min(1).max(3),
  tasks: z.array(VersionGuardEntrySchema).min(1).max(20),
  signals: z.array(VersionGuardEntrySchema).min(1).max(20),
  evidence: z.array(VersionGuardEntrySchema).min(1).max(50),
});
export type DomainSuggestionGuard = z.infer<
  typeof DomainSuggestionGuardSchema
>;

export const DomainSuggestionMetadataSchema = z.strictObject({
  requestId: RequestIdSchema,
  purpose: z.literal("domain_draft"),
  promptVersion: z.string().trim().min(1).max(80),
  attempts: z.union([z.literal(1), z.literal(2)]),
  providerOutcome: z.enum([
    "validated",
    "invalid_output",
    "timeout",
    "unavailable",
  ]),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  contentLogged: z.literal(false),
});
export type DomainSuggestionMetadata = z.infer<
  typeof DomainSuggestionMetadataSchema
>;

export const DomainDraftContentSchema = z.strictObject({
  domainId: EntityIdSchema,
  spaceId: EntityIdSchema,
  requestedByMemberId: EntityIdSchema,
  suggestion: DomainSuggestionOutputSchema,
  visibility: SharedVisibilitySchema,
  evidenceIds: z
    .array(EntityIdSchema)
    .min(1)
    .max(50)
    .refine(hasUniqueIds, "Evidence identifiers must be unique."),
  selection: DomainSuggestionSelectionSchema,
  guard: DomainSuggestionGuardSchema,
  promptVersion: z.string().trim().min(1).max(80),
  createdAt: TimestampSchema,
  source: z.literal("validated_ai"),
  status: z.literal("awaiting_human_confirmation"),
  metadata: DomainSuggestionMetadataSchema,
});
export type DomainDraftContent = z.infer<typeof DomainDraftContentSchema>;

export const StoredDomainDraftSchema = DomainDraftContentSchema.extend({
  integrityHash: RequestHashSchema,
});
export type StoredDomainDraft = z.infer<typeof StoredDomainDraftSchema>;

export const OpaqueDraftReceiptSchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9._~-]+$/u);
export type OpaqueDraftReceipt = z.infer<typeof OpaqueDraftReceiptSchema>;

export const DomainSuggestionReceiptSchema = z.strictObject({
  status: z.literal("awaiting_human_confirmation"),
  draftReceipt: OpaqueDraftReceiptSchema,
  suggestion: DomainSuggestionOutputSchema,
  metadata: DomainSuggestionMetadataSchema,
});
export type DomainSuggestionReceipt = z.infer<
  typeof DomainSuggestionReceiptSchema
>;

export const DomainSuggestionReviewSchema = z.strictObject({
  status: z.literal("needs_human_review"),
  reason: z.enum([
    "provider_invalid_output",
    "provider_timeout",
    "provider_unavailable",
    "authorization_changed",
    "evidence_changed",
    "version_changed",
  ]),
  attempts: z.union([z.literal(1), z.literal(2)]),
  consequentialMutationAllowed: z.literal(false),
  metadata: DomainSuggestionMetadataSchema,
});
export type DomainSuggestionReview = z.infer<
  typeof DomainSuggestionReviewSchema
>;

export const ConfirmDomainSuggestionRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  draftReceipt: OpaqueDraftReceiptSchema,
});
export type ConfirmDomainSuggestionRequest = z.infer<
  typeof ConfirmDomainSuggestionRequestSchema
>;

export const IssueDomainDraftResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("issued"),
    draftReceipt: OpaqueDraftReceiptSchema,
  }),
  z.strictObject({ status: z.literal("conflict") }),
]);

export const LoadDomainDraftResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    draft: StoredDomainDraftSchema,
  }),
  z.strictObject({ status: z.literal("not_found") }),
  z.strictObject({ status: z.literal("consumed") }),
]);

export const PersistConfirmedDomainResultSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.enum(["persisted", "replayed"]),
      domain: DomainSchema,
    }),
    z.strictObject({
      status: z.enum([
        "not_found",
        "forbidden",
        "stale_version",
        "receipt_consumed",
        "idempotency_conflict",
        "conflict",
      ]),
    }),
  ],
);
