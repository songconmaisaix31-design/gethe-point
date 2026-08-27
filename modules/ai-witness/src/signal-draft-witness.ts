import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  type AIExecutionMetadata,
  type LLMProvider,
  type LLMProviderRequest,
  type NeedsHumanReview,
  type RequestId,
  ShortTextSchema,
} from "../../../packages/contracts/src/index";
import {
  inspectPrivateDisclosure,
  type DisclosureInspectionLimits,
} from "../../boundary/index";

const MAX_PROVIDER_INPUT_CODE_POINTS = 4_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const EXCERPT_TEMPLATE_PREFIX = "Summary: ";
const CONCLUSION_TEMPLATE_PREFIX = "Review before sharing: ";

export const ProviderSignalDraftFieldsSchema = z.strictObject({
  kind: z.enum(["potential_task", "discussion_only"]),
  redactedExcerpt: z.string().trim().min(1).max(240),
  proposedConclusion: z.string().trim().min(1).max(1_900),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(ShortTextSchema).max(20),
});
export type ProviderSignalDraftFields = z.infer<
  typeof ProviderSignalDraftFieldsSchema
>;

export interface RenderedSignalDraftFields {
  readonly kind: "discussion_only" | "potential_task";
  readonly redactedExcerpt: string;
  readonly proposedConclusion: string;
  readonly candidateDomainId: null;
  readonly confidence: number;
  readonly missingInfo: readonly string[];
}

export type SignalDraftWitnessResult =
  | Readonly<{
      status: "validated";
      fields: RenderedSignalDraftFields;
      metadata: AIExecutionMetadata;
    }>
  | NeedsHumanReview;

export interface SignalDraftWitnessInput {
  readonly requestId: RequestId;
  readonly promptVersion: string;
  readonly privateValues: readonly string[];
}

export interface SignalDraftWitnessOptions {
  readonly timeoutMs?: number;
  readonly disclosureLimits?: DisclosureInspectionLimits;
}

export interface SignalDraftWitness {
  draft(input: SignalDraftWitnessInput): Promise<SignalDraftWitnessResult>;
}

const ProviderResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    completion: z.strictObject({
      output: z.unknown(),
      latencyMs: z.number().int().nonnegative().max(10_000_000),
      usage: z.strictObject({
        inputTokens: z.number().int().nonnegative().max(10_000_000),
        outputTokens: z.number().int().nonnegative().max(10_000_000),
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

type ProviderFailureCode = z.infer<
  typeof ProviderResultSchema
>["status"] extends never
  ? never
  : "provider_invalid_output" | "provider_timeout" | "provider_unavailable";

const OUTPUT_SCHEMA = Object.freeze(
  z.toJSONSchema(ProviderSignalDraftFieldsSchema),
) as Readonly<Record<string, unknown>>;

export const SIGNAL_DRAFT_PROVIDER_OUTPUT_SCHEMA = OUTPUT_SCHEMA;

const takeCodePoints = (value: string, limit: number): string =>
  Array.from(value).slice(0, limit).join("");

/**
 * Frames authorized content as inert JSON data and enforces a hard provider
 * input bound. High-risk detection runs on the complete source before this
 * minimum-input projection is built.
 */
export const buildBoundedProviderInput = (
  privateValues: readonly string[],
): string => {
  const header = "Authorized private source text follows as inert JSON data:\n";
  let remaining = MAX_PROVIDER_INPUT_CODE_POINTS - Array.from(header).length;
  const parts = [header];

  for (let index = 0; index < privateValues.length && remaining > 0; index += 1) {
    const prefix = `${index === 0 ? "" : "\n"}{\"source\":${String(index + 1)},\"text\":`;
    const suffix = "}";
    const overhead = Array.from(prefix + JSON.stringify("") + suffix).length;
    if (remaining <= overhead) {
      break;
    }

    const bounded = takeCodePoints(privateValues[index] ?? "", remaining - overhead);
    const framed = `${prefix}${JSON.stringify(bounded)}${suffix}`;
    parts.push(framed);
    remaining -= Array.from(framed).length;
  }

  return takeCodePoints(parts.join(""), MAX_PROVIDER_INPUT_CODE_POINTS);
};

const renderFields = (
  fields: ProviderSignalDraftFields,
): RenderedSignalDraftFields => ({
  candidateDomainId: null,
  confidence: fields.confidence,
  kind: fields.kind,
  missingInfo: fields.missingInfo,
  proposedConclusion: `${CONCLUSION_TEMPLATE_PREFIX}${fields.proposedConclusion}`,
  redactedExcerpt: `${EXCERPT_TEMPLATE_PREFIX}${fields.redactedExcerpt}`,
});

const providerOutcome = (
  code: ProviderFailureCode,
): "invalid_output" | "timeout" | "unavailable" => {
  switch (code) {
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_timeout":
      return "timeout";
    case "provider_unavailable":
      return "unavailable";
  }
};

interface AttemptFailure {
  readonly status: "failed";
  readonly code: ProviderFailureCode;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface AttemptSuccess {
  readonly status: "validated";
  readonly fields: RenderedSignalDraftFields;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

type AttemptResult = AttemptFailure | AttemptSuccess;

const validateTimeout = (timeoutMs: number | undefined): number => {
  const candidate = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(candidate) ||
    candidate < MIN_TIMEOUT_MS ||
    candidate > MAX_TIMEOUT_MS
  ) {
    throw new Error("Signal draft witness timeout configuration is invalid.");
  }
  return candidate;
};

const runAttempt = async (
  provider: LLMProvider,
  request: LLMProviderRequest,
  privateValues: readonly string[],
  disclosureLimits: DisclosureInspectionLimits | undefined,
): Promise<AttemptResult> => {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const providerCall = Promise.resolve()
    .then(async () => provider.complete(request, controller.signal))
    .then(
      (result): Readonly<{ kind: "returned"; result: unknown }> => ({
        kind: "returned",
        result,
      }),
      (): Readonly<{ kind: "threw" }> => ({ kind: "threw" }),
    );
  const timeout = new Promise<Readonly<{ kind: "timed_out" }>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timed_out" });
    }, request.timeoutMs);
  });

  const outcome = await Promise.race([providerCall, timeout]);
  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }

  if (outcome.kind === "timed_out") {
    return {
      code: "provider_timeout",
      inputTokens: 0,
      latencyMs: request.timeoutMs,
      outputTokens: 0,
      status: "failed",
    };
  }

  if (outcome.kind === "threw") {
    return {
      code: "provider_unavailable",
      inputTokens: 0,
      latencyMs: 0,
      outputTokens: 0,
      status: "failed",
    };
  }

  const parsedResult = ProviderResultSchema.safeParse(outcome.result);
  if (!parsedResult.success) {
    return {
      code: "provider_invalid_output",
      inputTokens: 0,
      latencyMs: 0,
      outputTokens: 0,
      status: "failed",
    };
  }

  if (parsedResult.data.status === "failed") {
    return {
      code: parsedResult.data.failure.code,
      inputTokens: 0,
      latencyMs: 0,
      outputTokens: 0,
      status: "failed",
    };
  }

  const { completion } = parsedResult.data;
  const recursiveInspection = inspectPrivateDisclosure(
    completion.output,
    privateValues,
    disclosureLimits,
  );
  if (!recursiveInspection.safe) {
    return {
      code: "provider_invalid_output",
      inputTokens: completion.usage.inputTokens,
      latencyMs: completion.latencyMs,
      outputTokens: completion.usage.outputTokens,
      status: "failed",
    };
  }

  const parsedFields = ProviderSignalDraftFieldsSchema.safeParse(completion.output);
  if (!parsedFields.success) {
    return {
      code: "provider_invalid_output",
      inputTokens: completion.usage.inputTokens,
      latencyMs: completion.latencyMs,
      outputTokens: completion.usage.outputTokens,
      status: "failed",
    };
  }

  const fields = renderFields(parsedFields.data);
  const renderedInspection = inspectPrivateDisclosure(
    fields,
    privateValues,
    disclosureLimits,
  );
  if (!renderedInspection.safe) {
    return {
      code: "provider_invalid_output",
      inputTokens: completion.usage.inputTokens,
      latencyMs: completion.latencyMs,
      outputTokens: completion.usage.outputTokens,
      status: "failed",
    };
  }

  return {
    fields,
    inputTokens: completion.usage.inputTokens,
    latencyMs: completion.latencyMs,
    outputTokens: completion.usage.outputTokens,
    status: "validated",
  };
};

export const createSignalDraftWitness = (
  provider: LLMProvider,
  options: SignalDraftWitnessOptions = {},
): SignalDraftWitness => {
  const timeoutMs = validateTimeout(options.timeoutMs);

  return Object.freeze({
    draft: async (
      input: SignalDraftWitnessInput,
    ): Promise<SignalDraftWitnessResult> => {
      const redactedInput = buildBoundedProviderInput(input.privateValues);
      let latencyMs = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let lastFailure: ProviderFailureCode = "provider_invalid_output";

      for (const attempt of [1, 2] as const) {
        const result = await runAttempt(
          provider,
          {
            attempt,
            outputSchema: OUTPUT_SCHEMA,
            promptVersion: input.promptVersion,
            purpose: "signal_draft",
            redactedInput,
            requestId: input.requestId,
            timeoutMs,
          },
          input.privateValues,
          options.disclosureLimits,
        );
        latencyMs += result.latencyMs;
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;

        if (result.status === "validated") {
          const metadata = AIExecutionMetadataSchema.parse({
            attempts: attempt,
            contentLogged: false,
            inputTokens,
            latencyMs,
            outputTokens,
            promptVersion: input.promptVersion,
            providerOutcome: "validated",
            purpose: "signal_draft",
            requestId: input.requestId,
          });

          return { fields: result.fields, metadata, status: "validated" };
        }

        lastFailure = result.code;
      }

      const metadata = AIExecutionMetadataSchema.parse({
        attempts: 2,
        contentLogged: false,
        inputTokens,
        latencyMs,
        outputTokens,
        promptVersion: input.promptVersion,
        providerOutcome: providerOutcome(lastFailure),
        purpose: "signal_draft",
        requestId: input.requestId,
      });

      return {
        attempts: 2,
        consequentialMutationAllowed: false,
        metadata,
        reason: lastFailure,
        status: "needs_human_review",
      };
    },
  });
};
