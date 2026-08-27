import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  DetailTextSchema,
  EntityIdSchema,
  RedactedExcerptSchema,
  ShortTextSchema,
  type AIExecutionMetadata,
  type EntityId,
  type LLMProvider,
  type LLMProviderResult,
  type NeedsHumanReview,
  type RequestId,
} from "../../../packages/contracts/src/index";
import {
  ProviderRedactedInputSchema,
  isMinimumRedactedExcerpt,
  writeSafeLog,
  type SafeLogger,
} from "../../boundary/src/index";

export const SignalDraftCandidateSchema = z.strictObject({
  kind: z.enum(["potential_task", "discussion_only", "high_risk"]),
  redactedExcerpt: RedactedExcerptSchema,
  proposedConclusion: DetailTextSchema,
  candidateDomainId: EntityIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(ShortTextSchema).max(20),
});
export type SignalDraftCandidate = z.infer<typeof SignalDraftCandidateSchema>;

const ProviderResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    completion: z.strictObject({
      output: z.unknown(),
      latencyMs: z.number().int().nonnegative(),
      usage: z.strictObject({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      }),
    }),
  }),
  z.strictObject({
    status: z.literal("failed"),
    failure: z.strictObject({
      code: z.enum([
        "provider_timeout",
        "provider_invalid_output",
        "provider_unavailable",
      ]),
      retryable: z.boolean(),
    }),
  }),
]);

const ProviderTimeoutSchema = z.number().int().min(1).max(60_000);

export interface SignalDraftGenerationInput {
  readonly actorId: EntityId;
  readonly spaceId: EntityId;
  readonly requestId: RequestId;
  readonly promptVersion: string;
  readonly redactedInput: string;
  readonly privateInputs: readonly string[];
}

export interface ValidatedSignalDraftCandidate {
  readonly status: "validated";
  readonly candidate: SignalDraftCandidate;
  readonly source: "fixture" | "validated_ai";
  readonly metadata: AIExecutionMetadata;
}

export type SignalDraftGenerationResult =
  | ValidatedSignalDraftCandidate
  | NeedsHumanReview;

export interface SignalDraftGenerator {
  generate(
    input: Readonly<SignalDraftGenerationInput>,
  ): Promise<SignalDraftGenerationResult>;
}

export interface SignalDraftGeneratorOptions {
  readonly provider: LLMProvider;
  readonly source: "fixture" | "validated_ai";
  readonly timeoutMs?: number;
  readonly logger: SafeLogger;
}

const failedProviderResult = (
  code:
    | "provider_timeout"
    | "provider_invalid_output"
    | "provider_unavailable",
): LLMProviderResult => ({
  status: "failed",
  failure: { code, retryable: true },
});

const completeWithTimeout = async (
  provider: LLMProvider,
  request: Parameters<LLMProvider["complete"]>[0],
  timeoutMs: number,
): Promise<LLMProviderResult> => {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<LLMProviderResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(failedProviderResult("provider_timeout"));
    }, timeoutMs);
  });

  const completion = Promise.resolve()
    .then(async () => provider.complete(request, controller.signal))
    .catch(() => failedProviderResult("provider_unavailable"));

  const result = await Promise.race([completion, timeout]);

  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  return result;
};

const providerOutcomeForFailure = (
  failure:
    | "provider_timeout"
    | "provider_invalid_output"
    | "provider_unavailable",
): AIExecutionMetadata["providerOutcome"] => {
  switch (failure) {
    case "provider_timeout":
      return "timeout";
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_unavailable":
      return "unavailable";
  }
};

export const createSignalDraftGenerator = (
  options: Readonly<SignalDraftGeneratorOptions>,
): SignalDraftGenerator => {
  const timeoutMs = ProviderTimeoutSchema.parse(options.timeoutMs ?? 4_000);
  const outputSchema = z.toJSONSchema(SignalDraftCandidateSchema);

  return Object.freeze({
    generate: async (
      input: Readonly<SignalDraftGenerationInput>,
    ): Promise<SignalDraftGenerationResult> => {
      const redactedInput = ProviderRedactedInputSchema.parse(input.redactedInput);
      let totalLatencyMs = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let lastFailure:
        | "provider_timeout"
        | "provider_invalid_output"
        | "provider_unavailable" = "provider_invalid_output";

      for (const attempt of [1, 2] as const) {
        const startedAt = performance.now();
        const rawResult = await completeWithTimeout(
          options.provider,
          {
            attempt,
            outputSchema,
            promptVersion: input.promptVersion,
            purpose: "signal_draft",
            redactedInput,
            requestId: input.requestId,
            timeoutMs,
          },
          timeoutMs,
        );
        const measuredLatencyMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        const providerResult = ProviderResultSchema.safeParse(rawResult);

        if (!providerResult.success) {
          lastFailure = "provider_invalid_output";
          totalLatencyMs += measuredLatencyMs;
        } else if (providerResult.data.status === "failed") {
          lastFailure = providerResult.data.failure.code;
          totalLatencyMs += measuredLatencyMs;
        } else {
          const { completion } = providerResult.data;
          totalLatencyMs += completion.latencyMs;
          inputTokens += completion.usage.inputTokens;
          outputTokens += completion.usage.outputTokens;
          const candidate = SignalDraftCandidateSchema.safeParse(completion.output);

          if (
            candidate.success &&
            isMinimumRedactedExcerpt(
              candidate.data.redactedExcerpt,
              input.privateInputs,
            )
          ) {
            const metadata = AIExecutionMetadataSchema.parse({
              attempts: attempt,
              contentLogged: false,
              inputTokens,
              latencyMs: totalLatencyMs,
              outputTokens,
              promptVersion: input.promptVersion,
              providerOutcome:
                options.source === "fixture" ? "fixture" : "validated",
              purpose: "signal_draft",
              requestId: input.requestId,
            });

            return Object.freeze({
              candidate: Object.freeze(candidate.data),
              metadata,
              source: options.source,
              status: "validated" as const,
            });
          }

          lastFailure = "provider_invalid_output";
        }

        writeSafeLog(options.logger, {
          actorId: input.actorId,
          attempt,
          latencyMs: measuredLatencyMs,
          operation: "CreateSignalDraft",
          outcome: lastFailure,
          recordIds: [],
          requestId: input.requestId,
          spaceId: input.spaceId,
        });
      }

      const metadata = AIExecutionMetadataSchema.parse({
        attempts: 2,
        contentLogged: false,
        inputTokens,
        latencyMs: totalLatencyMs,
        outputTokens,
        promptVersion: input.promptVersion,
        providerOutcome: providerOutcomeForFailure(lastFailure),
        purpose: "signal_draft",
        requestId: input.requestId,
      });

      return Object.freeze({
        attempts: 2,
        consequentialMutationAllowed: false,
        metadata,
        reason: lastFailure,
        status: "needs_human_review" as const,
      });
    },
  });
};
