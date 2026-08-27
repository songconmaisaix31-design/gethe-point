import { describe, expect, it, vi } from "vitest";

import type {
  Domain,
  Member,
  MemberActor,
  SharedSignal,
  Space,
  Task,
} from "../../../packages/contracts/src/index";
import {
  RESPONSIBILITY_REPORT_TEMPLATES,
  createResponsibilityService,
  type AttributionCorrectionContext,
  type CommitAttributionCorrectionInput,
  type ReportSignalRecord,
  type ResponsibilityReportContext,
  type ResponsibilityRepository,
} from "../index";

const IDS = Object.freeze({
  space: "00000000-0000-4000-8000-000000000001",
  primary: "00000000-0000-4000-8000-000000000002",
  partner: "00000000-0000-4000-8000-000000000003",
  outsider: "00000000-0000-4000-8000-000000000004",
  domain: "00000000-0000-4000-8000-000000000005",
  task: "00000000-0000-4000-8000-000000000006",
  evidence: "00000000-0000-4000-8000-000000000007",
  signal: "00000000-0000-4000-8000-000000000008",
  consent: "00000000-0000-4000-8000-000000000009",
  request: "00000000-0000-4000-8000-000000000010",
  audit: "00000000-0000-4000-8000-000000000011",
});

const TIMES = Object.freeze({
  created: "2026-08-01T00:00:00.000Z",
  updated: "2026-08-15T00:00:00.000Z",
  generated: "2026-09-01T00:00:00.000Z",
});

const metadata = (id: string, spaceId = IDS.space, version = 2) => ({
  id,
  spaceId,
  createdAt: TIMES.created,
  updatedAt: TIMES.updated,
  version,
});

const space: Space = {
  ...metadata(IDS.space),
  name: "Fixture family",
  createdBy: IDS.primary,
  status: "active",
};

const member = (
  id: string,
  role: Member["role"],
  status: Member["status"] = "active",
): Member => ({
  ...metadata(id),
  role,
  displayName: role,
  status,
  joinedAt: TIMES.created,
  analysisConsent: "enabled",
});

const primary = member(IDS.primary, "primary");
const partner = member(IDS.partner, "partner");

const actor: MemberActor = {
  kind: "member",
  memberId: IDS.primary,
  spaceId: IDS.space,
  role: "primary",
  authentication: "verified_session",
};

const domain: Domain = {
  ...metadata(IDS.domain),
  name: "Appointments",
  ownerId: IDS.primary,
  status: "active",
  nextAction: "Confirm the next appointment",
  visibility: { kind: "space" },
  evidenceIds: [IDS.evidence],
};

const task: Task = {
  ...metadata(IDS.task),
  domainId: IDS.domain,
  title: "Confirm appointment",
  dueAt: null,
  status: "completed",
  reviewState: "current",
  visibility: { kind: "space" },
  evidenceIds: [IDS.evidence],
  discoveredBy: IDS.primary,
  deadlineKeptBy: IDS.primary,
  scheduledBy: IDS.primary,
  executedBy: IDS.partner,
  followedUpBy: IDS.primary,
};

const evidence = {
  id: IDS.evidence,
  spaceId: IDS.space,
  speakerId: IDS.primary,
  state: "available" as const,
  version: 2,
};

const signal: SharedSignal = {
  ...metadata(IDS.signal),
  speakerId: IDS.primary,
  consentDecisionId: IDS.consent,
  redactedExcerpt: "需要确认下一次预约时间",
  conclusion: "A shared appointment fact exists.",
  purpose: "responsibility",
  visibility: { kind: "space" },
  provenance: [
    {
      evidenceId: IDS.evidence,
      sourceType: "family_group",
      speakerId: IDS.primary,
      occurredAt: TIMES.created,
      state: "available",
    },
  ],
  evidenceState: "available",
};

const reportSignal: ReportSignalRecord = {
  signal,
  sourceKind: "potential_task",
  taskIds: [IDS.task],
  domainIds: [IDS.domain],
};

const correctionContext = (): AttributionCorrectionContext => ({
  space,
  actorMember: primary,
  members: [primary, partner],
  domain,
  task,
  evidence: [evidence],
});

const reportContext = (): ResponsibilityReportContext => ({
  space,
  actorMember: primary,
  members: [primary, partner],
  domains: [domain],
  tasks: [task],
  signals: [reportSignal],
  evidence: [evidence],
});

const correctionRequest = () => ({
  requestId: IDS.request,
  idempotencyKey: "responsibility-correction-0001",
  taskId: IDS.task,
  attribution: {
    discoveredBy: IDS.primary,
    deadlineKeptBy: IDS.primary,
    scheduledBy: IDS.partner,
    executedBy: IDS.partner,
    followedUpBy: IDS.primary,
  },
  reason: "The schedule was created by the partner.",
  expectedVersion: task.version,
});

const reportRequest = () => ({
  requestId: IDS.request,
  spaceId: IDS.space,
  period: {
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-09-01T00:00:00.000Z",
  },
});

