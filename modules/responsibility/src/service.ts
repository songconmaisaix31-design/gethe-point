import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AuditEntrySchema,
  CorrectTaskAttributionRequestSchema,
  EntityIdSchema,
  GetResponsibilityReportRequestSchema,
  GetResponsibilityReportResultSchema,
  MemberActorSchema,
  ResponsibilityReportSchema,
  ResponsibilityStageSchema,
  TaskSchema,
  type AuditEntry,
  type Clock,
  type CorrectTaskAttributionRequest,
  type CorrectTaskAttributionResult,
  type GetResponsibilityReportRequest,
  type GetResponsibilityReportResult,
  type Member,
  type MemberActor,
  type ResponsibilityAttribution,
  type ResponsibilityReport,
  type ResponsibilityStage,
  type SharedVisibility,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  AttributionCorrectionContextSchema,
  AttributionCorrectionGuardSchema,
  ResponsibilityReportContextSchema,
  type AttributionCorrectionContext,
  type AttributionCorrectionGuard,
  type PersistedEvidenceSnapshot,
  type ReportSignalRecord,
  type ResponsibilityReportContext,
  type VersionGuardEntry,
} from "./model";
import { canMemberReadVisibility } from "./visibility";

export const RESPONSIBILITY_STAGES = ResponsibilityStageSchema.options;

export const RESPONSIBILITY_REPORT_TEMPLATES = Object.freeze({
  empty:
    "本期没有可纳入的责任记录；待核对、仅讨论或证据缺失的内容未计入。",
  oneMember:
    "本期已确认的责任记录主要由一位成员承担；这仅描述当前记录，不代表评价。",
  shared:
    "本期已确认的责任记录由多位成员共同承担；报告仅呈现五个责任阶段的客观记录。",
} as const);

export type ResponsibilityFailureCode =
  | "invalid_request"
  | "unauthenticated"
  | "not_found"
  | "conflict"
  | "stale_version"
  | "evidence_missing"
  | "idempotency_conflict"
  | "internal_failure";

export interface ResponsibilityFailure {
  readonly code: ResponsibilityFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ResponsibilityResult<Result> =
  | Readonly<{ ok: true; result: Result }>
  | Readonly<{ ok: false; error: ResponsibilityFailure }>;

const SAFE_MESSAGES: Readonly<Record<ResponsibilityFailureCode, string>> = {
  invalid_request: "The responsibility request is invalid.",
  unauthenticated: "A valid member actor is required.",
  not_found: "The requested responsibility record is unavailable.",
  conflict: "The requested responsibility change conflicts with current state.",
  stale_version: "The responsibility record changed before the operation completed.",
  evidence_missing: "Current evidence is required for this responsibility operation.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  internal_failure: "The responsibility operation failed.",
};

const fail = <Result>(
  code: ResponsibilityFailureCode,
): ResponsibilityResult<Result> => ({
  ok: false,
  error: {
    code,
    message: SAFE_MESSAGES[code],
    retryable: code === "internal_failure",
  },
});

const CommitCorrectionFailureSchema = z.strictObject({
  status: z.enum([
    "not_found",
    "forbidden",
    "stale_version",
    "evidence_missing",
    "idempotency_conflict",
    "conflict",
  ]),
});

const CommitCorrectionSuccessSchema = z.strictObject({
  status: z.enum(["corrected", "replayed"]),
  task: TaskSchema,
  auditEntryId: EntityIdSchema,
});

const CommitCorrectionResultSchema = z.discriminatedUnion("status", [
  CommitCorrectionSuccessSchema,
  CommitCorrectionFailureSchema,
]);

export interface LoadAttributionCorrectionInput {
  readonly actor: MemberActor;
  readonly taskId: string;
}

export interface CommitAttributionCorrectionInput {
  readonly actor: MemberActor;
  readonly request: Readonly<
    Pick<
      CorrectTaskAttributionRequest,
      | "requestId"
      | "idempotencyKey"
      | "taskId"
      | "attribution"
      | "expectedVersion"
    >
  >;
  readonly requestHash: string;
  readonly guard: AttributionCorrectionGuard;
  readonly auditEntry: AuditEntry;
}

export interface LoadResponsibilityReportInput {
  readonly actor: MemberActor;
  readonly request: GetResponsibilityReportRequest;
}

/**
 * Implementations must apply the guard and correction in one transaction. A
 * failed guard may not update the task, audit log, or idempotency record.
 */
export interface ResponsibilityRepository {
  loadAttributionCorrectionContext(
    input: LoadAttributionCorrectionInput,
  ): Promise<unknown>;
  commitAttributionCorrection(
    input: CommitAttributionCorrectionInput,
  ): Promise<unknown>;
  loadResponsibilityReportContext(
    input: LoadResponsibilityReportInput,
  ): Promise<unknown>;
}

export interface ResponsibilityServiceDependencies {
  readonly repository: ResponsibilityRepository;
  readonly clock: Clock;
  readonly createId?: () => string;
}

const uniqueById = (
  values: readonly Readonly<{ id: string }>[],
): boolean => new Set(values.map(({ id }) => id)).size === values.length;

const sameIds = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};

