import { z } from "zod";

import {
  EntityIdSchema,
  RawEvidenceViewSchema,
  RequestIdSchema,
  SharedSignalSchema,
  type ContractError,
  type EntityId,
  type RawEvidenceView,
  type SharedSignal,
  type TransportResult,
} from "../../../packages/contracts/src/index";

export const ReadRawEvidenceRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  evidenceId: EntityIdSchema,
});
export type ReadRawEvidenceRequest = z.infer<
  typeof ReadRawEvidenceRequestSchema
>;

export const ReadRawEvidenceResultSchema = z.strictObject({
  status: z.literal("ready"),
  evidence: RawEvidenceViewSchema,
});
export type ReadRawEvidenceResult = Readonly<{
  status: "ready";
  evidence: RawEvidenceView;
}>;

export const ReadSharedConclusionRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  signalId: EntityIdSchema,
});
export type ReadSharedConclusionRequest = z.infer<
  typeof ReadSharedConclusionRequestSchema
>;

export const ReadSharedConclusionResultSchema = z.strictObject({
  status: z.literal("ready"),
  signal: SharedSignalSchema,
});
export type ReadSharedConclusionResult = Readonly<{
  status: "ready";
  signal: SharedSignal;
}>;

export const AuthorizeFutureAnalysisRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(10),
});
export type AuthorizeFutureAnalysisRequest = z.infer<
  typeof AuthorizeFutureAnalysisRequestSchema
>;

export const AuthorizeFutureAnalysisResultSchema = z.strictObject({
  status: z.literal("authorized"),
  memberId: EntityIdSchema,
  evidenceIds: z.array(EntityIdSchema).min(1).max(10),
  contentReleased: z.literal(false),
});
export type AuthorizeFutureAnalysisResult = Readonly<{
  status: "authorized";
  memberId: EntityId;
  evidenceIds: readonly EntityId[];
  contentReleased: false;
}>;

export type PrivacyErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "stale_version"
  | "consent_invalid"
  | "idempotency_conflict"
  | "deletion_confirmation_required"
  | "export_not_authorized"
  | "internal_failure";

export type PrivacyError = ContractError<PrivacyErrorCode>;
export type PrivacyResult<Result> = TransportResult<Result, PrivacyError>;
