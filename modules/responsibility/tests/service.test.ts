import { describe, expect, it, vi } from "vitest";

import {
  TaskSchema,
  type CorrectTaskAttributionRequest,
  type ResponsibilityAttribution,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  RESPONSIBILITY_REPORT_TEMPLATES,
  createResponsibilityService,
  type CommitAttributionCorrectionInput,
  type ResponsibilityRepository,
} from "../src";
import {
  actor,
  concentratedAttribution,
  correctionContext,
  evidence,
  ids,
  makeEvidence,
  makeSignal,
  makeTask,
  partnerMember,
  primaryMember,
  reportContext,
  timestamps,
} from "./fixtures";

const requireValue = <Value>(
  value: Value | undefined,
  label: string,
): Value => {
  if (value === undefined) {
    throw new Error(`Missing test fixture value: ${label}`);
  }
  return value;
};

const correctionRequest = (
  overrides: Partial<CorrectTaskAttributionRequest> = {},
): CorrectTaskAttributionRequest => ({
  requestId: ids.request,
  idempotencyKey: "correction-request-0001",
  taskId: ids.task,
  attribution: concentratedAttribution,
  reason: "Correct the five persisted responsibility fields.",
  expectedVersion: 3,
  ...overrides,
});

const correctedTask = (
  task: Task,
  attribution: ResponsibilityAttribution,
): Task =>
  TaskSchema.parse({
    ...task,
    ...attribution,
    updatedAt: timestamps.now,
    version: task.version + 1,
  });

const createCorrectionHarness = () => {
  let context = correctionContext();
  const stored = new Map<
    string,
    Readonly<{
      requestHash: string;
      task: Task;
      auditEntryId: string;
      auditOccurredAt: string;
    }>
  >();
  const commits: CommitAttributionCorrectionInput[] = [];

  const resolveAttributionCorrection =
    vi.fn<ResponsibilityRepository["resolveAttributionCorrection"]>((input) => {
      const previous = stored.get(input.idempotencyKey);
      if (previous === undefined) {
        return Promise.resolve({ status: "miss" });
      }
      if (previous.requestHash !== input.requestHash) {
        return Promise.resolve({ status: "conflict" });
      }
      return Promise.resolve({
        status: "replayed",
        result: {
          task: previous.task,
          auditEntryId: previous.auditEntryId,
          auditOccurredAt: previous.auditOccurredAt,
        },
      });
    });
  const loadAttributionCorrectionContext =
    vi.fn<ResponsibilityRepository["loadAttributionCorrectionContext"]>(() =>
      Promise.resolve(context),
    );
  const commitAttributionCorrection =
    vi.fn<ResponsibilityRepository["commitAttributionCorrection"]>((input) => {
      commits.push(input);
      const task = correctedTask(context.task, input.request.attribution);
      const result = {
        task,
        auditEntryId: input.auditEntry.id,
        auditOccurredAt: input.auditEntry.occurredAt,
      };
      stored.set(input.request.idempotencyKey, {
        requestHash: input.requestHash,
        ...result,
      });
      context = correctionContext(task);
      return Promise.resolve({ status: "corrected", result });
    });
  const loadResponsibilityReportContext =
    vi.fn<ResponsibilityRepository["loadResponsibilityReportContext"]>(() =>
      Promise.resolve(reportContext()),
    );

  const repository: ResponsibilityRepository = {
    resolveAttributionCorrection,
    loadAttributionCorrectionContext,
    commitAttributionCorrection,
    loadResponsibilityReportContext,
  };

  return {
    repository,
    commits,
    mocks: {
      resolveAttributionCorrection,
      loadAttributionCorrectionContext,
      commitAttributionCorrection,
      loadResponsibilityReportContext,
    },
  };
};