const allInSpace = (
  spaceId: string,
  values: readonly Readonly<{ spaceId: string }>[],
): boolean => values.every((value) => value.spaceId === spaceId);

const actorIsCurrent = (
  actor: MemberActor,
  spaceStatus: "active" | "deleting",
  member: Member,
): boolean =>
  spaceStatus === "active" &&
  member.id === actor.memberId &&
  member.spaceId === actor.spaceId &&
  member.status === "active" &&
  member.role === actor.role;

const activeMemberIds = (members: readonly Member[]): ReadonlySet<string> =>
  new Set(
    members
      .filter(({ status }) => status === "active")
      .map(({ id }) => id),
  );

const attributionValues = (
  attribution: ResponsibilityAttribution,
): readonly (string | null)[] =>
  RESPONSIBILITY_STAGES.map((stage) => attribution[stage]);

const taskAttribution = (task: Task): ResponsibilityAttribution => ({
  discoveredBy: task.discoveredBy,
  deadlineKeptBy: task.deadlineKeptBy,
  scheduledBy: task.scheduledBy,
  executedBy: task.executedBy,
  followedUpBy: task.followedUpBy,
});

const hasOnlyActiveAttributionMembers = (
  attribution: ResponsibilityAttribution,
  members: readonly Member[],
): boolean => {
  const allowedIds = activeMemberIds(members);
  return attributionValues(attribution).every(
    (memberId) => memberId === null || allowedIds.has(memberId),
  );
};

const visibilityIsReadable = (
  actor: MemberActor,
  recordSpaceId: string,
  visibility: SharedVisibility,
): boolean =>
  recordSpaceId === actor.spaceId && canMemberReadVisibility(actor, visibility);

const parseCorrectionContext = (
  rawContext: unknown,
  actor: MemberActor,
  request: CorrectTaskAttributionRequest,
):
  | Readonly<{ ok: true; context: AttributionCorrectionContext }>
  | Readonly<{ ok: false; code: ResponsibilityFailureCode }> => {
  const parsed = AttributionCorrectionContextSchema.safeParse(rawContext);

  if (!parsed.success) {
    return { ok: false, code: "internal_failure" };
  }

  const context = parsed.data;
  const { domain, evidence, members, space, task } = context;
  if (
    space.id !== actor.spaceId ||
    !actorIsCurrent(actor, space.status, context.actorMember) ||
    !uniqueById(members) ||
    !allInSpace(actor.spaceId, [context.actorMember, domain, task, ...members, ...evidence]) ||
    !members.some(({ id }) => id === actor.memberId)
  ) {
    return { ok: false, code: "not_found" };
  }

  if (
    task.id !== request.taskId ||
    task.domainId !== domain.id ||
    domain.status !== "active" ||
    task.reviewState !== "current" ||
    !visibilityIsReadable(actor, task.spaceId, task.visibility) ||
    !visibilityIsReadable(actor, domain.spaceId, domain.visibility)
  ) {
    return { ok: false, code: "not_found" };
  }

  if (task.version !== request.expectedVersion) {
    return { ok: false, code: "stale_version" };
  }

  if (
    !uniqueById(evidence) ||
    !sameIds(
      task.evidenceIds,
      evidence.map(({ id }) => id),
    ) ||
    evidence.some(({ state }) => state !== "available")
  ) {
    return { ok: false, code: "evidence_missing" };
  }

  if (!hasOnlyActiveAttributionMembers(request.attribution, members)) {
    return { ok: false, code: "not_found" };
  }

  return { ok: true, context };
};

const versionEntry = (record: Readonly<{ id: string; version: number }>): VersionGuardEntry => ({
  id: record.id,
  version: record.version,
});

const sortedVersionEntries = (
  records: readonly Readonly<{ id: string; version: number }>[],
): readonly VersionGuardEntry[] =>
  records
    .map(versionEntry)
    .sort((left, right) => left.id.localeCompare(right.id));

