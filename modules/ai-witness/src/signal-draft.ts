import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  DetailTextSchema,
  EntityIdSchema,
  NeedsHumanReviewSchema,
  PrivateContentSchema,
  RedactedExcerptSchema,
  RequestIdSchema,
  ShortTextSchema,
  type AIExecutionMetadata,
  type LLMProvider,
  type LLMProviderResult,
  type NeedsHumanReview,
} from "../../../packages/contracts/src/index";
import {
  HighRiskCategorySchema,
  ProviderRedactedInputSchema,
  areProviderDerivedFieldsSafe,
  writeSafeLog,
  type HighRiskCategory,
  type SafeLogger,
} from "../../boundary/src/index";

const MAX_PROVIDER_TIMEOUT_MS = 60_000;
const MAX_PROVIDER_TOKEN_COUNT = 1_000_000_000;

export const ProviderSignalIntentSchema = z.enum([
  "coordinate_schedule",
  "clarify_responsibility",
  "share_family_information",
  "discussion_only",
]);
export type ProviderSignalIntent = z.infer<
  typeof ProviderSignalIntentSchema
>;

export const ProviderMissingInfoCodeSchema = z.enum([
  "responsible_member",
  "target_time",
  "supporting_details",
]);
export type ProviderMissingInfoCode = z.infer<
  typeof ProviderMissingInfoCodeSchema
>;

/** The provider cannot author any text that reaches product state. */
export const ProviderSignalDraftFieldsSchema = z.strictObject({
  intent: ProviderSignalIntentSchema,
  confidence: z.number().min(0).max(1),
  missingInfoCodes: z
    .array(ProviderMissingInfoCodeSchema)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});
export type ProviderSignalDraftFields = z.infer<
  typeof ProviderSignalDraftFieldsSchema
>;

export const SignalDraftCandidateSchema = z.strictObject({
  kind: z.enum(["potential_task", "discussion_only", "high_risk"]),
  redactedExcerpt: RedactedExcerptSchema,
  proposedConclusion: DetailTextSchema,
  candidateDomainId: EntityIdSchema.nullable(),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(ShortTextSchema).max(20),
});
export type SignalDraftCandidate = z.infer<typeof SignalDraftCandidateSchema>;

const SignalDraftGenerationInputSchema = z.strictObject({
  actorId: EntityIdSchema,
  spaceId: EntityIdSchema,
  requestId: RequestIdSchema,
  promptVersion: z.string().min(1).max(80),
  redactedInput: ProviderRedactedInputSchema,
  privateInputs: z.array(PrivateContentSchema).min(1).max(11),
});
export type SignalDraftGenerationInput = z.infer<
  typeof SignalDraftGenerationInputSchema
>;

export const ValidatedSignalDraftCandidateSchema = z.strictObject({
  status: z.literal("validated"),
  candidate: SignalDraftCandidateSchema,
  source: z.enum(["fixture", "validated_ai", "human"]),
  metadata: AIExecutionMetadataSchema,
});
export type ValidatedSignalDraftCandidate = z.infer<
  typeof ValidatedSignalDraftCandidateSchema
>;

export const SignalDraftGenerationResultSchema = z.discriminatedUnion("status", [
  ValidatedSignalDraftCandidateSchema,
  NeedsHumanReviewSchema,
]);
export type SignalDraftGenerationResult = z.infer<
  typeof SignalDraftGenerationResultSchema
>;

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

const ProviderResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    completion: z.strictObject({
      output: z.unknown(),
      latencyMs: z.number().int().min(0).max(MAX_PROVIDER_TIMEOUT_MS),
      usage: z.strictObject({
        inputTokens: z.number().int().min(0).max(MAX_PROVIDER_TOKEN_COUNT),
        outputTokens: z.number().int().min(0).max(MAX_PROVIDER_TOKEN_COUNT),
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

const ProviderTimeoutSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PROVIDER_TIMEOUT_MS);

const INTENT_TEMPLATES: Readonly<
  Record<
    ProviderSignalIntent,
    Readonly<{
      kind: "potential_task" | "discussion_only";
      redactedExcerpt: string;
      proposedConclusion: string;
    }>
  >
> = Object.freeze({
  coordinate_schedule: Object.freeze({
    kind: "potential_task",
    redactedExcerpt: "发言人希望家人确认一项后续安排。",
    proposedConclusion: "需要由家人确认具体时间和后续安排。",
  }),
  clarify_responsibility: Object.freeze({
    kind: "potential_task",
    redactedExcerpt: "发言人希望家人明确后续责任。",
    proposedConclusion: "需要由家人确认责任归属和执行安排。",
  }),
  share_family_information: Object.freeze({
    kind: "discussion_only",
    redactedExcerpt: "发言人希望家人知晓一项信息。",
    proposedConclusion: "这是一条待家人确认的家庭信息，不会自动创建任务。",
  }),
  discussion_only: Object.freeze({
    kind: "discussion_only",
    redactedExcerpt: "发言人希望保留为家庭讨论信息。",
    proposedConclusion: "这是一条仅供家庭讨论的信息，不会创建任务。",
  }),
});

const MISSING_INFO_TEMPLATES: Readonly<
  Record<ProviderMissingInfoCode, string>
> = Object.freeze({
  responsible_member: "需要确认负责人。",
  target_time: "需要确认时间。",
  supporting_details: "需要补充必要信息。",
});

const HIGH_RISK_EXCERPTS: Readonly<Record<HighRiskCategory, string>> =
  Object.freeze({
    self_harm: "发言人可能需要立即获得现实中的安全支持。",
    domestic_violence: "发言人可能需要立即获得安全环境和现实支持。",
    acute_medical_symptom: "发言人可能需要立即获得现实中的医疗帮助。",
  });

/** Verifies that publishable provider text came from this module's templates. */
export const isApplicationTemplateSignalDraftCandidate = (
  candidate: Readonly<SignalDraftCandidate>,
): boolean => {
  const textMatches = Object.values(INTENT_TEMPLATES).some(
    (template) =>
      candidate.kind === template.kind &&
      candidate.redactedExcerpt === template.redactedExcerpt &&
      candidate.proposedConclusion === template.proposedConclusion,
  );
  const allowedMissingInfo = new Set(Object.values(MISSING_INFO_TEMPLATES));

  return (
    textMatches &&
    candidate.candidateDomainId === null &&
    candidate.missingInfo.every((value) => allowedMissingInfo.has(value)) &&
    new Set(candidate.missingInfo).size === candidate.missingInfo.length
  );
};

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

const outputAsUnknownJson = (output: unknown): unknown => {
  if (typeof output !== "string") {
    return output;
  }

  try {
    return JSON.parse(output) as unknown;
  } catch {
    return undefined;
  }
};

export const renderProviderSignalDraft = (
  providerFieldsInput: unknown,
  privateInputs: readonly string[],
): SignalDraftCandidate | undefined => {
  const providerFields = ProviderSignalDraftFieldsSchema.safeParse(
    outputAsUnknownJson(providerFieldsInput),
  );

  if (
    !providerFields.success ||
    !areProviderDerivedFieldsSafe(providerFields.data, privateInputs)
  ) {
    return undefined;
  }

  const template = INTENT_TEMPLATES[providerFields.data.intent];
  const candidate = SignalDraftCandidateSchema.parse({
    candidateDomainId: null,
    confidence: providerFields.data.confidence,
    kind: template.kind,
    missingInfo: providerFields.data.missingInfoCodes.map(
      (code) => MISSING_INFO_TEMPLATES[code],
    ),
    proposedConclusion: template.proposedConclusion,
    redactedExcerpt: template.redactedExcerpt,
  });

  return areProviderDerivedFieldsSafe(candidate, privateInputs)
    ? Object.freeze(candidate)
    : undefined;
};

export const createHighRiskSignalDraftCandidate = (
  categoryInput: HighRiskCategory,
  guidance: string,
): SignalDraftCandidate => {
  const category = HighRiskCategorySchema.parse(categoryInput);

  return Object.freeze(
    SignalDraftCandidateSchema.parse({
      candidateDomainId: null,
      confidence: 1,
      kind: "high_risk",
      missingInfo: [],
      proposedConclusion: guidance,
      redactedExcerpt: HIGH_RISK_EXCERPTS[category],
    }),
  );
};

export const createNeedsHumanReview = (
  input: Readonly<{
    requestId: string;
    promptVersion: string;
    reason:
      | "provider_timeout"
      | "provider_invalid_output"
      | "provider_unavailable";
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  }>,
): NeedsHumanReview =>
  NeedsHumanReviewSchema.parse({
    attempts: 2,
    consequentialMutationAllowed: false,
    metadata: {
      attempts: 2,
      contentLogged: false,
      inputTokens: input.inputTokens ?? 0,
      latencyMs: input.latencyMs ?? 0,
      outputTokens: input.outputTokens ?? 0,
      promptVersion: input.promptVersion,
      providerOutcome: providerOutcomeForFailure(input.reason),
      purpose: "signal_draft",
      requestId: input.requestId,
    },
    reason: input.reason,
    status: "needs_human_review",
  });

export const createSignalDraftGenerator = (
  options: Readonly<SignalDraftGeneratorOptions>,
): SignalDraftGenerator => {
  const timeoutMs = ProviderTimeoutSchema.parse(options.timeoutMs ?? 4_000);
  const outputSchema = z.toJSONSchema(ProviderSignalDraftFieldsSchema);

  return Object.freeze({
    generate: async (
      inputValue: Readonly<SignalDraftGenerationInput>,
    ): Promise<SignalDraftGenerationResult> => {
      const input = SignalDraftGenerationInputSchema.parse(inputValue);
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
            redactedInput: input.redactedInput,
            requestId: input.requestId,
            timeoutMs,
          },
          timeoutMs,
        );
        const measuredLatencyMs = Math.max(
          0,
          Math.min(
            MAX_PROVIDER_TIMEOUT_MS,
            Math.round(performance.now() - startedAt),
          ),
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
          const candidate = renderProviderSignalDraft(
            completion.output,
            input.privateInputs,
          );

          if (candidate !== undefined) {
            return ValidatedSignalDraftCandidateSchema.parse({
              candidate,
              metadata: {
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
              },
              source: options.source,
              status: "validated",
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

      return createNeedsHumanReview({
        inputTokens,
        latencyMs: totalLatencyMs,
        outputTokens,
        promptVersion: input.promptVersion,
        reason: lastFailure,
        requestId: input.requestId,
      });
    },
  });
};
