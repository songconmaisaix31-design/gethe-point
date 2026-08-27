import { z } from "zod";

import {
  AI_ATTEMPT_POLICY,
  type AIExecutionMetadata,
  type JsonSchemaDocument,
  type LLMProvider,
  type LLMProviderRequest,
  type NeedsHumanReview,
  type RequestId,
} from "../../packages/contracts/src/index";
import { inspectDisclosure } from "../boundary/index";
import type { HighRiskCategory } from "./high-risk";

const ProviderEnvelopeSchema = z.discriminatedUnion("status", [
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

export const SignalDraftProviderOutputSchema = z.strictObject({
  kind: z.enum(["potential_task", "discussion_only"]),
  topic: z.string().trim().min(1).max(80),
  suggestedAction: z.string().trim().min(1).max(160),
  candidateDomainId: z.uuid().nullable(),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(z.string().trim().min(1).max(80)).max(5),
});

export type SignalDraftProviderOutput = z.infer<
  typeof SignalDraftProviderOutputSchema
>;

export interface RenderedSignalDraftFields {
  readonly kind: "potential_task" | "discussion_only" | "high_risk";
  readonly redactedExcerpt: string;
  readonly proposedConclusion: string;
  readonly candidateDomainId: string | null;
  readonly confidence: number;
  readonly missingInfo: readonly string[];
}

export type SignalDraftProviderExecution =
  | Readonly<{
      status: "validated";
      fields: RenderedSignalDraftFields;
      metadata: AIExecutionMetadata;
    }>
  | NeedsHumanReview;

export interface SignalDraftProviderExecutionInput {
  readonly requestId: RequestId;
  readonly promptVersion: string;
  readonly redactedInput: string;
  readonly protectedValues: readonly string[];
  readonly timeoutMs: number;
}

const SIGNAL_DRAFT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "topic",
    "suggestedAction",
    "candidateDomainId",
    "confidence",
    "missingInfo",
  ],
  properties: Object.freeze({
    kind: Object.freeze({
      type: "string",
      enum: Object.freeze(["potential_task", "discussion_only"]),
    }),
    topic: Object.freeze({ type: "string", minLength: 1, maxLength: 80 }),
    suggestedAction: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 160,
    }),
    candidateDomainId: Object.freeze({
      anyOf: Object.freeze([
        Object.freeze({ type: "string", format: "uuid" }),
        Object.freeze({ type: "null" }),
      ]),
    }),
    confidence: Object.freeze({ type: "number", minimum: 0, maximum: 1 }),
    missingInfo: Object.freeze({
      type: "array",
      maxItems: 5,
      items: Object.freeze({ type: "string", minLength: 1, maxLength: 80 }),
    }),
  }),
}) satisfies JsonSchemaDocument;

const TEMPLATE_BY_KIND = Object.freeze({
  potential_task: Object.freeze({
    excerptPrefix: "Potential responsibility topic: ",
    conclusionPrefix: "Review this possible responsibility action: ",
  }),
  discussion_only: Object.freeze({
    excerptPrefix: "Private discussion topic: ",
    conclusionPrefix: "Review this discussion before sharing: ",
  }),
});

const HIGH_RISK_TEMPLATE: Readonly<
  Record<
    HighRiskCategory,
    Readonly<{ redactedExcerpt: string; proposedConclusion: string }>
  >
> = Object.freeze({
  self_harm: Object.freeze({
    redactedExcerpt: "Private safety concern requiring immediate human review.",
    proposedConclusion:
      "Use non-diagnostic safety guidance and contact local emergency or crisis resources.",
  }),
  domestic_violence: Object.freeze({
    redactedExcerpt: "Private safety concern requiring immediate human review.",
    proposedConclusion:
      "Prioritize immediate safety and contact trusted local violence-support or emergency resources.",
  }),
  acute_medical_symptom: Object.freeze({
    redactedExcerpt: "Private urgent health concern requiring human review.",
    proposedConclusion:
      "Seek prompt assessment from local emergency or medical professionals.",
  }),
});

type ProviderFailureCode =
  | "provider_timeout"
  | "provider_invalid_output"
  | "provider_unavailable";

type BoundedProviderCallResult =
  | Readonly<{
      status: "completed";
      output: unknown;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }>
  | Readonly<{ status: "failed"; code: ProviderFailureCode }>;

