import type { ContractErrorCode } from "../../../packages/contracts/src/index";

export const CONVERSATION_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

export type ConversationErrorCode =
  (typeof CONVERSATION_ERROR_CODES)[number];

export interface ConversationError extends Error {
  readonly code: ConversationErrorCode;
  readonly name: "ConversationError";
}

const SAFE_MESSAGES: Readonly<Record<ConversationErrorCode, string>> = {
  conflict: "The private message conflicts with an existing request.",
  forbidden: "The actor is not allowed to perform this conversation operation.",
  internal_failure: "The conversation operation failed safely.",
  invalid_request: "The conversation request is invalid.",
  not_found: "The requested private conversation resource was not found.",
  unauthenticated: "A valid explicit actor is required.",
};

export const createConversationError = (
  code: ConversationErrorCode,
): ConversationError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "ConversationError" as const,
  });

export const isConversationError = (
  error: unknown,
): error is ConversationError =>
  error instanceof Error &&
  error.name === "ConversationError" &&
  "code" in error &&
  CONVERSATION_ERROR_CODES.some((code) => code === error.code);
