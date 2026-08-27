import { describe, expect, it, vi } from "vitest";

import {
  AIExecutionMetadataSchema,
  type LLMProvider,
  type LLMProviderRequest,
  type LLMProviderResult,
} from "../../packages/contracts/src/index";
import {
  createHighRiskDraft,
  detectHighRiskCategory,
  executeSignalDraftProvider,
  redactProviderInput,
} from "./index";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const DOMAIN_ID = "20000000-0000-4000-8000-000000000001";
const PRIVATE_DETAIL = "Straße family detail";

const validOutput = () => ({
  kind: "potential_task" as const,
  topic: "schedule coordination",
  suggestedAction: "review the next appointment",
  candidateDomainId: DOMAIN_ID,
  confidence: 0.8,
  missingInfo: ["appointment date"],
});

const completed = (output: unknown): LLMProviderResult => ({
  status: "completed",
  completion: {
    output,
    latencyMs: 4,
    usage: { inputTokens: 10, outputTokens: 5 },
  },
});

const execute = (
  provider: LLMProvider,
  overrides: Partial<{
    redactedInput: string;
    protectedValues: readonly string[];
    timeoutMs: number;
  }> = {},
) =>
  executeSignalDraftProvider(provider, {
    requestId: REQUEST_ID,
    promptVersion: "signal-v1",
    redactedInput: overrides.redactedInput ?? "private input",
    protectedValues: overrides.protectedValues ?? [PRIVATE_DETAIL],
    timeoutMs: overrides.timeoutMs ?? 100,
  });

describe("deterministic high-risk routing", () => {
  it.each([
    ["I might kill myself tonight.", "self_harm"],
    ["My partner hit me at home.", "domestic_violence"],
    ["I have chest pain and cannot breathe.", "acute_medical_symptom"],
    ["我不想活了。", "self_harm"],
    ["伴侣打我，这是家暴。", "domestic_violence"],
    ["胸痛，而且无法呼吸。", "acute_medical_symptom"],
  ] as const)("classifies %s", (content, category) => {
    expect(detectHighRiskCategory(content)).toBe(category);
  });

  it("renders only human-authored, non-consequential safety fields", () => {
    const fields = createHighRiskDraft("self_harm", [PRIVATE_DETAIL]);

    expect(fields).toMatchObject({
      kind: "high_risk",
      candidateDomainId: null,
      confidence: 1,
    });
    expect(JSON.stringify(fields)).not.toContain(PRIVATE_DETAIL);
  });
});

describe("bounded provider execution", () => {
  it("accepts bounded fields, uses a strict schema, and renders templates", async () => {
    const requests: LLMProviderRequest[] = [];
    const complete = vi.fn((request: LLMProviderRequest) => {
      requests.push(request);
      return Promise.resolve(completed(validOutput()));
    });
    const provider: LLMProvider = {
      complete,
    };

    const result = await execute(provider);

    expect(result).toMatchObject({
      status: "validated",
      fields: {
        kind: "potential_task",
        redactedExcerpt:
          "Potential responsibility topic: schedule coordination",
        proposedConclusion:
          "Review this possible responsibility action: review the next appointment",
      },
      metadata: {
        attempts: 1,
        providerOutcome: "validated",
        contentLogged: false,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.outputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(
      AIExecutionMetadataSchema.safeParse(
        result.status === "validated" ? result.metadata : undefined,
      ).success,
    ).toBe(true);
  });

  it.each([
    {
      ...validOutput(),
      topic: "STRASSE family detail",
    },
    {
      ...validOutput(),
      nested: { value: "STRASSE family detail" },
    },
    {
      ...validOutput(),
      nested: { "STRASSE family detail": true },
    },
  ])("rejects disclosure in every provider-controlled location", async (output) => {
    const complete = vi.fn(() => Promise.resolve(completed(output)));
    const provider: LLMProvider = {
      complete,
    };

    const result = await execute(provider);

    expect(result).toMatchObject({
      status: "needs_human_review",
      reason: "provider_invalid_output",
      attempts: 2,
      consequentialMutationAllowed: false,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("retries a second invalid output without returning a draft", async () => {
    const complete = vi.fn(() =>
      Promise.resolve(completed({ kind: "potential_task" })),
    );
    const provider: LLMProvider = {
      complete,
    };

    await expect(execute(provider)).resolves.toMatchObject({
      status: "needs_human_review",
      reason: "provider_invalid_output",
      attempts: 2,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("converts synchronous and asynchronous provider failures safely", async () => {
    const synchronous: LLMProvider = {
      complete: vi.fn(() => {
        throw new Error(PRIVATE_DETAIL);
      }),
    };
    const asynchronous: LLMProvider = {
      complete: vi.fn(() => Promise.reject(new Error(PRIVATE_DETAIL))),
    };

    await expect(execute(synchronous)).resolves.toMatchObject({
      status: "needs_human_review",
      reason: "provider_unavailable",
      consequentialMutationAllowed: false,
    });
    await expect(execute(asynchronous)).resolves.toMatchObject({
      status: "needs_human_review",
      reason: "provider_unavailable",
      consequentialMutationAllowed: false,
    });
    expect(JSON.stringify(await execute(synchronous))).not.toContain(
      PRIVATE_DETAIL,
    );
  });

  it("bounds providers that never settle with two timed attempts", async () => {
    const complete = vi.fn(
      () => new Promise<LLMProviderResult>(() => undefined),
    );
    const provider: LLMProvider = {
      complete,
    };

    await expect(execute(provider, { timeoutMs: 5 })).resolves.toMatchObject({
      status: "needs_human_review",
      reason: "provider_timeout",
      attempts: 2,
      metadata: { latencyMs: 10, contentLogged: false },
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("provider input redaction", () => {
  it("removes common contact and identifier forms and stays bounded", () => {
    const redacted = redactProviderInput(
      `Email a@example.com, call +1 (555) 123-4567, id ${REQUEST_ID}.`,
    );

    expect(redacted).not.toContain("a@example.com");
    expect(redacted).not.toContain("555");
    expect(redacted).not.toContain(REQUEST_ID);
    expect(Array.from(redacted).length).toBeLessThanOrEqual(4_000);
  });
});