describe("task attribution correction", () => {
  it("resolves replay before mutable state and returns the original content-free audit", async () => {
    const harness = createCorrectionHarness();
    const now = vi.fn(() => new Date(timestamps.now));
    const createId = vi.fn(() => ids.audit);
    const service = createResponsibilityService({
      repository: harness.repository,
      clock: { now },
      createId,
    });
    const request = correctionRequest();

    const first = await service.correctTaskAttribution(actor, request);
    const replay = await service.correctTaskAttribution(actor, request);

    expect(first).toEqual({
      ok: true,
      result: {
        status: "corrected",
        task: correctedTask(makeTask(), concentratedAttribution),
        auditEntryId: ids.audit,
        auditOccurredAt: timestamps.now,
        replayed: false,
      },
    });
    expect(replay).toEqual({
      ok: true,
      result: {
        status: "corrected",
        task: correctedTask(makeTask(), concentratedAttribution),
        auditEntryId: ids.audit,
        auditOccurredAt: timestamps.now,
        replayed: true,
      },
    });
    expect(harness.mocks.loadAttributionCorrectionContext).toHaveBeenCalledTimes(1);
    expect(harness.mocks.commitAttributionCorrection).toHaveBeenCalledTimes(1);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalledTimes(1);

    const audit = requireValue(harness.commits[0], "correction commit").auditEntry;
    expect(audit.changes).toHaveLength(5);
    expect(JSON.stringify(audit)).not.toContain(request.reason);
    expect(Object.keys(audit).sort()).toEqual(
      [
        "action",
        "actor",
        "afterVersion",
        "beforeVersion",
        "changes",
        "id",
        "occurredAt",
        "retention",
        "spaceId",
        "targetId",
        "targetType",
        "visibility",
      ].sort(),
    );
  });

  it("rejects a same-key different payload and a stale fresh request without a second mutation", async () => {
    const harness = createCorrectionHarness();
    const now = vi.fn(() => new Date(timestamps.now));
    const createId = vi.fn(() => ids.audit);
    const service = createResponsibilityService({
      repository: harness.repository,
      clock: { now },
      createId,
    });
    await service.correctTaskAttribution(actor, correctionRequest());

    const conflict = await service.correctTaskAttribution(
      actor,
      correctionRequest({
        attribution: {
          ...concentratedAttribution,
          executedBy: ids.primary,
        },
      }),
    );
    const stale = await service.correctTaskAttribution(
      actor,
      correctionRequest({ idempotencyKey: "correction-request-0002" }),
    );

    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "stale_version" },
    });
    expect(harness.mocks.commitAttributionCorrection).toHaveBeenCalledTimes(1);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for missing evidence, inactive actors, or unauthorized attribution members", async () => {
    const cases = [
      correctionContext(
        makeTask({ reviewState: "needs_review" }),
      ),
      {
        ...correctionContext(),
        evidence: [{ ...evidence, state: "deleted" as const }],
      },
      {
        ...correctionContext(),
        actorMember: { ...primaryMember, status: "inactive" as const },
        members: [
          { ...primaryMember, status: "inactive" as const },
          partnerMember,
        ],
      },
      {
        ...correctionContext(),
        members: [primaryMember],
      },
    ];

    for (const context of cases) {
      const commitAttributionCorrection =
        vi.fn<ResponsibilityRepository["commitAttributionCorrection"]>(() =>
          Promise.reject(new Error("must not mutate")),
        );
      const repository: ResponsibilityRepository = {
        resolveAttributionCorrection:
          vi.fn<ResponsibilityRepository["resolveAttributionCorrection"]>(() =>
            Promise.resolve({ status: "miss" }),
          ),
        loadAttributionCorrectionContext:
          vi.fn<ResponsibilityRepository["loadAttributionCorrectionContext"]>(() =>
            Promise.resolve(context),
          ),
        commitAttributionCorrection,
        loadResponsibilityReportContext:
          vi.fn<ResponsibilityRepository["loadResponsibilityReportContext"]>(() =>
            Promise.resolve(reportContext()),
          ),
      };
      const service = createResponsibilityService({
        repository,
        clock: { now: () => new Date(timestamps.now) },
        createId: () => ids.audit,
      });
      const result = await service.correctTaskAttribution(
        actor,
        correctionRequest(),
      );
      expect(result.ok).toBe(false);
      expect(commitAttributionCorrection).not.toHaveBeenCalled();
    }
  });
});

const reportRequest = {
  requestId: ids.request,
  spaceId: ids.space,
  period: { startAt: timestamps.start, endAt: timestamps.end },
};

const reportWith = async (context: unknown) => {
  const repository: ResponsibilityRepository = {
    resolveAttributionCorrection:
      vi.fn<ResponsibilityRepository["resolveAttributionCorrection"]>(() =>
        Promise.resolve({ status: "miss" }),
      ),
    loadAttributionCorrectionContext:
      vi.fn<ResponsibilityRepository["loadAttributionCorrectionContext"]>(() =>
        Promise.resolve(correctionContext()),
      ),
    commitAttributionCorrection:
      vi.fn<ResponsibilityRepository["commitAttributionCorrection"]>(() =>
        Promise.resolve({ status: "conflict" }),
      ),
    loadResponsibilityReportContext:
      vi.fn<ResponsibilityRepository["loadResponsibilityReportContext"]>(() =>
        Promise.resolve(context),
      ),
  };
  const service = createResponsibilityService({
    repository,
    clock: { now: () => new Date(timestamps.now) },
    createId: () => ids.audit,
  });
  return service.getResponsibilityReport(actor, reportRequest);
};

