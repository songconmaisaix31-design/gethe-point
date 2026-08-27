import { z } from "zod";

import type {
  LLMProvider,
  LLMProviderFailure,
  LLMProviderRequest,
} from "../../../packages/contracts/src/index";

import {
  DomainSuggestionOutputSchema,
  type DomainSuggestionOutput,
} from "./model";

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

interface AttemptTotals {
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type ProviderAttempt =
  | Readonly<{
      status: "validated";
      output: DomainSuggestionOutput;
      totals: AttemptTotals;
    }>
  | Readonly<{
      status: "failed";
      reason: LLMProviderFailure["code"];
      totals: AttemptTotals;
    }>;

const failedAttempt = (
  reason: LLMProviderFailure["code"],
  totals: AttemptTotals = {
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  },
): ProviderAttempt => ({ status: "failed", reason, totals });

const normalizeProviderResult = (result: unknown): ProviderAttempt => {
  const parsed = ProviderResultSchema.safeParse(result);
  if (!parsed.success) {
    return failedAttempt("provider_unavailable");
  }
  if (parsed.data.status === "failed") {
    return failedAttempt(parsed.data.failure.code);
  }

  const totals = {
    latencyMs: parsed.data.completion.latencyMs,
    inputTokens: parsed.data.completion.usage.inputTokens,
    outputTokens: parsed.data.completion.usage.outputTokens,
  };
  const output = DomainSuggestionOutputSchema.safeParse(
    parsed.data.completion.output,
  );
  return output.success
    ? { status: "validated", output: output.data, totals }
    : failedAttempt("provider_invalid_output", totals);
};

export const runProviderAttempt = async (
  provider: LLMProvider,
  request: LLMProviderRequest,
): Promise<ProviderAttempt> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<ProviderAttempt>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(
        failedAttempt("provider_timeout", {
          latencyMs: request.timeoutMs,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
    }, request.timeoutMs);
  });

  const completion = provider
    .complete(request, controller.signal)
    .then((result) => normalizeProviderResult(result))
    .catch(() => failedAttempt("provider_unavailable"));

  try {
    return await Promise.race([completion, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};
