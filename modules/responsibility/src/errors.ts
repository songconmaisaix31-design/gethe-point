export const RESPONSIBILITY_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_version",
  "consent_invalid",
  "evidence_missing",
  "idempotency_conflict",
  "needs_human_review",
  "internal_failure",
] as const;

export type ResponsibilityErrorCode =
  (typeof RESPONSIBILITY_ERROR_CODES)[number];

export interface ResponsibilityError extends Error {
  readonly code: ResponsibilityErrorCode;
  readonly name: "ResponsibilityError";
}

const SAFE_MESSAGES: Readonly<Record<ResponsibilityErrorCode, string>> = {
  conflict: "The responsibility request conflicts with current state.",
  consent_invalid: "The source signal does not have active sharing consent.",
  evidence_missing: "Required responsibility evidence is unavailable.",
  forbidden: "The actor cannot access this responsibility record.",
  idempotency_conflict: "The idempotency key belongs to another request.",
  internal_failure: "The responsibility operation failed safely.",
  invalid_request: "The responsibility request is invalid.",
  needs_human_review: "The responsibility source requires human review.",
  not_found: "The responsibility source was not found.",
  stale_version: "The responsibility record has changed.",
  unauthenticated: "A valid explicit member actor is required.",
};

export const createResponsibilityError = (
  code: ResponsibilityErrorCode,
): ResponsibilityError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "ResponsibilityError" as const,
  });

export const isResponsibilityError = (
  error: unknown,
): error is ResponsibilityError =>
  error instanceof Error &&
  error.name === "ResponsibilityError" &&
  "code" in error &&
  RESPONSIBILITY_ERROR_CODES.some((code) => code === error.code);