const callProvider = async (
  provider: LLMProvider,
  request: LLMProviderRequest,
): Promise<BoundedProviderCallResult> => {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<BoundedProviderCallResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve({ status: "failed", code: "provider_timeout" });
    }, request.timeoutMs);
  });

  try {
    const invocation = Promise.resolve()
      .then(async () => provider.complete(request, controller.signal))
      .then<BoundedProviderCallResult>((rawResult) => {
        const result = ProviderEnvelopeSchema.safeParse(rawResult);

        if (!result.success) {
          return { status: "failed", code: "provider_invalid_output" };
        }

        if (result.data.status === "failed") {
          return { status: "failed", code: result.data.failure.code };
        }

        return {
          status: "completed",
          output: result.data.completion.output,
          latencyMs: result.data.completion.latencyMs,
          inputTokens: result.data.completion.usage.inputTokens,
          outputTokens: result.data.completion.usage.outputTokens,
        };
      })
      .catch<BoundedProviderCallResult>(() => ({
        status: "failed",
        code: "provider_unavailable",
      }));

    return await Promise.race([invocation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
};

const renderDraft = (
  output: SignalDraftProviderOutput,
): RenderedSignalDraftFields => {
  const template = TEMPLATE_BY_KIND[output.kind];

  return {
    kind: output.kind,
    redactedExcerpt: `${template.excerptPrefix}${output.topic}`,
    proposedConclusion: `${template.conclusionPrefix}${output.suggestedAction}`,
    candidateDomainId: output.candidateDomainId,
    confidence: output.confidence,
    missingInfo: output.missingInfo,
  };
};

const providerOutcome = (
  code: ProviderFailureCode,
): AIExecutionMetadata["providerOutcome"] => {
  switch (code) {
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_timeout":
      return "timeout";
    case "provider_unavailable":
      return "unavailable";
  }
};

const inspectValue = (
  value: unknown,
  protectedValues: readonly string[],
): boolean => inspectDisclosure({ protectedValues, value }).safe;

export const executeSignalDraftProvider = async (
  provider: LLMProvider,
  input: SignalDraftProviderExecutionInput,
): Promise<SignalDraftProviderExecution> => {
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 30_000
  ) {
    throw new Error("Signal draft provider timeout configuration is invalid.");
  }

  let totalLatencyMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastFailure: ProviderFailureCode = "provider_unavailable";

  for (let attempt = 1; attempt <= AI_ATTEMPT_POLICY.maxAttempts; attempt += 1) {
    const boundedAttempt = attempt as 1 | 2;
    const result = await callProvider(provider, {
      requestId: input.requestId,
      purpose: "signal_draft",
      promptVersion: input.promptVersion,
      redactedInput: input.redactedInput,
      outputSchema: SIGNAL_DRAFT_OUTPUT_SCHEMA,
      timeoutMs: input.timeoutMs,
      attempt: boundedAttempt,
    });

    if (result.status === "failed") {
      lastFailure = result.code;
      if (result.code === "provider_timeout") {
        totalLatencyMs += input.timeoutMs;
      }
      continue;
    }

    totalLatencyMs += result.latencyMs;
    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;

    if (!inspectValue(result.output, input.protectedValues)) {
      lastFailure = "provider_invalid_output";
      continue;
    }

    const parsed = SignalDraftProviderOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      lastFailure = "provider_invalid_output";
      continue;
    }

    const fields = renderDraft(parsed.data);
    if (!inspectValue(fields, input.protectedValues)) {
      lastFailure = "provider_invalid_output";
      continue;
    }

    return {
      status: "validated",
      fields,
      metadata: {
        requestId: input.requestId,
        purpose: "signal_draft",
        promptVersion: input.promptVersion,
        attempts: boundedAttempt,
        providerOutcome: "validated",
        latencyMs: totalLatencyMs,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        contentLogged: false,
      },
    };
  }

  return {
    status: "needs_human_review",
    reason: lastFailure,
    attempts: 2,
    consequentialMutationAllowed: false,
    metadata: {
      requestId: input.requestId,
      purpose: "signal_draft",
      promptVersion: input.promptVersion,
      attempts: 2,
      providerOutcome: providerOutcome(lastFailure),
      latencyMs: totalLatencyMs,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      contentLogged: false,
    },
  };
};

export const createHighRiskDraft = (
  category: HighRiskCategory,
  protectedValues: readonly string[],
): RenderedSignalDraftFields | undefined => {
  const template = HIGH_RISK_TEMPLATE[category];
  const fields: RenderedSignalDraftFields = {
    kind: "high_risk",
    redactedExcerpt: template.redactedExcerpt,
    proposedConclusion: template.proposedConclusion,
    candidateDomainId: null,
    confidence: 1,
    missingInfo: ["Immediate human safety review is required."],
  };

  return inspectValue(fields, protectedValues) ? fields : undefined;
};

export const redactProviderInput = (privateContent: string): string =>
  Array.from(
    privateContent
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[redacted email]")
      .replace(
        /\+?\d[\d\s().-]{6,}\d/gu,
        "[redacted contact]",
      )
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
        "[redacted identifier]",
      ),
  )
    .slice(0, 4_000)
    .join("");
