import type { SafeErrorCode } from "../contracts.ts";

export type DomainError = Error & { readonly code: SafeErrorCode };

export function domainError(
  code: SafeErrorCode,
  message: string,
): DomainError {
  return Object.assign(new Error(message), { name: "DomainError", code });
}

export function assertDomain(
  condition: unknown,
  code: SafeErrorCode,
  message: string,
): asserts condition {
  if (!condition) {
    throw domainError(code, message);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return (
    error instanceof Error &&
    error.name === "DomainError" &&
    "code" in error &&
    typeof error.code === "string"
  );
}