describe("deterministic responsibility reports", () => {
  it("traces all five cells to persisted fields and uses the exact concentrated-coordination template", async () => {
    const result = await reportWith(reportContext());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.result.report.rows).toEqual([
      {
        stage: "discoveredBy",
        counts: [
          { memberId: ids.primary, count: 1 },
          { memberId: ids.partner, count: 0 },
        ],
      },
      {
        stage: "deadlineKeptBy",
        counts: [
          { memberId: ids.primary, count: 1 },
          { memberId: ids.partner, count: 0 },
        ],
      },
      {
        stage: "scheduledBy",
        counts: [
          { memberId: ids.primary, count: 1 },
          { memberId: ids.partner, count: 0 },
        ],
      },
      {
        stage: "executedBy",
        counts: [
          { memberId: ids.primary, count: 0 },
          { memberId: ids.partner, count: 1 },
        ],
      },
      {
        stage: "followedUpBy",
        counts: [
          { memberId: ids.primary, count: 1 },
          { memberId: ids.partner, count: 0 },
        ],
      },
    ]);
    expect(result.result.report.narrative).toBe(
      "本周家庭协调工作集中在一位成员身上。虽然执行任务有所分担，但发现、安排与跟进仍未形成完整责任所有权。",
    );
    expect(result.result.report.source).toBe("deterministic_template");
  });

  it("excludes discussion-only, evidence-missing, and needs-review facts", async () => {
    const base = reportContext();
    const discussionEvidence = makeEvidence(
      "00000000-0000-4000-8000-000000000020",
    );
    const missingEvidence = makeEvidence(
      "00000000-0000-4000-8000-000000000021",
      { state: "deleted" },
    );
    const reviewEvidence = makeEvidence(
      "00000000-0000-4000-8000-000000000022",
    );
    const discussionSignal = makeSignal(
      "00000000-0000-4000-8000-000000000023",
      discussionEvidence,
    );
    const missingSignal = makeSignal(
      "00000000-0000-4000-8000-000000000024",
      missingEvidence,
    );
    const reviewSignal = makeSignal(
      "00000000-0000-4000-8000-000000000025",
      reviewEvidence,
    );
    const context = {
      ...base,
      tasks: [
        ...base.tasks,
        {
          task: makeTask({
            id: "00000000-0000-4000-8000-000000000026",
            evidenceIds: [discussionEvidence.id],
            ...concentratedAttribution,
          }),
          sourceSignalIds: [discussionSignal.id],
        },
        {
          task: makeTask({
            id: "00000000-0000-4000-8000-000000000027",
            evidenceIds: [missingEvidence.id],
            ...concentratedAttribution,
          }),
          sourceSignalIds: [missingSignal.id],
        },
        {
          task: makeTask({
            id: "00000000-0000-4000-8000-000000000028",
            evidenceIds: [reviewEvidence.id],
            reviewState: "needs_review",
            ...concentratedAttribution,
          }),
          sourceSignalIds: [reviewSignal.id],
        },
      ],
      signals: [
        ...base.signals,
        { signal: discussionSignal, sourceKind: "discussion_only" as const },
        { signal: missingSignal, sourceKind: "potential_task" as const },
        { signal: reviewSignal, sourceKind: "potential_task" as const },
      ],
      evidence: [
        ...base.evidence,
        discussionEvidence,
        missingEvidence,
        reviewEvidence,
      ],
    };

    const result = await reportWith(context);
    const baseline = await reportWith(base);
    expect(result.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (!result.ok || !baseline.ok) {
      return;
    }
    expect(result.result.report.rows).toEqual(baseline.result.report.rows);
    expect(result.result.report.excludedNeedsReviewCount).toBe(2);
  });

  it("keeps empty, balanced, and uneven fixtures deterministic and neutral", async () => {
    const balancedAttribution: ResponsibilityAttribution = {
      discoveredBy: ids.primary,
      deadlineKeptBy: ids.primary,
      scheduledBy: ids.partner,
      executedBy: ids.partner,
      followedUpBy: ids.partner,
    };
    const unevenAttribution: ResponsibilityAttribution = {
      discoveredBy: ids.primary,
      deadlineKeptBy: ids.primary,
      scheduledBy: ids.primary,
      executedBy: ids.primary,
      followedUpBy: ids.primary,
    };
    const [empty, balanced, uneven] = await Promise.all([
      reportWith(reportContext(concentratedAttribution, "discussion_only")),
      reportWith(reportContext(balancedAttribution)),
      reportWith(reportContext(unevenAttribution)),
    ]);
    expect(empty.ok && empty.result.report.narrative).toBe(
      RESPONSIBILITY_REPORT_TEMPLATES.empty,
    );
    expect(balanced.ok && balanced.result.report.narrative).toBe(
      RESPONSIBILITY_REPORT_TEMPLATES.balanced,
    );
    expect(uneven.ok && uneven.result.report.narrative).toBe(
      RESPONSIBILITY_REPORT_TEMPLATES.uneven,
    );

    const forbidden = [
      "score",
      "rank",
      "blame",
      "diagnosis",
      "懒惰",
      "不合格",
      "贡献积分",
      "最佳伴侣",
      "关系质量",
    ];
    for (const narrative of Object.values(RESPONSIBILITY_REPORT_TEMPLATES)) {
      for (const word of forbidden) {
        expect(narrative.toLowerCase()).not.toContain(word);
      }
    }
  });
});