const correctionGuard = (
  context: AttributionCorrectionContext,
): AttributionCorrectionGuard =>
  AttributionCorrectionGuardSchema.parse({
    space: versionEntry(context.space),
    actorMember: versionEntry(context.actorMember),
    domain: versionEntry(context.domain),
    task: versionEntry(context.task),
    members: sortedVersionEntries(context.members),
    evidence: sortedVersionEntries(context.evidence),
  });

const changedStages = (
  before: ResponsibilityAttribution,
  after: ResponsibilityAttribution,
): readonly ResponsibilityStage[] =>
  RESPONSIBILITY_STAGES.filter((stage) => before[stage] !== after[stage]);

const actorRef = (actor: MemberActor) => ({
  kind: actor.kind,
  memberId: actor.memberId,
  spaceId: actor.spaceId,
  role: actor.role,
}) as const;

const createCorrectionAudit = (
  id: string,
  actor: MemberActor,
  task: Task,
  attribution: ResponsibilityAttribution,
  occurredAt: string,
): AuditEntry => {
  const before = taskAttribution(task);
  const changes = changedStages(before, attribution).map((field) => ({
    field,
    before: { kind: "id" as const, value: before[field] },
    after: { kind: "id" as const, value: attribution[field] },
  }));

  return AuditEntrySchema.parse({
    id,
    spaceId: task.spaceId,
    actor: actorRef(actor),
    action: "task_attribution_corrected",
    targetType: "task",
    targetId: task.id,
    beforeVersion: task.version,
    afterVersion: task.version + 1,
    changes,
    visibility: task.visibility,
    occurredAt,
    retention: "until_space_deleted",
  });
};

const requestHash = (
  actor: MemberActor,
  request: CorrectTaskAttributionRequest,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        actor: actorRef(actor),
        taskId: request.taskId,
        attribution: request.attribution,
        reason: request.reason,
        expectedVersion: request.expectedVersion,
      }),
    )
    .digest("hex");

const mapCommitFailure = (
  status: z.infer<typeof CommitCorrectionFailureSchema>["status"],
): ResponsibilityFailureCode => {
  switch (status) {
    case "forbidden":
    case "not_found":
      return "not_found";
    case "conflict":
    case "evidence_missing":
    case "idempotency_conflict":
    case "stale_version":
      return status;
  }
};

const correctedTaskMatches = (
  task: Task,
  request: CorrectTaskAttributionRequest,
): boolean =>
  task.id === request.taskId &&
  task.version === request.expectedVersion + 1 &&
  RESPONSIBILITY_STAGES.every(
    (stage) => task[stage] === request.attribution[stage],
  );

const withinPeriod = (
  timestamp: string,
  period: GetResponsibilityReportRequest["period"],
): boolean => {
  const observedAt = Date.parse(timestamp);
  return observedAt >= Date.parse(period.startAt) && observedAt < Date.parse(period.endAt);
};