const createRepository = (
  correction: unknown = correctionContext(),
  report: unknown = reportContext(),
) => {
  const loadAttributionCorrectionContext =
    vi.fn<ResponsibilityRepository["loadAttributionCorrectionContext"]>();
  loadAttributionCorrectionContext.mockResolvedValue(correction);
  const commitAttributionCorrection =
    vi.fn<ResponsibilityRepository["commitAttributionCorrection"]>();
  commitAttributionCorrection.mockImplementation(
    (input: CommitAttributionCorrectionInput) =>
      Promise.resolve({
        status: "corrected",
        task: {
          ...task,
          ...input.request.attribution,
          version: input.request.expectedVersion + 1,
        },
        auditEntryId: input.auditEntry.id,
      }),
  );
  const loadResponsibilityReportContext =
    vi.fn<ResponsibilityRepository["loadResponsibilityReportContext"]>();
  loadResponsibilityReportContext.mockResolvedValue(report);
  const repository: ResponsibilityRepository = {
    loadAttributionCorrectionContext,
    commitAttributionCorrection,
    loadResponsibilityReportContext,
  };
  return {
    repository,
    loadAttributionCorrectionContext,
    commitAttributionCorrection,
    loadResponsibilityReportContext,
  };
};

const createService = (repository: ResponsibilityRepository) =>
  createResponsibilityService({
    repository,
    clock: { now: () => new Date(TIMES.generated) },
    createId: () => IDS.audit,
  });

