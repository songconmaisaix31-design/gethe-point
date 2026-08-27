import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  FIXTURE_ACTORS,
  FIXTURE_CONSENT,
  FIXTURE_DOMAIN,
  FIXTURE_EVIDENCE,
  FIXTURE_IDS,
  FIXTURE_REPORT,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SIGNAL_DRAFT,
  FIXTURE_TASK,
  FIXTURE_TIMES,
  TaskSchema,
  type CorrectTaskAttributionResult,
  type GetResponsibilityReportResult,
  type Task,
} from "../../../packages/contracts/src/index";
import { createCanonicalFixtureResponsibilityDraftPort } from "../../ai-domain/src/index";
import {
  ResponsibilityReportSnapshotSchema,
  ResponsibilitySourceContextSchema,
  AttributionCorrectionContextSchema,
  RESPONSIBILITY_REPORT_TEMPLATES,
  createResponsibilityService,
  isResponsibilityError,
  type AttributionCorrectionCommand,
  type AttributionCorrectionPort,
  type ResponsibilityCreationCommand,
  type ResponsibilityDraftPort,
  type ResponsibilityPersistencePort,
  type ResponsibilityReportPort,
  type ResponsibilitySourceContext,
  type ResponsibilitySourcePort,
} from "../src/index";
import {
  FIXED_CLOCK,
  fixtureMembers,
  fixtureReportSnapshot,
  fixtureSourceContext,
} from "./fixtures";

const createRequest = {
  requestId: FIXTURE_IDS.request,
  sourceSignalId: FIXTURE_IDS.signal,
};

const reportRequest = {
  period: {
    endAt: FIXTURE_TIMES.periodEnd,
    startAt: FIXTURE_TIMES.created,
  },
  requestId: FIXTURE_IDS.request,
  spaceId: FIXTURE_IDS.space,
};

const expectCode = (code: string) => (error: unknown): boolean =>
  isResponsibilityError(error) && error.code === code;

const createHarness = (
  sourceValue: unknown = fixtureSourceContext(),
  reportValue: unknown = fixtureReportSnapshot(),
  draftPort: ResponsibilityDraftPort =
    createCanonicalFixtureResponsibilityDraftPort(),
) => {
  const loadSource = vi.fn<ResponsibilitySourcePort["load"]>(() =>
    Promise.resolve(sourceValue),
  );
  const source: ResponsibilitySourcePort = { load: loadSource };
  const draft = vi.fn<ResponsibilityDraftPort["draft"]>((input) =>
    draftPort.draft(input),
  );
  let stored: ResponsibilityCreationCommand | undefined;
  let mutationCount = 0;
  const create = vi.fn<ResponsibilityPersistencePort["create"]>((command) => {
    if (stored === undefined) {
      stored = command;
      mutationCount += 1;
    }

    return Promise.resolve({
      domain: stored.domain,
      sourceSignalId: stored.sourceSignalId,
      status: mutationCount === 1 && stored === command ? "created" : "replayed",
      task: stored.task,
    });
  });
  const loadReport = vi.fn<ResponsibilityReportPort["load"]>(() =>
    Promise.resolve(reportValue),
  );
  const service = createResponsibilityService({
    clock: FIXED_CLOCK,
    drafts: { draft },
    persistence: { create },
    reports: { load: loadReport },
    sources: source,
  });

  return {
    create,
    draft,
    loadReport,
    loadSource,
    mutationCount: () => mutationCount,
    service,
  };
};

