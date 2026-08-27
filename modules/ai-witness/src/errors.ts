import type { ContractErrorCode } from "../../../packages/contracts/src/index";

export const WITNESS_ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "needs_human_review",
  "internal_failure",
] as const satisfies readonly ContractErrorCode[];

export type WitnessErrorCode = (typeof WITNESS_ERROR_CODES)[number];

export interface WitnessError extends Error {
  readonly code: WitnessErrorCode;
  readonly name: "WitnessError";
}

const SAFE_MESSAGES: Readonly<Record<WitnessErrorCode, string>> = {
  conflict: "The signal draft conflicts with current state.",
  forbidden: "The actor is not allowed to create this signal draft.",
  internal_failure: "The signal draft operation failed safely.",
  invalid_request: "The signal draft request is invalid.",
  needs_human_review: "The content needs human review before any sharing decision.",
  not_found: "The requested private source was not found.",
  unauthenticated: "A valid explicit actor is required.",
};

export const createWitnessError = (code: WitnessErrorCode): WitnessError =>
  Object.assign(new Error(SAFE_MESSAGES[code]), {
    code,
    name: "WitnessError" as const,
  });

export const isWitnessError = (error: unknown): error is WitnessError =>
  error instanceof Error &&
  error.name === "WitnessError" &&
  "code" in error &&
  WITNESS_ERROR_CODES.some((code) => code === error.code);
