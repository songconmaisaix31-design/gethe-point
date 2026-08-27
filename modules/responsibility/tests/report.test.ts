import { describe, expect, it } from "vitest";

import { buildResponsibilityReport } from "../src/index";
import {
  IDS,
  TIMES,
  actor,
  createDomainFact,
  createDraft,
  createSignal,
  createSourceLink,
  createTask,
  createTaskFact,
  members,
} from "./fixtures";

describe("responsibility report", () => {
  it("counts persisted stages and neutrally excludes ineligible evidence", () => {
    const missingSignal = createSignal({
      evidenceState: "evidence_missing",
      provenance: [
        {
          evidenceId: IDS.evidence,
          sourceType: "family_group",
          speakerId: IDS.primary,
          occurredAt: TIMES.before,
          state: "deleted",
        },
      ],
    });
    const result = buildResponsibilityReport({
      actor,
      request: {
        requestId: IDS.request,
        spaceId: IDS.space,
        period: { startAt: TIMES.start, endAt: TIMES.end },
      },
      generatedAt: TIMES.generated,
      dataset: {
        members,
        tasks: [
          createTaskFact(),
          createTaskFact({
            task: createTask({ id: IDS.taskDiscussion }),
            sourceLinks: [
              createSourceLink({
                draft: createDraft({ kind: "discussion_only" }),
                signal: null,
              }),
            ],
          }),
          createTaskFact({
            task: createTask({ id: IDS.taskMissing }),
            sourceLinks: [createSourceLink({ signal: missingSignal })],
          }),
          createTaskFact({
            task: createTask({
              id: IDS.taskReview,
              reviewState: "needs_review",
            }),
          }),
          createTaskFact({
            task: createTask({
              id: IDS.taskHidden,
              visibility: { kind: "members", memberIds: [IDS.partner] },
            }),
          }),
        ],
        domains: [createDomainFact()],
      },
    });

    expect(result.result.report.rows).toEqual([
      {
        stage: "discoveredBy",
        counts: [
          { memberId: IDS.primary, count: 0 },
          { memberId: IDS.partner, count: 0 },
          { memberId: IDS.subject, count: 1 },
        ],
      },
      {
        stage: "deadlineKeptBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
          { memberId: IDS.subject, count: 0 },
        ],
      },
      {
        stage: "scheduledBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
          { memberId: IDS.subject, count: 0 },
        ],
      },
      {
        stage: "executedBy",
        counts: [
          { memberId: IDS.primary, count: 0 },
          { memberId: IDS.partner, count: 1 },
          { memberId: IDS.subject, count: 0 },
        ],
      },
      {
        stage: "followedUpBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
          { memberId: IDS.subject, count: 0 },
        ],
      },
    ]);
    expect(result.result.report.unownedDomainCount).toBe(1);
    expect(result.result.report.excludedNeedsReviewCount).toBe(1);
    expect(result.result.report.source).toBe("deterministic_template");
    expect(result.trace.includedTaskIds).toEqual([IDS.task]);
    expect(result.trace.excludedVisibleTasks).toEqual([
      { taskId: IDS.taskDiscussion, reason: "discussion_only" },
      { taskId: IDS.taskMissing, reason: "evidence_missing" },
      { taskId: IDS.taskReview, reason: "needs_review" },
    ]);
    expect(result.trace.excludedVisibleTasks).not.toContainEqual(
      expect.objectContaining({ taskId: IDS.taskHidden }),
    );
    expect(result.result.report.narrative.toLowerCase()).not.toMatch(
      /score|rank|blame|lazy|fault|diagnos/,
    );
  });

  it("keeps the same neutral authored template for a concentrated workload", () => {
    const concentratedTask = createTask({
      discoveredBy: IDS.primary,
      deadlineKeptBy: IDS.primary,
      scheduledBy: IDS.primary,
      executedBy: IDS.primary,
      followedUpBy: IDS.primary,
    });
    const result = buildResponsibilityReport({
      actor,
      request: {
        requestId: IDS.request,
        spaceId: IDS.space,
        period: { startAt: TIMES.start, endAt: TIMES.end },
      },
      generatedAt: TIMES.generated,
      dataset: {
        members,
        tasks: [createTaskFact({ task: concentratedTask })],
        domains: [],
      },
    });

    expect(result.result.report.narrative).toContain(
      "without evaluating effort, intent, or relationships",
    );
    expect(
      result.result.report.rows.flatMap(({ counts }) => counts),
    ).toContainEqual({ memberId: IDS.primary, count: 1 });
  });
});
