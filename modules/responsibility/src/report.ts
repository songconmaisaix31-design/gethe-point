import {
  ResponsibilityReportSchema,
  ResponsibilityStageSchema,
  type GetResponsibilityReportRequest,
  type Member,
  type MemberActor,
  type ResponsibilityReport,
  type ResponsibilityStage,
  type SharedSignal,
} from "../../../packages/contracts/src/index";

import type {
  PersistedEvidenceSnapshot,
  ReportSignalRecord,
  ReportTaskRecord,
  ResponsibilityReportContext,
} from "./model";
import { canMemberReadVisibility, hasUniqueIds } from "./visibility";

export const RESPONSIBILITY_STAGES = ResponsibilityStageSchema.options;

const HIDDEN_COORDINATION_STAGES = [
  "discoveredBy",
  "deadlineKeptBy",
  "scheduledBy",
  "followedUpBy",
] as const satisfies readonly ResponsibilityStage[];

export const RESPONSIBILITY_REPORT_TEMPLATES = Object.freeze({
  empty:
    "本周没有可纳入报告的已确认责任记录。仅讨论、证据缺失或待核对的内容未计入。",
  balanced:
    "本周家庭责任在发现、记住、安排、执行与跟进各阶段均有分担。",
  concentratedCoordination:
    "本周家庭协调工作集中在一位成员身上。虽然执行任务有所分担，但发现、安排与跟进仍未形成完整责任所有权。",
  uneven:
    "本周家庭责任在不同成员与工作阶段之间分布有所差异。报告仅呈现当前已确认记录。",
} as const);

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  hasUniqueIds(left) &&
  hasUniqueIds(right) &&
  left.every((id) => right.includes(id));

const allRecordsInSpace = (
  context: ResponsibilityReportContext,
  spaceId: string,
): boolean =>
  context.members.every((member) => member.spaceId === spaceId) &&
  context.domains.every((domain) => domain.spaceId === spaceId) &&
  context.tasks.every(({ task }) => task.spaceId === spaceId) &&
  context.signals.every(({ signal }) => signal.spaceId === spaceId) &&
  context.evidence.every((evidence) => evidence.spaceId === spaceId);

const contextIsSafe = (
  context: ResponsibilityReportContext,
  actor: MemberActor,
): boolean => {
  if (
    context.space.id !== actor.spaceId ||
    context.space.status !== "active" ||
    context.actorMember.id !== actor.memberId ||
    context.actorMember.spaceId !== actor.spaceId ||
    context.actorMember.role !== actor.role ||
    context.actorMember.status !== "active" ||
    !allRecordsInSpace(context, actor.spaceId)
  ) {
    return false;
  }

  const collections = [
    context.members,
    context.domains,
    context.tasks.map(({ task }) => task),
    context.signals.map(({ signal }) => signal),
    context.evidence,
  ];

  if (collections.some((records) => !hasUniqueIds(records.map(({ id }) => id)))) {
    return false;
  }

  const actorMember = context.members.find(({ id }) => id === actor.memberId);
  return (
    actorMember?.version === context.actorMember.version &&
    actorMember.status === "active"
  );
};

