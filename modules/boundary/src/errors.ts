import type { ContractErrorCode } from "../../../packages/contracts/src/index";

export const PRIVATE_SHARING_ERROR_CODES = [
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

export type PrivateSharingErrorCode =
  (typeof PRIVATE_SHARING_ERROR_CODES)[number];

export interface PrivateSharingError extends Error {
  readonly code: PrivateSharingErrorCode;
  readonly name: "PrivateSharingError";
}

const SAFE_MESSAGES: Readonly<Record<PrivateSharingErrorCode, string>> = {
  conflict: "The consent or signal conflicts with current state.",
  consent_invalid: "The consent does not authorize this shared signal.",
  consent_required: "Explicit active consent is required before sharing.",
  forbidden: "The actor is not allowed to perform this sharing operation.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  internal_failure: "The private sharing operation failed safely.",
  invalid_request: "The private sharing request is invalid.",
  not_found: "The requested private sharing resource was not found.",
  stale_version: "The signal draft has changed.",
  unauthenticated: "A valid explicit actor is required.",
  visibility_denied: "The requested shared visibility is not allowed.",
};

export const createPrivateSharingError = (
  code: PrivateSharingErrorCode,
): PrivateSharingError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "PrivateSharingError" as const,
  });

export const isPrivateSharingError = (
  error: unknown,
): error is PrivateSharingError =>
  error instanceof Error &&
  error.name === "PrivateSharingError" &&
  "code" in error &&
  PRIVATE_SHARING_ERROR_CODES.some((code) => code === error.code);
