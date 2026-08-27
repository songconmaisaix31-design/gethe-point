import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  LLMProvider,
  LLMProviderResult,
} from "../../../packages/contracts/src/index";
import { draftMissingInformationQuestions } from "../src/index";

const missingInfo = [
  {
    id: randomUUID(),
    label: "Provider contact",
    reason: "The recipient needs a verified contact path.",
  },
  {
    id: randomUUID(),
    label: "Next deadline",
    reason: "The next operational deadline is unknown.",
  },
];

const request = () => ({
  missingInfo,
  requestId: randomUUID(),
  timeoutMs: 1_000,
});

const completion = (output: unknown): LLMProviderResult => ({
  completion: {
    latencyMs: 12,
    output,
    usage: { inputTokens: 20, outputTokens: 15 },
  },
  status: "completed",
});

describe("missing-information question drafts", () => {
  it("retries invalid output and returns only questions for unresolved IDs", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(({ attempt }) =>
      Promise.resolve(completion(
        attempt === 1
          ? {
              accepted: true,
              questions: [
                { missingInfoId: randomUUID(), question: "Accept this?" },
              ],
            }
          : {
              questions: missingInfo.map(({ id, label }) => ({
                missingInfoId: id,
                question: `What is the confirmed ${label.toLowerCase()}?`,
              })),
            },
      )),
    );
    const provider: LLMProvider = { complete };
    const result = await draftMissingInformationQuestions(provider, request());

    expect(result.status).toBe("questions_drafted");
    expect(result.consequentialMutationAllowed).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);

    if (result.status === "questions_drafted") {
      expect(result.metadata).toMatchObject({
        attempts: 2,
        contentLogged: false,
        providerOutcome: "validated",
        purpose: "handover_packet",
      });
      expect(result.questions.map(({ missingInfoId }) => missingInfoId).sort()).toEqual(
        missingInfo.map(({ id }) => id).sort(),
      );
    }
  });

  it("fails closed after two provider failures without mutation authority", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve({
        failure: { code: "provider_unavailable", retryable: true },
        status: "failed",
      }),
    );
    const provider: LLMProvider = { complete };
    const result = await draftMissingInformationQuestions(provider, request());

    expect(result).toMatchObject({
      attempts: 2,
      consequentialMutationAllowed: false,
      reason: "provider_unavailable",
      status: "needs_human_review",
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(Object.keys(result)).not.toContain("handover");
    expect(Object.keys(result)).not.toContain("confirmation");
    expect(Object.keys(result)).not.toContain("acceptance");
  });

  it("treats mutation-shaped provider output as invalid", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve(completion({
        questions: missingInfo.map(({ id }) => ({
          missingInfoId: id,
          question: "Please provide this missing fact.",
        })),
        resolved: true,
      })),
    );
    const result = await draftMissingInformationQuestions(
      { complete },
      request(),
    );

    expect(result).toMatchObject({
      consequentialMutationAllowed: false,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
