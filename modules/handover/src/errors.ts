import type { ContractErrorCode } from "../../../packages/contracts/src/index";

export const HANDOVER_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "stale_version",
  "handover_blocked",
  "confirmation_required",
  "transition_denied",
  "terminal_state",
  "idempotency_conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

export type HandoverErrorCode = (typeof HANDOVER_ERROR_CODES)[number];

export interface HandoverError extends Error {
  readonly code: HandoverErrorCode;
  readonly name: "HandoverError";
}

const SAFE_MESSAGES: Readonly<Record<HandoverErrorCode, string>> = {
  confirmation_required: "Both handover confirmations are required.",
  conflict: "The handover request conflicts with current state.",
  forbidden: "The actor is not allowed to perform this handover operation.",
  handover_blocked: "Required handover information is still missing.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  internal_failure: "The handover operation failed safely.",
  invalid_request: "The handover request is invalid.",
  not_found: "The requested handover resource was not found.",
  stale_version: "The handover state has changed.",
  terminal_state: "The handover is already terminal.",
  transition_denied: "The requested handover transition is not allowed.",
  unauthenticated: "A valid explicit actor is required.",
};

export const createHandoverError = (
  code: HandoverErrorCode,
): HandoverError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "HandoverError" as const,
  });

export const isHandoverError = (error: unknown): error is HandoverError =>
  error instanceof Error &&
  error.name === "HandoverError" &&
  "code" in error &&
  HANDOVER_ERROR_CODES.some((code) => code === error.code);
