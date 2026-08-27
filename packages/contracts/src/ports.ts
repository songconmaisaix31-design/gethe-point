import { z } from "zod";

import type { ActorRef } from "./actors";
import type { ContractErrorCode } from "./errors";
import type { DomainEvent } from "./events";
import {
  EntityIdSchema,
  IdempotencyKeySchema,
  RequestHashSchema,
  RequestIdSchema,
  TimestampSchema,
  type EntityId,
  type IdempotencyKey,
  type RequestHash,
  type RequestId,
  type Timestamp,
} from "./primitives";

export interface Clock {
  now(): Date;
}

export const LLMDraftPurposeSchema = z.enum([
  "signal_draft",
  "domain_draft",
  "handover_packet",
  "care_rule_draft",
]);
export type LLMDraftPurpose = z.infer<typeof LLMDraftPurposeSchema>;

export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

export interface LLMProviderRequest {
  readonly requestId: RequestId;
  readonly purpose: LLMDraftPurpose;
  readonly promptVersion: string;
  readonly redactedInput: string;
  readonly outputSchema: JsonSchemaDocument;
  readonly timeoutMs: number;
  readonly attempt: 1 | 2;
}

export interface LLMProviderCompletion {
  readonly output: unknown;
  readonly latencyMs: number;
  readonly usage: Readonly<{
    inputTokens: number;
    outputTokens: number;
  }>;
}

export interface LLMProviderFailure {
  readonly code:
    | "provider_timeout"
    | "provider_invalid_output"
    | "provider_unavailable";
  readonly retryable: boolean;
}

export type LLMProviderResult =
  | Readonly<{ status: "completed"; completion: LLMProviderCompletion }>
  | Readonly<{ status: "failed"; failure: LLMProviderFailure }>;

export interface LLMProvider {
  complete(
    request: Readonly<LLMProviderRequest>,
    signal: AbortSignal,
  ): Promise<LLMProviderResult>;
}

export const AI_ATTEMPT_POLICY = Object.freeze({
  maxAttempts: 2,
  maxRetries: 1,
  retryableFailures: Object.freeze([
    "provider_invalid_output",
    "provider_timeout",
    "provider_unavailable",
  ] as const),
  fallback: "needs_human_review",
  consequentialMutationAllowed: false,
} as const);

export const AIExecutionMetadataSchema = z.strictObject({
  requestId: RequestIdSchema,
  purpose: LLMDraftPurposeSchema,
  promptVersion: z.string().min(1).max(80),
  attempts: z.union([z.literal(1), z.literal(2)]),
  providerOutcome: z.enum([
    "validated",
    "invalid_output",
    "timeout",
    "unavailable",
    "fixture",
  ]),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  contentLogged: z.literal(false),
});
export type AIExecutionMetadata = z.infer<typeof AIExecutionMetadataSchema>;

export const NeedsHumanReviewSchema = z.strictObject({
  status: z.literal("needs_human_review"),
  reason: z.enum([
    "provider_invalid_output",
    "provider_timeout",
    "provider_unavailable",
  ]),
  attempts: z.literal(2),
  consequentialMutationAllowed: z.literal(false),
  metadata: AIExecutionMetadataSchema,
});
export type NeedsHumanReview = z.infer<typeof NeedsHumanReviewSchema>;

export const IdempotencyScopeSchema = z.strictObject({
  spaceId: EntityIdSchema,
  operation: z.string().min(1).max(80),
  actorId: z.string().min(1).max(128),
});
export type IdempotencyScope = z.infer<typeof IdempotencyScopeSchema>;

export const IdempotencyClaimSchema = z.strictObject({
  key: IdempotencyKeySchema,
  scope: IdempotencyScopeSchema,
  requestHash: RequestHashSchema,
  claimedAt: TimestampSchema,
});
export type IdempotencyClaim = z.infer<typeof IdempotencyClaimSchema>;

export type IdempotencyClaimResult<Result> =
  | Readonly<{ status: "claimed"; claimId: EntityId }>
  | Readonly<{ status: "replay"; result: Result }>
  | Readonly<{
      status: "conflict";
      code: Extract<ContractErrorCode, "idempotency_conflict">;
    }>;

export interface IdempotencyStore<Result> {
  claim(
    key: IdempotencyKey,
    scope: IdempotencyScope,
    requestHash: RequestHash,
    claimedAt: Timestamp,
  ): Promise<IdempotencyClaimResult<Result>>;

  complete(claimId: EntityId, result: Result): Promise<void>;
}

export interface DomainEventPublisher {
  publish(events: readonly DomainEvent[], actor: ActorRef): Promise<void>;
}
