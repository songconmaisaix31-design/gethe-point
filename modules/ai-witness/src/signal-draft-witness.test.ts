import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LLMProvider } from "../../../packages/contracts/src/index";

import { createSignalDraftWitness } from "./signal-draft-witness";

const safeOutput = {
  confidence: 0.82,
  kind: "potential_task",
  missingInfo: ["Confirm the preferred time."],
  proposedConclusion: "A follow-up may need to be scheduled.",
  redactedExcerpt: "A household follow-up was mentioned.",
} as const;

const completion = (output: unknown) => ({
  completion: {
    latencyMs: 12,
    output,
    usage: { inputTokens: 20, outputTokens: 10 },
  },
  status: "completed" as const,
});

describe("signal draft witness", () => {
  it("sends only bounded frozen provider fields and renders validated output", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve(completion(safeOutput)),
    );
    const witness = createSignalDraftWitness({ complete }, { timeoutMs: 100 });
    const requestId = randomUUID();

    const result = await witness.draft({
      privateValues: ["Pick up a private package from the north desk."],
      promptVersion: "signal-draft-v2",
      requestId,
    });

    expect(result).toMatchObject({
      fields: {
        candidateDomainId: null,
        proposedConclusion:
          "Review before sharing: A follow-up may need to be scheduled.",
        redactedExcerpt: "Summary: A household follow-up was mentioned.",
      },
      metadata: { attempts: 1, contentLogged: false },
      status: "validated",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0];
    expect(Object.keys(request ?? {}).toSorted()).toEqual([
      "attempt",
      "outputSchema",
      "promptVersion",
      "purpose",
      "redactedInput",
      "requestId",
      "timeoutMs",
    ]);
    expect(Array.from(request?.redactedInput ?? "")).toHaveLength(
      Array.from(request?.redactedInput ?? "").length,
    );
    expect(Array.from(request?.redactedInput ?? "").length).toBeLessThanOrEqual(
      4_000,
    );
  });

  it("recursively rejects a private string hidden in an unknown nested field", async () => {
    const privateValue = "Straße family detail";
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve(
        completion({
          ...safeOutput,
          nested: { value: "STRASSE family detail" },
        }),
      ),
    );
    const witness = createSignalDraftWitness({ complete }, { timeoutMs: 100 });

    const result = await witness.draft({
      privateValues: [privateValue],
      promptVersion: "signal-draft-v2",
      requestId: randomUUID(),
    });

    expect(result).toMatchObject({
      attempts: 2,
      consequentialMutationAllowed: false,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it("checks final human-template rendering after provider-field validation", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve(
        completion({ ...safeOutput, redactedExcerpt: "alpha" }),
      ),
    );
    const witness = createSignalDraftWitness({ complete }, { timeoutMs: 100 });

    const result = await witness.draft({
      privateValues: ["Summary: alpha"],
      promptVersion: "signal-draft-v2",
      requestId: randomUUID(),
    });

    expect(result).toMatchObject({
      attempts: 2,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("returns needs_human_review after a second invalid output", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve(
        completion({ kind: "potential_task", unbounded: true }),
      ),
    );
    const witness = createSignalDraftWitness({ complete }, { timeoutMs: 100 });

    const result = await witness.draft({
      privateValues: ["Private source content for review."],
      promptVersion: "signal-draft-v2",
      requestId: randomUUID(),
    });

    expect(result).toMatchObject({
      attempts: 2,
      consequentialMutationAllowed: false,
      reason: "provider_invalid_output",
      status: "needs_human_review",
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("maps provider failure and timeout to content-free human review", async () => {
    const unavailable = vi.fn<LLMProvider["complete"]>(() =>
      Promise.reject(
        new Error("private content must not escape through this message"),
      ),
    );
    const unavailableWitness = createSignalDraftWitness(
      { complete: unavailable },
      { timeoutMs: 100 },
    );
    const unavailableResult = await unavailableWitness.draft({
      privateValues: ["private content must not escape through this message"],
      promptVersion: "signal-draft-v2",
      requestId: randomUUID(),
    });

    expect(unavailableResult).toMatchObject({
      reason: "provider_unavailable",
      status: "needs_human_review",
    });
    expect(JSON.stringify(unavailableResult)).not.toContain("must not escape");

    const neverCompletes = vi.fn<LLMProvider["complete"]>(
      () => new Promise(() => undefined),
    );
    const timeoutWitness = createSignalDraftWitness(
      { complete: neverCompletes },
      { timeoutMs: 100 },
    );
    const timeoutResult = await timeoutWitness.draft({
      privateValues: ["another private value"],
      promptVersion: "signal-draft-v2",
      requestId: randomUUID(),
    });

    expect(timeoutResult).toMatchObject({
      reason: "provider_timeout",
      status: "needs_human_review",
    });
    expect(neverCompletes).toHaveBeenCalledTimes(2);
  });
});
