import { describe, expect, it } from "vitest";

import {
  FIXTURE_IDS,
  type LLMProvider,
  type LLMProviderRequest,
  type LLMProviderResult,
} from "../../../packages/contracts/src/index";
import type {
  SafeLogger,
  SafeOperationLog,
} from "../../boundary/src/index";
import {
  createOpenAICompatibleLLMProvider,
  createSignalDraftGenerator,
  type SignalDraftCandidate,
} from "../src/index";

const VALID_CANDIDATE: SignalDraftCandidate = Object.freeze({
  candidateDomainId: null,
  confidence: 0.8,
  kind: "potential_task",
  missingInfo: [],
  proposedConclusion: "需要由家人确认后续安排。",
  redactedExcerpt: "发言人希望家人确认后续安排。",
});

const generationInput = Object.freeze({
  actorId: FIXTURE_IDS.subject,
  privateInputs: ["private-marker email@example.com 13812345678"],
  promptVersion: "signal-draft-v1",
  redactedInput: "source_1: private-marker [email] [phone]",
  requestId: FIXTURE_IDS.request,
  spaceId: FIXTURE_IDS.space,
});

const completed = (output: unknown): LLMProviderResult => ({
  status: "completed",
  completion: {
    latencyMs: 0,
    output,
    usage: { inputTokens: 4, outputTokens: 5 },
  },
});

const createProvider = (
  complete: (
    request: Readonly<LLMProviderRequest>,
    signal: AbortSignal,
  ) => Promise<LLMProviderResult>,
): LLMProvider => ({ complete });

describe("signal draft generation", () => {
  it("recovers when the first output is invalid and the retry validates", async () => {
    let attempts = 0;
    const provider = createProvider(() => {
      attempts += 1;
      return Promise.resolve(
        completed(attempts === 1 ? "not-json" : VALID_CANDIDATE),
      );
    });
    const generator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider,
      source: "validated_ai",
    });

    const result = await generator.generate(generationInput);

    expect(result).toMatchObject({
      metadata: { attempts: 2, providerOutcome: "validated" },
      status: "validated",
    });
    expect(attempts).toBe(2);
  });

  it("returns needs_human_review after two invalid outputs without content logs", async () => {
    const events: SafeOperationLog[] = [];
    const logger: SafeLogger = {
      write: (event) => {
        events.push(event);
      },
    };
    let attempts = 0;
    const provider = createProvider(() => {
      attempts += 1;
      return Promise.resolve(completed("{invalid-json"));
    });
    const generator = createSignalDraftGenerator({
      logger,
      provider,
      source: "validated_ai",
    });

    const result = await generator.generate(generationInput);

    expect(result).toMatchObject({
      attempts: 2,
      consequentialMutationAllowed: false,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(attempts).toBe(2);
    expect(events).toHaveLength(2);
    const diagnostics = JSON.stringify(events);
    expect(diagnostics).not.toContain("private-marker");
    expect(diagnostics).not.toContain("email@example.com");
    expect(diagnostics).not.toContain("13812345678");
  });

  it("bounds timeouts and thrown provider failures to two attempts", async () => {
    let timeoutAttempts = 0;
    const timeoutProvider = createProvider((_request, signal) => {
      timeoutAttempts += 1;
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve({
              failure: { code: "provider_timeout", retryable: true },
              status: "failed",
            });
          },
          { once: true },
        );
      });
    });
    const timeoutGenerator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: timeoutProvider,
      source: "validated_ai",
      timeoutMs: 5,
    });
    const timeoutResult = await timeoutGenerator.generate(generationInput);

    expect(timeoutResult).toMatchObject({
      attempts: 2,
      reason: "provider_timeout",
      status: "needs_human_review",
    });
    expect(timeoutAttempts).toBe(2);

    let failureAttempts = 0;
    const failingProvider = createProvider(() => {
      failureAttempts += 1;
      return Promise.reject(new Error("provider details must stay private"));
    });
    const failingGenerator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: failingProvider,
      source: "validated_ai",
    });
    const failureResult = await failingGenerator.generate(generationInput);

    expect(failureResult).toMatchObject({
      attempts: 2,
      reason: "provider_unavailable",
      status: "needs_human_review",
    });
    expect(failureAttempts).toBe(2);
  });

  it("treats invalid OpenAI-compatible JSON as provider_invalid_output", async () => {
    let requestBody = "";
    const fetchImplementation: typeof fetch = (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not-json" } }],
            usage: { completion_tokens: 1, prompt_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    };
    const provider = createOpenAICompatibleLLMProvider({
      endpoint: "https://provider.invalid/v1/chat/completions",
      fetchImplementation,
      model: "fixture-model",
    });
    const result = await provider.complete(
      {
        attempt: 1,
        outputSchema: { type: "object" },
        promptVersion: "signal-draft-v1",
        purpose: "signal_draft",
        redactedInput: generationInput.redactedInput,
        requestId: FIXTURE_IDS.request,
        timeoutMs: 100,
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      failure: { code: "provider_invalid_output", retryable: true },
      status: "failed",
    });
    expect(requestBody).toContain("[email]");
    expect(requestBody).not.toContain("email@example.com");
    expect(requestBody).not.toContain("13812345678");
  });
});
