import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  AI_ATTEMPT_POLICY,
  HandoverMissingInfoSchema,
  NeedsHumanReviewSchema,
  RequestIdSchema,
  type AIExecutionMetadata,
  type JsonSchemaDocument,
  type LLMProvider,
  type LLMProviderResult,
  type NeedsHumanReview,
} from "../../../packages/contracts/src/index";

export const MissingInformationQuestionSchema = z.strictObject({
  missingInfoId: z.uuid(),
  question: z.string().trim().min(1).max(280),
});

export type MissingInformationQuestion = z.infer<
  typeof MissingInformationQuestionSchema
>;

const ProviderQuestionDraftSchema = z.strictObject({
  questions: z.array(MissingInformationQuestionSchema).min(1).max(20),
});

export const DraftMissingInformationQuestionsRequestSchema = z
  .strictObject({
    missingInfo: z.array(HandoverMissingInfoSchema).min(1).max(20),
    requestId: RequestIdSchema,
    timeoutMs: z.number().int().min(100).max(30_000),
  })
  .superRefine(({ missingInfo }, context) => {
    const ids = missingInfo.map(({ id }) => id);

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Missing-information IDs must be unique.",
        path: ["missingInfo"],
      });
    }
  });

export type DraftMissingInformationQuestionsRequest = z.infer<
  typeof DraftMissingInformationQuestionsRequestSchema
>;

export const DraftMissingInformationQuestionsResultSchema = z.union([
  z.strictObject({
    consequentialMutationAllowed: z.literal(false),
    metadata: AIExecutionMetadataSchema,
    questions: z.array(MissingInformationQuestionSchema).min(1).max(20),
    status: z.literal("questions_drafted"),
  }),
  NeedsHumanReviewSchema,
]);

export type DraftMissingInformationQuestionsResult = z.infer<
  typeof DraftMissingInformationQuestionsResultSchema
>;

const QUESTION_OUTPUT_SCHEMA: JsonSchemaDocument = Object.freeze({
  additionalProperties: false,
  properties: {
    questions: {
      items: {
        additionalProperties: false,
        properties: {
          missingInfoId: { format: "uuid", type: "string" },
          question: { maxLength: 280, minLength: 1, type: "string" },
        },
        required: ["missingInfoId", "question"],
        type: "object",
      },
      maxItems: 20,
      minItems: 1,
      type: "array",
    },
  },
  required: ["questions"],
  type: "object",
});

const PROMPT_VERSION = "handover-missing-questions-v1";

const unavailableResult = (): LLMProviderResult => ({
  failure: { code: "provider_unavailable", retryable: true },
  status: "failed",
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
      resolve({
        failure: { code: "provider_timeout", retryable: true },
        status: "failed",
      });
    }, timeoutMs);
  });
  const completion = provider
    .complete(request, controller.signal)
    .catch(unavailableResult);

  try {
    return await Promise.race([completion, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
};

const questionsMatchRequest = (
  questions: readonly MissingInformationQuestion[],
  request: DraftMissingInformationQuestionsRequest,
): boolean => {
  const requestedIds = new Set(request.missingInfo.map(({ id }) => id));
  const questionIds = questions.map(({ missingInfoId }) => missingInfoId);

  return (
    questionIds.length === requestedIds.size &&
    new Set(questionIds).size === questionIds.length &&
    questionIds.every((id) => requestedIds.has(id))
  );
};

const metadata = (
  attempts: 1 | 2,
  providerOutcome: AIExecutionMetadata["providerOutcome"],
  requestId: string,
  totals: Readonly<{
    inputTokens: number;
    latencyMs: number;
    outputTokens: number;
  }>,
): AIExecutionMetadata =>
  AIExecutionMetadataSchema.parse({
    attempts,
    contentLogged: false,
    inputTokens: totals.inputTokens,
    latencyMs: totals.latencyMs,
    outputTokens: totals.outputTokens,
    promptVersion: PROMPT_VERSION,
    providerOutcome,
    purpose: "handover_packet",
    requestId,
  });

const failureOutcome = (
  reason: NeedsHumanReview["reason"],
): AIExecutionMetadata["providerOutcome"] => {
  switch (reason) {
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_timeout":
      return "timeout";
    case "provider_unavailable":
      return "unavailable";
  }
};

export const draftMissingInformationQuestions = async (
  provider: LLMProvider,
  input: unknown,
): Promise<DraftMissingInformationQuestionsResult> => {
  const parsedRequest = DraftMissingInformationQuestionsRequestSchema.safeParse(
    input,
  );

  if (!parsedRequest.success) {
    throw new Error("Invalid missing-information question request.");
  }

  const request = parsedRequest.data;
  const redactedInput = JSON.stringify({
    missingInfo: request.missingInfo.map(({ id, label, reason }) => ({
      id,
      label,
      reason,
    })),
  });
  const totals = { inputTokens: 0, latencyMs: 0, outputTokens: 0 };
  let finalReason: NeedsHumanReview["reason"] = "provider_unavailable";

  for (
    let attemptNumber = 1;
    attemptNumber <= AI_ATTEMPT_POLICY.maxAttempts;
    attemptNumber += 1
  ) {
    const attempt = attemptNumber === 1 ? 1 : 2;
    const providerResult = await completeWithTimeout(
      provider,
      {
        attempt,
        outputSchema: QUESTION_OUTPUT_SCHEMA,
        promptVersion: PROMPT_VERSION,
        purpose: "handover_packet",
        redactedInput,
        requestId: request.requestId,
        timeoutMs: request.timeoutMs,
      },
      request.timeoutMs,
    );

    if (providerResult.status === "failed") {
      finalReason = providerResult.failure.code;
      continue;
    }

    totals.inputTokens += providerResult.completion.usage.inputTokens;
    totals.latencyMs += providerResult.completion.latencyMs;
    totals.outputTokens += providerResult.completion.usage.outputTokens;

    const draft = ProviderQuestionDraftSchema.safeParse(
      providerResult.completion.output,
    );

    if (!draft.success || !questionsMatchRequest(draft.data.questions, request)) {
      finalReason = "provider_invalid_output";
      continue;
    }

    return DraftMissingInformationQuestionsResultSchema.parse({
      consequentialMutationAllowed: false,
      metadata: metadata(attempt, "validated", request.requestId, totals),
      questions: draft.data.questions,
      status: "questions_drafted",
    });
  }

  return DraftMissingInformationQuestionsResultSchema.parse({
    attempts: 2,
    consequentialMutationAllowed: false,
    metadata: metadata(
      2,
      failureOutcome(finalReason),
      request.requestId,
      totals,
    ),
    reason: finalReason,
    status: "needs_human_review",
  });
};
