import { z } from "zod";

import {
  EntityIdSchema,
  RequestIdSchema,
} from "../../../packages/contracts/src/index";

export const ConversationOperationSchema = z.enum([
  "CreatePrivateMessage",
  "CreateSignalDraft",
  "DecideConsent",
  "ConfirmSignal",
  "GetPrivateConversation",
  "GetRawEvidence",
  "GetVisibleSharedSignals",
]);
export type ConversationOperation = z.infer<
  typeof ConversationOperationSchema
>;

export const SafeOperationOutcomeSchema = z.enum([
  "created",
  "draft_created",
  "decision_recorded",
  "confirmed",
  "ready",
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
  "provider_timeout",
  "provider_invalid_output",
  "provider_unavailable",
  "needs_human_review",
  "high_risk_bypassed",
  "internal_failure",
]);
export type SafeOperationOutcome = z.infer<
  typeof SafeOperationOutcomeSchema
>;

export const SafeOperationLogSchema = z.strictObject({
  operation: ConversationOperationSchema,
  requestId: RequestIdSchema,
  spaceId: EntityIdSchema.nullable(),
  actorId: EntityIdSchema.nullable(),
  outcome: SafeOperationOutcomeSchema,
  recordIds: z.array(EntityIdSchema).max(12),
  attempt: z.union([z.literal(1), z.literal(2)]).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
});
export type SafeOperationLog = z.infer<typeof SafeOperationLogSchema>;

export interface SafeLogger {
  write(event: SafeOperationLog): void;
}

export const NOOP_SAFE_LOGGER: SafeLogger = Object.freeze({
  write: () => undefined,
});

export const writeSafeLog = (
  logger: SafeLogger,
  event: SafeOperationLog,
): void => {
  const safeEvent = Object.freeze(SafeOperationLogSchema.parse(event));

  try {
    logger.write(safeEvent);
  } catch {
    // Diagnostics are deliberately unable to change product behavior.
  }
};
