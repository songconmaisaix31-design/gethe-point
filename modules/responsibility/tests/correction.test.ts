import { describe, expect, it, vi } from "vitest";

import {
  correctTaskAttribution,
  type AttributionCorrectionCommit,
  type AttributionCorrectionRepository,
} from "../src/index";
import {
  IDS,
  TIMES,
  actor,
  createTaskFact,
  members,
} from "./fixtures";

const request = {
  requestId: IDS.request,
  idempotencyKey: "responsibility-correction-0001",
  taskId: IDS.task,
  attribution: {
    discoveredBy: IDS.subject,
    deadlineKeptBy: IDS.primary,
    scheduledBy: IDS.primary,
    executedBy: IDS.primary,
    followedUpBy: IDS.primary,
  },
  reason: "The confirmed execution record identifies the primary member.",
  expectedVersion: 0,
} as const;

describe("task attribution correction", () => {
  it("commits an actor-authorized task update with exact audit metadata", async () => {
    const commit = vi.fn(
      (command: AttributionCorrectionCommit) =>
        Promise.resolve({
          status: "corrected" as const,
          task: command.updatedTask,
          auditEntryId: command.auditEntry.id,
        }),
    );
    const repository: AttributionCorrectionRepository = {
      findAttributionCorrection: vi.fn().mockResolvedValue(null),
      loadAttributionCorrectionContext: vi.fn().mockResolvedValue({
        taskFact: createTaskFact(),
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitAttributionCorrection: commit,
    };

    const result = await correctTaskAttribution({
      actor,
      request,
      repository,
      now: () => TIMES.generated,
      createId: () => IDS.audit,
    });

    expect(result.task.executedBy).toBe(IDS.primary);
    expect(result.task.version).toBe(1);
    expect(commit).toHaveBeenCalledOnce();
    const command = commit.mock.calls[0]?.[0];
    expect(command?.actor.memberId).toBe(IDS.primary);
    expect(command?.request.reason).toBe(request.reason);
    expect(command?.correctedFields).toEqual(["executedBy"]);
    expect(command?.auditEntry).toMatchObject({
      id: IDS.audit,
      action: "task_attribution_corrected",
      beforeVersion: 0,
      afterVersion: 1,
      occurredAt: TIMES.generated,
      changes: [
        {
          field: "executedBy",
          before: { kind: "id", value: IDS.partner },
          after: { kind: "id", value: IDS.primary },
        },
      ],
      actor: {
        kind: "member",
        memberId: IDS.primary,
        spaceId: IDS.space,
      },
    });
  });

  it("rejects stale versions before any write", async () => {
    const commit = vi.fn();
    const repository: AttributionCorrectionRepository = {
      findAttributionCorrection: vi.fn().mockResolvedValue(null),
      loadAttributionCorrectionContext: vi.fn().mockResolvedValue({
        taskFact: createTaskFact({
          task: { ...createTaskFact().task, version: 2 },
        }),
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitAttributionCorrection: commit,
    };

    await expect(
      correctTaskAttribution({
        actor,
        request,
        repository,
        now: () => TIMES.generated,
        createId: () => IDS.audit,
      }),
    ).rejects.toMatchObject({ code: "stale_version" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a cross-space actor and does not write", async () => {
    const commit = vi.fn();
    const repository: AttributionCorrectionRepository = {
      findAttributionCorrection: vi.fn().mockResolvedValue(null),
      loadAttributionCorrectionContext: vi.fn().mockResolvedValue({
        taskFact: createTaskFact(),
        activeMemberIds: members.map(({ id }) => id),
      }),
      commitAttributionCorrection: commit,
    };

    await expect(
      correctTaskAttribution({
        actor: { ...actor, spaceId: IDS.otherSpace },
        request,
        repository,
        now: () => TIMES.generated,
        createId: () => IDS.audit,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(commit).not.toHaveBeenCalled();
  });
});
