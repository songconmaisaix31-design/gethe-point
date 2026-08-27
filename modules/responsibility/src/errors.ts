export type ResponsibilityErrorCode =
  | "confirmation_required"
  | "evidence_missing"
  | "forbidden"
  | "idempotency_conflict"
  | "internal_failure"
  | "invalid_request"
  | "invariant_violation"
  | "not_found"
  | "stale_version";

export interface ResponsibilityError extends Error {
  readonly code: ResponsibilityErrorCode;
  readonly name: "ResponsibilityError";
}

const SAFE_MESSAGES: Readonly<Record<ResponsibilityErrorCode, string>> = {
  confirmation_required: "The responsibility change needs explicit confirmation.",
  evidence_missing: "Current authorized evidence is required for this responsibility change.",
  forbidden: "The actor is not allowed to perform this responsibility operation.",
  idempotency_conflict: "The idempotency key belongs to a different responsibility request.",
  internal_failure: "The responsibility operation failed.",
  invalid_request: "The responsibility request is invalid.",
  invariant_violation: "The persisted responsibility data violates a required invariant.",
  not_found: "The requested responsibility record was not found.",
  stale_version: "The responsibility record has changed.",
};

export const responsibilityError = (
  code: ResponsibilityErrorCode,
): ResponsibilityError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "ResponsibilityError" as const,
  });

export const isResponsibilityError = (
  error: unknown,
): error is ResponsibilityError =>
  error instanceof Error && error.name === "ResponsibilityError";