const provenanceMatchesEvidence = (
  signal: SharedSignal,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean => {
  const provenanceIds = signal.provenance.map(({ evidenceId }) => evidenceId);
  if (!hasUniqueIds(provenanceIds)) {
    return false;
  }

  return signal.provenance.every((provenance) => {
    const evidence = evidenceById.get(provenance.evidenceId);
    return (
      evidence?.state === "available" &&
      provenance.state === "available" &&
      signal.speakerId === provenance.speakerId &&
      provenance.speakerId === evidence.speakerId &&
      provenance.sourceType === evidence.sourceType &&
      provenance.occurredAt === evidence.occurredAt
    );
  });
};

const signalIsEligible = (
  record: ReportSignalRecord,
  actor: MemberActor,
  membersById: ReadonlyMap<string, Member>,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean => {
  const { signal, sourceKind } = record;
  const sourceMember = membersById.get(signal.speakerId);
  return (
    sourceKind === "potential_task" &&
    signal.purpose === "responsibility" &&
    signal.evidenceState === "available" &&
    canMemberReadVisibility(signal.visibility, actor.memberId) &&
    sourceMember?.status === "active" &&
    provenanceMatchesEvidence(signal, evidenceById)
  );
};

interface EligibilityResult {
  readonly eligible: boolean;
  readonly needsReviewExclusion: boolean;
}

const taskEligibility = (
  record: ReportTaskRecord,
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  membersById: ReadonlyMap<string, Member>,
  domainsById: ReadonlyMap<string, ResponsibilityReportContext["domains"][number]>,
  signalsById: ReadonlyMap<string, ReportSignalRecord>,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): EligibilityResult => {
  const { task } = record;
  const createdAt = Date.parse(task.createdAt);
  const inPeriod =
    createdAt >= Date.parse(request.period.startAt) &&
    createdAt < Date.parse(request.period.endAt);

  if (!inPeriod || task.status === "cancelled") {
    return { eligible: false, needsReviewExclusion: false };
  }

  if (task.reviewState === "needs_review") {
    return { eligible: false, needsReviewExclusion: true };
  }

  const domain = domainsById.get(task.domainId);
  if (
    domain?.status !== "active" ||
    !canMemberReadVisibility(task.visibility, actor.memberId) ||
    !canMemberReadVisibility(domain.visibility, actor.memberId)
  ) {
    return { eligible: false, needsReviewExclusion: false };
  }

  const taskEvidenceCurrent =
    hasUniqueIds(task.evidenceIds) &&
    task.evidenceIds.every(
      (evidenceId) => evidenceById.get(evidenceId)?.state === "available",
    );
  if (!taskEvidenceCurrent) {
    return { eligible: false, needsReviewExclusion: true };
  }

  const sourceSignals = record.sourceSignalIds.map((id) => signalsById.get(id));
  if (
    sourceSignals.some((recordValue) => recordValue === undefined) ||
    sourceSignals.some(
      (recordValue) =>
        recordValue !== undefined &&
        !signalIsEligible(recordValue, actor, membersById, evidenceById),
    )
  ) {
    const hasInvalidatedEvidence = sourceSignals.some(
      (recordValue) => recordValue?.signal.evidenceState === "evidence_missing",
    );
    return {
      eligible: false,
      needsReviewExclusion: hasInvalidatedEvidence,
    };
  }

  const sourceEvidenceIds = sourceSignals.flatMap((recordValue) =>
    recordValue === undefined
      ? []
      : recordValue.signal.provenance.map(({ evidenceId }) => evidenceId),
  );
  if (!sameIds(task.evidenceIds, sourceEvidenceIds)) {
    return { eligible: false, needsReviewExclusion: true };
  }

  const attributedMemberIds = RESPONSIBILITY_STAGES.flatMap((stage) => {
    const memberId = task[stage];
    return memberId === null ? [] : [memberId];
  });
  const attributionIsCurrent = attributedMemberIds.every(
    (memberId) => membersById.get(memberId)?.status === "active",
  );

  return {
    eligible: attributionIsCurrent,
    needsReviewExclusion: false,
  };
};

const reportNarrative = (
  counts: ReadonlyMap<ResponsibilityStage, ReadonlyMap<string, number>>,
  memberIds: readonly string[],
): string => {
  const total = RESPONSIBILITY_STAGES.reduce(
    (sum, stage) =>
      sum +
      memberIds.reduce(
        (stageSum, memberId) =>
          stageSum + (counts.get(stage)?.get(memberId) ?? 0),
        0,
      ),
    0,
  );
  if (total === 0) {
    return RESPONSIBILITY_REPORT_TEMPLATES.empty;
  }

  const hiddenByMember = new Map(
    memberIds.map((memberId) => [
      memberId,
      HIDDEN_COORDINATION_STAGES.reduce(
        (sum, stage) => sum + (counts.get(stage)?.get(memberId) ?? 0),
        0,
      ),
    ]),
  );
  const hiddenTotal = [...hiddenByMember.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const coordinationOwner = memberIds.find(
    (memberId) => hiddenByMember.get(memberId) === hiddenTotal,
  );
  const executionShared =
    coordinationOwner !== undefined &&
    memberIds.some(
      (memberId) =>
        memberId !== coordinationOwner &&
        (counts.get("executedBy")?.get(memberId) ?? 0) > 0,
    );
  if (hiddenTotal > 0 && coordinationOwner !== undefined && executionShared) {
    return RESPONSIBILITY_REPORT_TEMPLATES.concentratedCoordination;
  }

  const participatingTotals = memberIds
    .map((memberId) =>
      RESPONSIBILITY_STAGES.reduce(
        (sum, stage) => sum + (counts.get(stage)?.get(memberId) ?? 0),
        0,
      ),
    )
    .filter((count) => count > 0);
  const balanced =
    participatingTotals.length > 1 &&
    Math.max(...participatingTotals) - Math.min(...participatingTotals) <= 1;

  return balanced
    ? RESPONSIBILITY_REPORT_TEMPLATES.balanced
    : RESPONSIBILITY_REPORT_TEMPLATES.uneven;
};

export const createResponsibilityReport = (
  context: ResponsibilityReportContext,
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  generatedAt: string,
): ResponsibilityReport | undefined => {
  if (!contextIsSafe(context, actor)) {
    return undefined;
  }

  const activeMembers = context.members
    .filter(({ status }) => status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const memberIds = activeMembers.map(({ id }) => id);
  const membersById = new Map(context.members.map((member) => [member.id, member]));
  const domainsById = new Map(
    context.domains.map((domain) => [domain.id, domain]),
  );
  const signalsById = new Map(
    context.signals.map((record) => [record.signal.id, record]),
  );
  const evidenceById = new Map(
    context.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const counts = new Map<ResponsibilityStage, Map<string, number>>(
    RESPONSIBILITY_STAGES.map((stage) => [
      stage,
      new Map(memberIds.map((memberId) => [memberId, 0])),
    ]),
  );

  let excludedNeedsReviewCount = 0;
  for (const record of context.tasks) {
    const eligibility = taskEligibility(
      record,
      actor,
      request,
      membersById,
      domainsById,
      signalsById,
      evidenceById,
    );
    if (!eligibility.eligible) {
      if (eligibility.needsReviewExclusion) {
        excludedNeedsReviewCount += 1;
      }
      continue;
    }

    for (const stage of RESPONSIBILITY_STAGES) {
      const memberId = record.task[stage];
      if (memberId !== null) {
        const stageCounts = counts.get(stage);
        const previous = stageCounts?.get(memberId);
        if (stageCounts !== undefined && previous !== undefined) {
          stageCounts.set(memberId, previous + 1);
        }
      }
    }
  }

  const unownedDomainCount = context.domains.filter((domain) => {
    const evidenceCurrent =
      hasUniqueIds(domain.evidenceIds) &&
      domain.evidenceIds.every(
        (evidenceId) => evidenceById.get(evidenceId)?.state === "available",
      );
    return (
      domain.ownerId === null &&
      domain.status === "active" &&
      canMemberReadVisibility(domain.visibility, actor.memberId) &&
      evidenceCurrent
    );
  }).length;

  return ResponsibilityReportSchema.parse({
    spaceId: actor.spaceId,
    period: request.period,
    generatedAt,
    rows: RESPONSIBILITY_STAGES.map((stage) => ({
      stage,
      counts: memberIds.map((memberId) => ({
        memberId,
        count: counts.get(stage)?.get(memberId) ?? 0,
      })),
    })),
    unownedDomainCount,
    excludedNeedsReviewCount,
    narrative: reportNarrative(counts, memberIds),
    source: "deterministic_template",
  });
};