const evidenceIsAvailable = (
  evidenceIds: readonly string[],
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean =>
  evidenceIds.length > 0 &&
  evidenceIds.every((id) => evidenceById.get(id)?.state === "available");

const signalEvidenceIsAvailable = (
  record: ReportSignalRecord,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean =>
  record.signal.evidenceState === "available" &&
  record.signal.provenance.every(
    ({ evidenceId, state }) =>
      state === "available" && evidenceById.get(evidenceId)?.state === "available",
  );

const signalCanSupportReport = (
  actor: MemberActor,
  record: ReportSignalRecord,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean =>
  record.sourceKind === "potential_task" &&
  record.signal.purpose === "responsibility" &&
  visibilityIsReadable(actor, record.signal.spaceId, record.signal.visibility) &&
  signalEvidenceIsAvailable(record, evidenceById);

const signalIsAuthorizedResponsibilityFact = (
  actor: MemberActor,
  record: ReportSignalRecord,
): boolean =>
  record.sourceKind === "potential_task" &&
  record.signal.purpose === "responsibility" &&
  visibilityIsReadable(actor, record.signal.spaceId, record.signal.visibility);

const linkedSignals = (
  taskId: string,
  signals: readonly ReportSignalRecord[],
): readonly ReportSignalRecord[] =>
  signals.filter(({ taskIds }) => taskIds.includes(taskId));

const linkedDomainSignals = (
  domainId: string,
  signals: readonly ReportSignalRecord[],
): readonly ReportSignalRecord[] =>
  signals.filter(({ domainIds }) => domainIds.includes(domainId));

const contextShapeIsSafe = (
  context: ResponsibilityReportContext,
  actor: MemberActor,
): boolean => {
  const scopedRecords = [
    context.actorMember,
    ...context.members,
    ...context.domains,
    ...context.tasks,
    ...context.signals.map(({ signal }) => signal),
    ...context.evidence,
  ];

  return (
    context.space.id === actor.spaceId &&
    actorIsCurrent(actor, context.space.status, context.actorMember) &&
    allInSpace(actor.spaceId, scopedRecords) &&
    uniqueById(context.members) &&
    uniqueById(context.domains) &&
    uniqueById(context.tasks) &&
    uniqueById(context.signals.map(({ signal }) => signal)) &&
    uniqueById(context.evidence) &&
    context.members.some(({ id }) => id === actor.memberId)
  );
};

const selectNarrative = (
  memberTotals: ReadonlyMap<string, number>,
): string => {
  const total = [...memberTotals.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  if (total === 0) {
    return RESPONSIBILITY_REPORT_TEMPLATES.empty;
  }

  const participatingMembers = [...memberTotals.values()].filter(
    (count) => count > 0,
  ).length;
  return participatingMembers === 1
    ? RESPONSIBILITY_REPORT_TEMPLATES.oneMember
    : RESPONSIBILITY_REPORT_TEMPLATES.shared;
};

const buildReport = (
  context: ResponsibilityReportContext,
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  generatedAt: string,
): ResponsibilityReport => {
  const members = context.members
    .filter(({ status }) => status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const memberIds = new Set(members.map(({ id }) => id));
  const domainById = new Map(context.domains.map((domain) => [domain.id, domain]));
  const evidenceById = new Map(
    context.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const counts = new Map<ResponsibilityStage, Map<string, number>>(
    RESPONSIBILITY_STAGES.map((stage) => [
      stage,
      new Map(members.map(({ id }) => [id, 0])),
    ]),
  );
  let excludedNeedsReviewCount = 0;

  for (const task of context.tasks) {
    const domain = domainById.get(task.domainId);
    const isVisible =
      domain !== undefined &&
      visibilityIsReadable(actor, task.spaceId, task.visibility) &&
      visibilityIsReadable(actor, domain.spaceId, domain.visibility);
    if (
      !isVisible ||
      task.status === "cancelled" ||
      !withinPeriod(task.updatedAt, request.period)
    ) {
      continue;
    }

    const sources = linkedSignals(task.id, context.signals);
    const hasAuthorizedResponsibilitySignal = sources.some((signal) =>
      signalIsAuthorizedResponsibilityFact(actor, signal),
    );
    const hasEligibleSignal = sources.some((signal) =>
      signalCanSupportReport(actor, signal, evidenceById),
    );
    const hasReviewIssue =
      task.reviewState === "needs_review" ||
      domain.status === "needs_review" ||
      !evidenceIsAvailable(task.evidenceIds, evidenceById) ||
      sources.some(
        (signal) =>
          signal.sourceKind === "potential_task" &&
          !signalEvidenceIsAvailable(signal, evidenceById),
      ) ||
      !hasOnlyActiveAttributionMembers(taskAttribution(task), members);

    if (hasReviewIssue && hasAuthorizedResponsibilitySignal) {
      excludedNeedsReviewCount += 1;
      continue;
    }

    if (domain.status !== "active" || !hasEligibleSignal) {
      continue;
    }

    for (const stage of RESPONSIBILITY_STAGES) {
      const memberId = task[stage];
      if (memberId === null || !memberIds.has(memberId)) {
        continue;
      }

      const stageCounts = counts.get(stage);
      if (stageCounts !== undefined) {
        stageCounts.set(memberId, (stageCounts.get(memberId) ?? 0) + 1);
      }
    }
  }

  const rows = RESPONSIBILITY_STAGES.map((stage) => ({
    stage,
    counts: members.map(({ id }) => ({
      memberId: id,
      count: counts.get(stage)?.get(id) ?? 0,
    })),
  }));
  const memberTotals = new Map(
    members.map(({ id }) => [
      id,
      RESPONSIBILITY_STAGES.reduce(
        (total, stage) => total + (counts.get(stage)?.get(id) ?? 0),
        0,
      ),
    ]),
  );
  const unownedDomainCount = context.domains.filter((domain) => {
    if (
      domain.ownerId !== null ||
      domain.status !== "active" ||
      !withinPeriod(domain.updatedAt, request.period) ||
      !visibilityIsReadable(actor, domain.spaceId, domain.visibility) ||
      !evidenceIsAvailable(domain.evidenceIds, evidenceById)
    ) {
      return false;
    }

    return linkedDomainSignals(domain.id, context.signals).some((signal) =>
      signalCanSupportReport(actor, signal, evidenceById),
    );
  }).length;

  return ResponsibilityReportSchema.parse({
    spaceId: request.spaceId,
    period: request.period,
    generatedAt,
    rows,
    unownedDomainCount,
    excludedNeedsReviewCount,
    narrative: selectNarrative(memberTotals),
    source: "deterministic_template",
  });
};

/**
 * Creates the fail-closed correction and report boundary. All repository values
 * are parsed again because persistence adapters are outside this trust boundary.
 */
export const createResponsibilityService = (
  dependencies: ResponsibilityServiceDependencies,
) => {
  const createId = dependencies.createId ?? randomUUID;

  const correctTaskAttribution = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<ResponsibilityResult<CorrectTaskAttributionResult>> => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }

    const requestResult = CorrectTaskAttributionRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }

    const actor = actorResult.data;
    const request = requestResult.data;
    let rawContext: unknown;
    try {
      rawContext = await dependencies.repository.loadAttributionCorrectionContext({
        actor,
        taskId: request.taskId,
      });
    } catch {
      return fail("internal_failure");
    }

    const contextResult = parseCorrectionContext(rawContext, actor, request);
    if (!contextResult.ok) {
      return fail(contextResult.code);
    }

    const currentAttribution = taskAttribution(contextResult.context.task);
    if (changedStages(currentAttribution, request.attribution).length === 0) {
      return fail("conflict");
    }

    const auditEntryId = createId();
    if (!EntityIdSchema.safeParse(auditEntryId).success) {
      return fail("internal_failure");
    }

    let occurredAt: string;
    try {
      occurredAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }

    const auditEntry = createCorrectionAudit(
      auditEntryId,
      actor,
      contextResult.context.task,
      request.attribution,
      occurredAt,
    );

    let rawCommitResult: unknown;
    try {
      rawCommitResult = await dependencies.repository.commitAttributionCorrection({
        actor,
        request: {
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          taskId: request.taskId,
          attribution: request.attribution,
          expectedVersion: request.expectedVersion,
        },
        requestHash: requestHash(actor, request),
        guard: correctionGuard(contextResult.context),
        auditEntry,
      });
    } catch {
      return fail("internal_failure");
    }

    const commitResult = CommitCorrectionResultSchema.safeParse(rawCommitResult);
    if (!commitResult.success) {
      return fail("internal_failure");
    }

    if (
      commitResult.data.status !== "corrected" &&
      commitResult.data.status !== "replayed"
    ) {
      return fail(mapCommitFailure(commitResult.data.status));
    }

    if (
      commitResult.data.auditEntryId !== auditEntryId ||
      !correctedTaskMatches(commitResult.data.task, request)
    ) {
      return fail("internal_failure");
    }

    return {
      ok: true,
      result: {
        status: "corrected",
        task: commitResult.data.task,
        auditEntryId: commitResult.data.auditEntryId,
      },
    };
  };

  const getResponsibilityReport = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<ResponsibilityResult<GetResponsibilityReportResult>> => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }

    const requestResult = GetResponsibilityReportRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }

    const actor = actorResult.data;
    const request = requestResult.data;
    if (actor.spaceId !== request.spaceId) {
      return fail("not_found");
    }

    let rawContext: unknown;
    try {
      rawContext = await dependencies.repository.loadResponsibilityReportContext({
        actor,
        request,
      });
    } catch {
      return fail("internal_failure");
    }

    const contextResult = ResponsibilityReportContextSchema.safeParse(rawContext);
    if (!contextResult.success) {
      return fail("internal_failure");
    }

    if (!contextShapeIsSafe(contextResult.data, actor)) {
      return fail("not_found");
    }

    let generatedAt: string;
    try {
      generatedAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }

    const result = GetResponsibilityReportResultSchema.safeParse({
      status: "ready",
      report: buildReport(contextResult.data, actor, request, generatedAt),
    });

    return result.success
      ? { ok: true, result: result.data }
      : fail("internal_failure");
  };

  return Object.freeze({
    correctTaskAttribution,
    getResponsibilityReport,
  });
};