describe("task attribution correction", () => {
  it("writes one guarded correction with content-free audit metadata", async () => {
    const fixture = createRepository();
    const service = createService(fixture.repository);

    const result = await service.correctTaskAttribution(
      actor,
      correctionRequest(),
    );

    expect(result.ok).toBe(true);
    expect(fixture.commitAttributionCorrection).toHaveBeenCalledTimes(1);
    const committed = fixture.commitAttributionCorrection.mock.calls[0]?.[0];
    expect(committed).toBeDefined();
    expect(committed?.guard).toEqual({
      space: { id: IDS.space, version: 2 },
      actorMember: { id: IDS.primary, version: 2 },
      domain: { id: IDS.domain, version: 2 },
      task: { id: IDS.task, version: 2 },
      members: [
        { id: IDS.primary, version: 2 },
        { id: IDS.partner, version: 2 },
      ],
      evidence: [{ id: IDS.evidence, version: 2 }],
    });
    expect(committed?.auditEntry.changes).toEqual([
      {
        field: "scheduledBy",
        before: { kind: "id", value: IDS.primary },
        after: { kind: "id", value: IDS.partner },
      },
    ]);
    expect(JSON.stringify(committed?.auditEntry)).not.toContain(
      correctionRequest().reason,
    );
    expect(JSON.stringify(committed)).not.toContain(correctionRequest().reason);
    expect(committed?.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects stale versions and missing evidence before mutation", async () => {
    const staleFixture = createRepository();
    const staleService = createService(staleFixture.repository);
    const staleResult = await staleService.correctTaskAttribution(actor, {
      ...correctionRequest(),
      expectedVersion: task.version - 1,
    });

    expect(staleResult).toMatchObject({
      ok: false,
      error: { code: "stale_version" },
    });
    expect(staleFixture.commitAttributionCorrection).not.toHaveBeenCalled();

    const missingFixture = createRepository({
      ...correctionContext(),
      evidence: [{ ...evidence, state: "deleted" }],
    });
    const missingService = createService(missingFixture.repository);
    const missingResult = await missingService.correctTaskAttribution(
      actor,
      correctionRequest(),
    );

    expect(missingResult).toMatchObject({
      ok: false,
      error: { code: "evidence_missing" },
    });
    expect(missingFixture.commitAttributionCorrection).not.toHaveBeenCalled();
  });

  it("rejects inactive actors and unauthorized attribution members", async () => {
    const inactiveFixture = createRepository({
      ...correctionContext(),
      actorMember: { ...primary, status: "inactive" },
    });
    const inactiveService = createService(inactiveFixture.repository);

    expect(
      await inactiveService.correctTaskAttribution(actor, correctionRequest()),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(inactiveFixture.commitAttributionCorrection).not.toHaveBeenCalled();

    const unauthorizedFixture = createRepository();
    const unauthorizedService = createService(unauthorizedFixture.repository);
    const unauthorizedResult = await unauthorizedService.correctTaskAttribution(
      actor,
      {
        ...correctionRequest(),
        attribution: {
          ...correctionRequest().attribution,
          executedBy: IDS.outsider,
        },
      },
    );

    expect(unauthorizedResult).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(unauthorizedFixture.commitAttributionCorrection).not.toHaveBeenCalled();
  });

  it("surfaces an atomic stale guard without claiming success", async () => {
    const fixture = createRepository();
    fixture.commitAttributionCorrection.mockResolvedValue({
      status: "stale_version",
    });
    const service = createService(fixture.repository);

    const result = await service.correctTaskAttribution(
      actor,
      correctionRequest(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "stale_version" },
    });
  });
});

describe("deterministic responsibility reports", () => {
  it("counts all five persisted stages and uses neutral Chinese copy", async () => {
    const fixture = createRepository();
    const service = createService(fixture.repository);

    const result = await service.getResponsibilityReport(actor, reportRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.result.report.rows).toEqual([
      {
        stage: "discoveredBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
        ],
      },
      {
        stage: "deadlineKeptBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
        ],
      },
      {
        stage: "scheduledBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
        ],
      },
      {
        stage: "executedBy",
        counts: [
          { memberId: IDS.primary, count: 0 },
          { memberId: IDS.partner, count: 1 },
        ],
      },
      {
        stage: "followedUpBy",
        counts: [
          { memberId: IDS.primary, count: 1 },
          { memberId: IDS.partner, count: 0 },
        ],
      },
    ]);
    expect(result.result.report.narrative).toBe(
      RESPONSIBILITY_REPORT_TEMPLATES.shared,
    );
    expect(result.result.report.narrative).not.toMatch(
      /评分|分数|排名|责怪|诊断|失职|偷懒|应该/u,
    );
  });

  it("excludes discussion-only, evidence-missing, and needs-review facts", async () => {
    const discussionTaskId = "00000000-0000-4000-8000-000000000020";
    const missingTaskId = "00000000-0000-4000-8000-000000000021";
    const reviewTaskId = "00000000-0000-4000-8000-000000000022";
    const orphanReviewTaskId = "00000000-0000-4000-8000-000000000027";
    const missingEvidenceId = "00000000-0000-4000-8000-000000000023";
    const discussionSignalId = "00000000-0000-4000-8000-000000000024";
    const missingSignalId = "00000000-0000-4000-8000-000000000025";
    const reviewSignalId = "00000000-0000-4000-8000-000000000026";
    const copiedTask = (
      id: string,
      evidenceId: string = IDS.evidence,
    ): Task => ({
      ...task,
      id,
      evidenceIds: [evidenceId],
    });
    const copiedSignal = (
      id: string,
      taskId: string,
      sourceKind: ReportSignalRecord["sourceKind"],
      evidenceId: string = IDS.evidence,
      state: SharedSignal["evidenceState"] = "available",
    ): ReportSignalRecord => ({
      signal: {
        ...signal,
        id,
        evidenceState: state,
        provenance: [
          {
            evidenceId,
            sourceType: "family_group",
            speakerId: IDS.primary,
            occurredAt: TIMES.created,
            state: state === "available" ? "available" : "deleted",
          },
        ],
      },
      sourceKind,
      taskIds: [taskId],
      domainIds: [],
    });
    const context: ResponsibilityReportContext = {
      ...reportContext(),
      tasks: [
        task,
        copiedTask(discussionTaskId),
        copiedTask(missingTaskId, missingEvidenceId),
        { ...copiedTask(reviewTaskId), reviewState: "needs_review" },
        { ...copiedTask(orphanReviewTaskId), reviewState: "needs_review" },
      ],
      signals: [
        reportSignal,
        copiedSignal(discussionSignalId, discussionTaskId, "discussion_only"),
        copiedSignal(
          missingSignalId,
          missingTaskId,
          "potential_task",
          missingEvidenceId,
          "evidence_missing",
        ),
        copiedSignal(reviewSignalId, reviewTaskId, "potential_task"),
      ],
      evidence: [
        evidence,
        {
          ...evidence,
          id: missingEvidenceId,
          state: "deleted",
        },
      ],
    };
    const fixture = createRepository(correctionContext(), context);
    const service = createService(fixture.repository);

    const result = await service.getResponsibilityReport(actor, reportRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.result.report.excludedNeedsReviewCount).toBe(2);
    expect(
      result.result.report.rows.find(({ stage }) => stage === "executedBy")
        ?.counts,
    ).toEqual([
      { memberId: IDS.primary, count: 0 },
      { memberId: IDS.partner, count: 1 },
    ]);
  });

  it("does not count facts outside the actor's visibility", async () => {
    const hiddenVisibility = {
      kind: "members" as const,
      memberIds: [IDS.partner],
    };
    const hiddenContext: ResponsibilityReportContext = {
      ...reportContext(),
      domains: [{ ...domain, visibility: hiddenVisibility }],
      tasks: [{ ...task, visibility: hiddenVisibility }],
      signals: [
        {
          ...reportSignal,
          signal: { ...signal, visibility: hiddenVisibility },
        },
      ],
    };
    const fixture = createRepository(correctionContext(), hiddenContext);
    const service = createService(fixture.repository);

    const result = await service.getResponsibilityReport(actor, reportRequest());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(
      result.result.report.rows.flatMap(({ counts }) => counts).every(
        ({ count }) => count === 0,
      ),
    ).toBe(true);
    expect(result.result.report.narrative).toBe(
      RESPONSIBILITY_REPORT_TEMPLATES.empty,
    );
    expect(fixture.commitAttributionCorrection).not.toHaveBeenCalled();
  });
});
