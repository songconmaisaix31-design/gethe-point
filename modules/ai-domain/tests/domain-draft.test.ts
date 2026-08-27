import { describe, expect, it, vi } from "vitest";

import {
  createValidatedAIDomainDraft,
  isDomainDraftError,
  validateDomainDraft,
  type DomainDraft,
  type DomainDraftProvider,
} from "../src/index";

const IDS = {
  draft: "00000000-0000-4000-8000-000000000001",
  space: "00000000-0000-4000-8000-000000000002",
  member: "00000000-0000-4000-8000-000000000003",
  task: "00000000-0000-4000-8000-000000000004",
  evidence: "00000000-0000-4000-8000-000000000005",
  otherTask: "00000000-0000-4000-8000-000000000006",
} as const;

const scope = {
  spaceId: IDS.space,
  authorizedTaskIds: [IDS.task],
  authorizedEvidenceIds: [IDS.evidence],
  activeMemberIds: [IDS.member],
};

const fixtureDraft: DomainDraft = {
  id: IDS.draft,
  spaceId: IDS.space,
  source: "fixture",
  proposedName: "Medication refills",
  proposedOwnerId: IDS.member,
  taskIds: [IDS.task],
  evidenceIds: [IDS.evidence],
  missingInfo: [],
  promptVersion: "fixture-v1",
  generatedAt: "2026-08-27T01:00:00.000Z",
};

describe("domain draft validation", () => {
  it("accepts a fixture only when every reference is actor-authorized", () => {
    expect(validateDomainDraft(fixtureDraft, scope)).toEqual(fixtureDraft);
  });

  it("rejects out-of-scope and duplicate references", () => {
    expect(() =>
      validateDomainDraft(
        { ...fixtureDraft, taskIds: [IDS.task, IDS.otherTask] },
        scope,
      ),
    ).toThrow(expect.objectContaining({ code: "unauthorized_reference" }));

    expect(() =>
      validateDomainDraft(
        { ...fixtureDraft, taskIds: [IDS.task, IDS.task] },
        scope,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_shape" }));
  });

  it("validates unknown provider output before labelling it as AI-derived", async () => {
    const proposeDomain = vi.fn().mockResolvedValue({
      proposedName: "Medication refills",
      proposedOwnerId: IDS.member,
      taskIds: [IDS.task],
      evidenceIds: [IDS.evidence],
      missingInfo: [],
    });
    const provider: DomainDraftProvider = {
      proposeDomain,
    };

    const result = await createValidatedAIDomainDraft({
      provider,
      providerInput: {
        spaceId: IDS.space,
        items: [
          {
            taskId: IDS.task,
            redactedConclusion:
              "A refill was recorded as a responsibility item.",
            evidenceIds: [IDS.evidence],
          },
        ],
      },
      scope,
      metadata: {
        id: IDS.draft,
        generatedAt: "2026-08-27T01:00:00.000Z",
        promptVersion: "domain-v1",
      },
    });

    expect(result.source).toBe("validated_ai");
    expect(proposeDomain).toHaveBeenCalledOnce();
  });

  it("fails closed without exposing invalid provider payloads", async () => {
    const provider: DomainDraftProvider = {
      proposeDomain: vi.fn().mockResolvedValue({ taskIds: [IDS.task] }),
    };

    await expect(
      createValidatedAIDomainDraft({
        provider,
        providerInput: {
          spaceId: IDS.space,
          items: [
            {
              taskId: IDS.task,
              redactedConclusion: "A structured conclusion.",
              evidenceIds: [IDS.evidence],
            },
          ],
        },
        scope,
        metadata: {
          id: IDS.draft,
          generatedAt: "2026-08-27T01:00:00.000Z",
          promptVersion: "domain-v1",
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isDomainDraftError(error) && error.code === "provider_invalid_output",
    );
  });
});