describe("responsibility creation", () => {
  it("creates exactly one canonical Fixture domain and task with five persisted owners", async () => {
    const harness = createHarness();

    const first = await harness.service.createFromSharedSignal(
      FIXTURE_ACTORS.primary,
      createRequest,
    );
    const second = await harness.service.createFromSharedSignal(
      FIXTURE_ACTORS.primary,
      createRequest,
    );

    expect(first).toMatchObject({
      domain: FIXTURE_DOMAIN,
      sourceSignalId: FIXTURE_IDS.signal,
      status: "created",
      task: FIXTURE_TASK,
    });
    expect(second.status).toBe("replayed");
    expect(harness.mutationCount()).toBe(1);

    const command = harness.create.mock.calls[0]?.[0];
    expect(command).toBeDefined();
    expect(command?.task).toMatchObject({
      deadlineKeptBy: FIXTURE_IDS.primary,
      discoveredBy: FIXTURE_IDS.subject,
      executedBy: FIXTURE_IDS.partner,
      followedUpBy: FIXTURE_IDS.primary,
      scheduledBy: FIXTURE_IDS.primary,
    });
    expect(command?.guard.evidence).toEqual([
      { id: FIXTURE_IDS.evidence, version: 0 },
    ]);
  });

  it.each([
    [
      "discussion-only",
      ResponsibilitySourceContextSchema.parse({
        ...fixtureSourceContext(),
        draft: { ...FIXTURE_SIGNAL_DRAFT, kind: "discussion_only" },
      }),
      "needs_human_review",
    ],
    [
      "denied consent",
      ResponsibilitySourceContextSchema.parse({
        ...fixtureSourceContext(),
        consent: {
          ...FIXTURE_CONSENT,
          expiresAt: null,
          outcome: "discard",
          recordState: "discarded",
          revokedAt: null,
          visibility: null,
        },
      }),
      "consent_invalid",
    ],
    [
      "missing evidence",
      ResponsibilitySourceContextSchema.parse({
        ...fixtureSourceContext(),
        evidence: [{ ...FIXTURE_EVIDENCE, state: "deleted" }],
        signal: {
          ...FIXTURE_SHARED_SIGNAL,
          evidenceState: "evidence_missing",
          provenance: [
            { ...FIXTURE_SHARED_SIGNAL.provenance[0], state: "deleted" },
          ],
        },
      }),
      "evidence_missing",
    ],
    [
      "revoked future analysis consent",
      ResponsibilitySourceContextSchema.parse({
        ...fixtureSourceContext(),
        members: [
          fixtureMembers()[0],
          fixtureMembers()[1],
          { ...fixtureMembers()[2], analysisConsent: "revoked" },
        ],
        speaker: { ...fixtureMembers()[2], analysisConsent: "revoked" },
      }),
      "consent_invalid",
    ],
  ])("rejects %s before drafting or persistence", async (_name, source, code) => {
    const harness = createHarness(source);

    await expect(
      harness.service.createFromSharedSignal(FIXTURE_ACTORS.primary, createRequest),
    ).rejects.toSatisfy(expectCode(code));
    expect(harness.draft).not.toHaveBeenCalled();
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("makes invalid actors, spaces, source data, and review fallback zero-mutation", async () => {
    const invalidActorHarness = createHarness();
    await expect(
      invalidActorHarness.service.createFromSharedSignal(
        { kind: "member" },
        createRequest,
      ),
    ).rejects.toSatisfy(expectCode("unauthenticated"));
    expect(invalidActorHarness.loadSource).not.toHaveBeenCalled();
    expect(invalidActorHarness.create).not.toHaveBeenCalled();

    const otherSpaceHarness = createHarness();
    await expect(
      otherSpaceHarness.service.createFromSharedSignal(
        { ...FIXTURE_ACTORS.primary, spaceId: randomUUID() },
        createRequest,
      ),
    ).rejects.toSatisfy(expectCode("not_found"));
    expect(otherSpaceHarness.create).not.toHaveBeenCalled();

    const malformedHarness = createHarness({ raw: "private" });
    await expect(
      malformedHarness.service.createFromSharedSignal(
        FIXTURE_ACTORS.primary,
        createRequest,
      ),
    ).rejects.toSatisfy(expectCode("internal_failure"));
    expect(malformedHarness.create).not.toHaveBeenCalled();

    const reviewDraft: ResponsibilityDraftPort = {
      draft: () =>
        Promise.resolve({
          consequentialMutationAllowed: false,
          reason: "unsupported_fixture",
          status: "needs_human_review",
        }),
    };
    const reviewHarness = createHarness(
      fixtureSourceContext(),
      fixtureReportSnapshot(),
      reviewDraft,
    );
    await expect(
      reviewHarness.service.createFromSharedSignal(
        FIXTURE_ACTORS.primary,
        createRequest,
      ),
    ).rejects.toSatisfy(expectCode("needs_human_review"));
    expect(reviewHarness.create).not.toHaveBeenCalled();
  });
});

const totalReportCount = (report: GetResponsibilityReportResult): number =>
  report.report.rows.reduce(
    (total, row) =>
      total + row.counts.reduce((rowTotal, { count }) => rowTotal + count, 0),
    0,
  );

const snapshotWith = (
  source: ResponsibilitySourceContext,
  task: Task = TaskSchema.parse(FIXTURE_TASK),
) =>
  ResponsibilityReportSnapshotSchema.parse({
    actorMember: fixtureMembers()[0],
    domains: [FIXTURE_DOMAIN],
    members: fixtureMembers(),
    sources: [source],
    space: fixtureSourceContext().space,
    tasks: [{ sourceSignalId: source.signal.id, task }],
  });

describe("deterministic responsibility reports", () => {
  it("reads all five cells directly from persisted fields and matches the neutral Fixture report", async () => {
    const harness = createHarness();
    const result = await harness.service.getResponsibilityReport(
      FIXTURE_ACTORS.primary,
      reportRequest,
    );

    expect(result.report.rows).toEqual(FIXTURE_REPORT.rows);
    expect(result.report.narrative).toBe(FIXTURE_REPORT.narrative);
    expect(result.report.source).toBe("deterministic_template");
    expect(result.report.unownedDomainCount).toBe(0);
    expect(result.report.excludedNeedsReviewCount).toBe(0);
    expect(harness.draft).not.toHaveBeenCalled();
    expect(harness.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "discussion-only",
      snapshotWith(
        ResponsibilitySourceContextSchema.parse({
          ...fixtureSourceContext(),
          draft: { ...FIXTURE_SIGNAL_DRAFT, kind: "discussion_only" },
        }),
      ),
    ],
    [
      "missing-evidence",
      snapshotWith(
        ResponsibilitySourceContextSchema.parse({
          ...fixtureSourceContext(),
          evidence: [{ ...FIXTURE_EVIDENCE, state: "deleted" }],
          signal: {
            ...FIXTURE_SHARED_SIGNAL,
            evidenceState: "evidence_missing",
            provenance: [
              { ...FIXTURE_SHARED_SIGNAL.provenance[0], state: "deleted" },
            ],
          },
        }),
      ),
    ],
    [
      "denied",
      snapshotWith(
        ResponsibilitySourceContextSchema.parse({
          ...fixtureSourceContext(),
          consent: {
            ...FIXTURE_CONSENT,
            expiresAt: null,
            outcome: "discard",
            recordState: "discarded",
            revokedAt: null,
            visibility: null,
          },
        }),
      ),
    ],
    [
      "needs-review",
      snapshotWith(
        fixtureSourceContext(),
        TaskSchema.parse({ ...FIXTURE_TASK, reviewState: "needs_review" }),
      ),
    ],
  ])("excludes %s input from every report stage", async (_name, snapshot) => {
    const harness = createHarness(fixtureSourceContext(), snapshot);
    const result = await harness.service.getResponsibilityReport(
      FIXTURE_ACTORS.primary,
      reportRequest,
    );

    expect(totalReportCount(result)).toBe(0);
    expect(result.report.narrative).toBe("本期暂无可计入的责任记录。");
  });

  it("deduplicates repeated snapshot rows instead of inflating responsibility", async () => {
    const base = fixtureReportSnapshot();
    const duplicateSnapshot = ResponsibilityReportSnapshotSchema.parse({
      ...base,
      domains: [base.domains[0], base.domains[0]],
      sources: [base.sources[0], base.sources[0]],
      tasks: [base.tasks[0], base.tasks[0]],
    });
    const harness = createHarness(fixtureSourceContext(), duplicateSnapshot);
    const result = await harness.service.getResponsibilityReport(
      FIXTURE_ACTORS.primary,
      reportRequest,
    );

    expect(totalReportCount(result)).toBe(5);
    expect(result.report.rows).toEqual(FIXTURE_REPORT.rows);
  });

  it("does not infer ownership from task, domain, excerpt, or conclusion prose", async () => {
    const source = ResponsibilitySourceContextSchema.parse({
      ...fixtureSourceContext(),
      signal: {
        ...FIXTURE_SHARED_SIGNAL,
        conclusion: "A changed neutral conclusion with no ownership claim.",
        redactedExcerpt: "A changed redacted excerpt.",
      },
    });
    const snapshot = ResponsibilityReportSnapshotSchema.parse({
      actorMember: fixtureMembers()[0],
      domains: [{ ...FIXTURE_DOMAIN, name: "Changed domain wording" }],
      members: fixtureMembers(),
      sources: [source],
      space: fixtureSourceContext().space,
      tasks: [
        {
          sourceSignalId: source.signal.id,
          task: { ...FIXTURE_TASK, title: "Changed task wording" },
        },
      ],
    });
    const harness = createHarness(source, snapshot);
    const result = await harness.service.getResponsibilityReport(
      FIXTURE_ACTORS.primary,
      reportRequest,
    );

    expect(result.report.rows).toEqual(FIXTURE_REPORT.rows);
    expect(result.report.narrative).toBe(FIXTURE_REPORT.narrative);
  });

  it("preserves prior authorized report facts after future analysis consent is revoked", async () => {
    const revokedSource = ResponsibilitySourceContextSchema.parse({
      ...fixtureSourceContext(),
      members: [
        fixtureMembers()[0],
        fixtureMembers()[1],
        { ...fixtureMembers()[2], analysisConsent: "revoked" },
      ],
      speaker: { ...fixtureMembers()[2], analysisConsent: "revoked" },
    });
    const harness = createHarness(
      revokedSource,
      snapshotWith(revokedSource),
    );
    const result = await harness.service.getResponsibilityReport(
      FIXTURE_ACTORS.primary,
      reportRequest,
    );

    expect(result.report.rows).toEqual(FIXTURE_REPORT.rows);
  });

  it("keeps every checked-in report template neutral", () => {
    const forbidden = /score|rank|blame|diagnos|懒惰|排名|评分|指责|诊断|不合格/iu;

    for (const template of Object.values(RESPONSIBILITY_REPORT_TEMPLATES)) {
      expect(template).not.toMatch(forbidden);
    }
  });

  it("rejects invalid report actors and spaces before loading a snapshot", async () => {
    const harness = createHarness();

    await expect(
      harness.service.getResponsibilityReport({ kind: "member" }, reportRequest),
    ).rejects.toSatisfy(expectCode("unauthenticated"));
    await expect(
      harness.service.getResponsibilityReport(FIXTURE_ACTORS.primary, {
        ...reportRequest,
        spaceId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("not_found"));
    expect(harness.loadReport).not.toHaveBeenCalled();
  });
});

describe("task attribution correction", () => {
  it("persists explicit five-stage changes with a content-free audit and replays exactly once", async () => {
    const correctionContext = AttributionCorrectionContextSchema.parse({
      actorMember: fixtureMembers()[0],
      domain: FIXTURE_DOMAIN,
      evidence: [FIXTURE_EVIDENCE],
      members: fixtureMembers(),
      space: fixtureSourceContext().space,
      task: FIXTURE_TASK,
    });
    let storedResult: CorrectTaskAttributionResult | undefined;
    let committedCommand: AttributionCorrectionCommand | undefined;
    const resolve = vi.fn<AttributionCorrectionPort["resolve"]>(() =>
      Promise.resolve(
        storedResult === undefined
          ? { status: "miss" }
          : { result: storedResult, status: "replay" },
      ),
    );
    const load = vi.fn<AttributionCorrectionPort["load"]>(() =>
      Promise.resolve(correctionContext),
    );
    const commit = vi.fn<AttributionCorrectionPort["commit"]>((command) => {
      committedCommand = command;
      storedResult = {
        auditEntryId: command.audit.id,
        status: "corrected",
        task: command.task,
      };
      return Promise.resolve({ result: storedResult, status: "committed" });
    });
    const correctionPort: AttributionCorrectionPort = { commit, load, resolve };
    const harness = createHarness();
    const service = createResponsibilityService({
      clock: FIXED_CLOCK,
      corrections: correctionPort,
      drafts: { draft: harness.draft },
      idGenerator: () => FIXTURE_IDS.audit,
      persistence: { create: harness.create },
      reports: { load: harness.loadReport },
      sources: { load: harness.loadSource },
    });
    const request = {
      attribution: {
        deadlineKeptBy: FIXTURE_IDS.primary,
        discoveredBy: FIXTURE_IDS.subject,
        executedBy: FIXTURE_IDS.primary,
        followedUpBy: FIXTURE_IDS.primary,
        scheduledBy: FIXTURE_IDS.primary,
      },
      expectedVersion: FIXTURE_TASK.version,
      idempotencyKey: "fixture-correction-0001",
      reason: "Confirmed by the family member who completed the task.",
      requestId: FIXTURE_IDS.request,
      taskId: FIXTURE_IDS.task,
    };

    const first = await service.correctTaskAttribution(
      FIXTURE_ACTORS.primary,
      request,
    );
    const replay = await service.correctTaskAttribution(
      FIXTURE_ACTORS.primary,
      request,
    );

    expect(first).toEqual(replay);
    expect(load).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedCommand?.task.executedBy).toBe(FIXTURE_IDS.primary);
    expect(committedCommand?.audit.changes).toEqual([
      {
        after: { kind: "id", value: FIXTURE_IDS.primary },
        before: { kind: "id", value: FIXTURE_IDS.partner },
        field: "executedBy",
      },
    ]);
    expect(JSON.stringify(committedCommand?.audit)).not.toContain(request.reason);
  });
});
