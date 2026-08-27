import { describe, expect, it, vi } from "vitest";

import {
  confirmDomainGrouping,
  type DomainGroupingCommit,
  type DomainGroupingRepository,
} from "../src/index";
import {
  IDS,
  TIMES,
  actor,
  createSignal,
  createSourceLink,
  createTask,
  createTaskFact,
  members,
} from "./fixtures";

const draft = {
  id: IDS.draft,
  spaceId: IDS.space,
  source: "fixture",
  proposedName: "Medication refills",
  proposedOwnerId: IDS.primary,
  taskIds: [IDS.task],
  evidenceIds: [IDS.evidence],
  missingInfo: [],
  promptVersion: "fixture-v1",
  generatedAt: TIMES.activity,
} as const;

const request = {
  requestId: IDS.request,
  idempotencyKey: "responsibility-domain-confirm-0001",
  draft,
  confirmation: {
    domainId: IDS.domain,
    name: "Medication refills",
    ownerId: IDS.primary,
    taskIds: [IDS.task],
    evidenceIds: [IDS.evidence],
    visibility: { kind: "space" },
    expectedTaskVersions: [{ taskId: IDS.task, version: 0 }],
    confirmedAt: TIMES.generated,
  },
} as const;

describe("domain grouping confirmation", () => {
  it("requires an explicit member confirmation before grouping persisted tasks", async () => {
    const commit = vi.fn((command: DomainGroupingCommit) =>
      Promise.resolve({
        status: "confirmed" as const,
        domain: command.domain,
        tasks: command.updatedTasks,
        confirmation: {
          actorMemberId: command.actor.memberId,
          draftId: command.validatedDraft.id,
          draftSource: command.validatedDraft.source,
          confirmedAt: command.request.confirmation.confirmedAt,
        },
      }),
    );
    const repository: DomainGroupingRepository = {
      findDomainGrouping: vi.fn().mockResolvedValue(null),
      loadDomainGroupingContext: vi.fn().mockResolvedValue({
        taskFacts: [createTaskFact()],
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitDomainGrouping: commit,
    };

    const result = await confirmDomainGrouping({
      actor,
      request,
      repository,
    });

    expect(result.domain).toMatchObject({
      id: IDS.domain,
      ownerId: IDS.primary,
      name: "Medication refills",
      status: "active",
      version: 0,
    });
    expect(result.tasks[0]).toMatchObject({
      id: IDS.task,
      domainId: IDS.domain,
      version: 1,
    });
    expect(result.confirmation).toEqual({
      actorMemberId: IDS.primary,
      draftId: IDS.draft,
      draftSource: "fixture",
      confirmedAt: TIMES.generated,
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("blocks incomplete drafts before persistence", async () => {
    const commit = vi.fn();
    const repository: DomainGroupingRepository = {
      findDomainGrouping: vi.fn().mockResolvedValue(null),
      loadDomainGroupingContext: vi.fn().mockResolvedValue({
        taskFacts: [createTaskFact()],
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitDomainGrouping: commit,
    };

    await expect(
      confirmDomainGrouping({
        actor,
        request: {
          ...request,
          draft: { ...draft, missingInfo: ["Confirm the recurring cadence."] },
        },
        repository,
      }),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a confirmation that widens persisted task or signal visibility", async () => {
    const commit = vi.fn();
    const narrowVisibility = {
      kind: "members" as const,
      memberIds: [IDS.primary],
    };
    const repository: DomainGroupingRepository = {
      findDomainGrouping: vi.fn().mockResolvedValue(null),
      loadDomainGroupingContext: vi.fn().mockResolvedValue({
        taskFacts: [
          createTaskFact({
            task: createTask({ visibility: narrowVisibility }),
            sourceLinks: [
              createSourceLink({
                signal: createSignal({ visibility: narrowVisibility }),
              }),
            ],
          }),
        ],
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitDomainGrouping: commit,
    };

    await expect(
      confirmDomainGrouping({ actor, request, repository }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(commit).not.toHaveBeenCalled();
  });
});
