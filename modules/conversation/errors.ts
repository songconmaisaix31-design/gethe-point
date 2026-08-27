import type { ContractErrorCode } from "../../packages/contracts/src/index";

export type ConversationErrorCode = Extract<
  ContractErrorCode,
  | "conflict"
  | "consent_invalid"
  | "consent_required"
  | "forbidden"
  | "idempotency_conflict"
  | "internal_failure"
  | "invalid_request"
  | "not_found"
  | "stale_version"
  | "unauthenticated"
  | "visibility_denied"
>;

const SAFE_MESSAGES: Readonly<Record<ConversationErrorCode, string>> = {
  conflict: "The requested operation conflicts with current state.",
  consent_invalid: "The consent decision is not valid for this operation.",
  consent_required: "A current share consent decision is required.",
  forbidden: "The actor is not allowed to perform this operation.",
  idempotency_conflict:
    "The idempotency key belongs to a different request.",
  internal_failure: "The conversation operation failed.",
  invalid_request: "The conversation request is invalid.",
  not_found: "The requested record was not found.",
  stale_version: "The requested state changed before it could be saved.",
  unauthenticated: "A valid authenticated member actor is required.",
  visibility_denied: "The requested visibility is not authorized.",
};

export class ConversationOperationError extends Error {
  readonly code: ConversationErrorCode;
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(
    code: ConversationErrorCode,
    requestId: string,
    retryable = false,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "ConversationOperationError";
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export const isConversationOperationError = (
  error: unknown,
): error is ConversationOperationError =>
  error instanceof Error && error.name === "ConversationOperationError";
