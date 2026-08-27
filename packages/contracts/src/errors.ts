import { z } from "zod";

import {
  RequestIdSchema,
  SafeErrorMessageSchema,
  type RequestId,
} from "./primitives";

export const ContractErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_version",
  "consent_required",
  "consent_invalid",
  "visibility_denied",
  "evidence_missing",
  "handover_blocked",
  "confirmation_required",
  "transition_denied",
  "terminal_state",
  "care_rule_inactive",
  "idempotency_conflict",
  "provider_timeout",
  "provider_invalid_output",
  "provider_unavailable",
  "needs_human_review",
  "deletion_confirmation_required",
  "export_not_authorized",
  "internal_failure",
]);
export type ContractErrorCode = z.infer<typeof ContractErrorCodeSchema>;

export const ContractErrorSchema = z.strictObject({
  code: ContractErrorCodeSchema,
  requestId: RequestIdSchema,
  message: SafeErrorMessageSchema,
  retryable: z.boolean(),
});
export type AnyContractError = z.infer<typeof ContractErrorSchema>;

export type ContractError<Code extends ContractErrorCode> = Readonly<{
  code: Code;
  requestId: RequestId;
  message: string;
  retryable: boolean;
}>;

export type TransportResult<Result, Error extends AnyContractError> =
  | Readonly<{ ok: true; result: Result }>
  | Readonly<{ ok: false; error: Error }>;
