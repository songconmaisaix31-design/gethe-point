import {
  RequestIdSchema,
  type ContractError,
  type ContractErrorCode,
  type RequestId,
} from "../../../packages/contracts/src/index";

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_request: "The request is invalid.",
  unauthenticated: "Authentication is required.",
  forbidden: "The operation is not allowed.",
  not_found: "The requested record was not found.",
  conflict: "The requested state conflicts with an existing record.",
  stale_version: "The record version has changed.",
  consent_required: "An active share decision is required.",
  consent_invalid: "The consent decision is not valid for this operation.",
  visibility_denied: "The requested visibility is not allowed.",
  evidence_missing: "Required evidence is not available.",
  handover_blocked: "The handover is blocked.",
  confirmation_required: "Human confirmation is required.",
  transition_denied: "The state transition is not allowed.",
  terminal_state: "The record is already in a terminal state.",
  care_rule_inactive: "The care rule is not active.",
  idempotency_conflict: "The idempotency key belongs to another request.",
  provider_timeout: "The drafting provider timed out.",
  provider_invalid_output: "The drafting provider returned invalid output.",
  provider_unavailable: "The drafting provider is unavailable.",
  needs_human_review: "Human review is required.",
  deletion_confirmation_required: "Exact deletion confirmation is required.",
  export_not_authorized: "The export is not authorized.",
  internal_failure: "The operation could not be completed.",
} as const satisfies Readonly<Record<ContractErrorCode, string>>);

const RETRYABLE_ERRORS = new Set<ContractErrorCode>([
  "provider_timeout",
  "provider_invalid_output",
  "provider_unavailable",
  "internal_failure",
]);

export const createSafeContractError = <Code extends ContractErrorCode>(
  code: Code,
  requestId: RequestId,
): ContractError<Code> =>
  Object.freeze({
    code,
    message: SAFE_ERROR_MESSAGES[code],
    requestId,
    retryable: RETRYABLE_ERRORS.has(code),
  });

export const requestIdFromUnknown = (
  input: unknown,
  fallback: () => RequestId,
): RequestId => {
  const candidate =
    typeof input === "object" && input !== null && "requestId" in input
      ? input.requestId
      : undefined;
  const parsed = RequestIdSchema.safeParse(candidate);

  return parsed.success ? parsed.data : fallback();
};
