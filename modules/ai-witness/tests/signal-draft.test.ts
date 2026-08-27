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
  createSignalDraftGenerator,
  type ProviderSignalDraftFields,
} from "../src/index";

const VALID_FIELDS = Object.freeze({
  confidence: 0.8,
  intent: "coordinate_schedule",
  missingInfoCodes: ["responsible_member"],
} satisfies ProviderSignalDraftFields);

const generationInput = (privateInputs: readonly string[] = ["private input"]) =>
  Object.freeze({
    actorId: FIXTURE_IDS.subject,
    privateInputs: [...privateInputs],
    promptVersion: "signal-draft-v2",
    redactedInput: "source_1: [redacted]",
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

describe("bounded signal draft generation", () => {
  it("recovers when the first output is invalid and the retry validates", async () => {
    let attempts = 0;
    const provider = createProvider(() => {
      attempts += 1;
      return Promise.resolve(
        completed(attempts === 1 ? { conclusion: "free text" } : VALID_FIELDS),
      );
    });
    const generator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider,
      source: "validated_ai",
    });

    const result = await generator.generate(generationInput());

    expect(result).toMatchObject({
      candidate: {
        candidateDomainId: null,
        kind: "potential_task",
        proposedConclusion: "需要由家人确认具体时间和后续安排。",
      },
      metadata: { attempts: 2, providerOutcome: "validated" },
      status: "validated",
    });
    expect(attempts).toBe(2);
  });

  it.each([
    "coordinate schedule",
    "需要由家人确认具体时间和后续安排!",
    "需要确认负责人",
  ])("rejects disclosure through every derived field: %s", async (privateInput) => {
    let attempts = 0;
    const generator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: createProvider(() => {
        attempts += 1;
        return Promise.resolve(completed(VALID_FIELDS));
      }),
      source: "validated_ai",
    });

    const result = await generator.generate(generationInput([privateInput]));

    expect(result).toMatchObject({
      attempts: 2,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(attempts).toBe(2);
  });

  it("returns content-free needs_human_review after two invalid outputs", async () => {
    const events: SafeOperationLog[] = [];
    const logger: SafeLogger = {
      write: (event) => {
        events.push(event);
      },
    };
    let attempts = 0;
    const generator = createSignalDraftGenerator({
      logger,
      provider: createProvider(() => {
        attempts += 1;
        return Promise.resolve(completed("{invalid-json"));
      }),
      source: "validated_ai",
    });

    const result = await generator.generate(
      generationInput(["private-marker email@example.com 13812345678"]),
    );

    expect(result).toMatchObject({
      attempts: 2,
      consequentialMutationAllowed: false,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(attempts).toBe(2);
    expect(events).toHaveLength(2);
    const diagnostics = JSON.stringify({ events, result });
    expect(diagnostics).not.toContain("private-marker");
    expect(diagnostics).not.toContain("email@example.com");
    expect(diagnostics).not.toContain("13812345678");
  });

  it("bounds timeouts and thrown provider failures to two attempts", async () => {
    let timeoutAttempts = 0;
    const timeoutGenerator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: createProvider((_request, signal) => {
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
      }),
      source: "validated_ai",
      timeoutMs: 5,
    });

    await expect(timeoutGenerator.generate(generationInput())).resolves.toMatchObject({
      attempts: 2,
      reason: "provider_timeout",
      status: "needs_human_review",
    });
    expect(timeoutAttempts).toBe(2);

    let failureAttempts = 0;
    const failureGenerator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: createProvider(() => {
        failureAttempts += 1;
        return Promise.reject(new Error("private provider failure"));
      }),
      source: "validated_ai",
    });

    await expect(failureGenerator.generate(generationInput())).resolves.toMatchObject({
      attempts: 2,
      reason: "provider_unavailable",
      status: "needs_human_review",
    });
    expect(failureAttempts).toBe(2);
  });
});
