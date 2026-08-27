import {
  GetResponsibilityReportResultSchema,
  ResponsibilityStageSchema,
  TimestampSchema,
  type Domain,
  type EntityId,
  type GetResponsibilityReportRequest,
  type GetResponsibilityReportResult,
  type Member,
  type MemberActor,
  type ResponsibilityStage,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  attributionUsesActiveMembers,
  domainAndTaskMatchSource,
  taskAttribution,
  validateActorAndSpace,
  validateResponsibilitySource,
} from "./eligibility";
import {
  createResponsibilityError,
  isResponsibilityError,
} from "./errors";
import type {
  ResponsibilityReportSnapshot,
  ResponsibilitySourceContext,
} from "./model";
import {
  canReadSharedVisibility,
  doesNotWidenVisibility,
} from "./visibility";

export const RESPONSIBILITY_STAGES = ResponsibilityStageSchema.options;

export const RESPONSIBILITY_REPORT_TEMPLATES = Object.freeze({
  concentrated:
    "本周家庭协调工作集中在一位成员身上，执行已有分担，责任交接仍需完整确认。",
  distributed:
    "本期责任阶段由多位成员共同承担，以上仅呈现已确认的责任记录。",
  empty: "本期暂无可计入的责任记录。",
  mixed:
    "本期各阶段责任分布不完全相同，以上仅呈现已确认的责任记录。",
} as const);

type Identified = Readonly<{ id: EntityId }>;

const uniqueById = <Value extends Identified>(
  values: readonly Value[],
): ReadonlyMap<EntityId, Value> => {
  const unique = new Map<EntityId, Value>();

  for (const value of values) {
    const previous = unique.get(value.id);

    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) {
      throw createResponsibilityError("internal_failure");
    }

    unique.set(value.id, value);
  }

  return unique;
};

const uniqueSources = (
  values: readonly ResponsibilitySourceContext[],
): ReadonlyMap<EntityId, ResponsibilitySourceContext> => {
  const unique = new Map<EntityId, ResponsibilitySourceContext>();

  for (const value of values) {
    const previous = unique.get(value.signal.id);

    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(value)) {
      throw createResponsibilityError("internal_failure");
    }

    unique.set(value.signal.id, value);
  }

  return unique;
};

const inPeriod = (
  timestamp: string,
  request: GetResponsibilityReportRequest,
): boolean => {
  const value = Date.parse(timestamp);

  return (
    value >= Date.parse(request.period.startAt) &&
    value < Date.parse(request.period.endAt)
  );
};

const eligibleSources = (
  actor: MemberActor,
  snapshot: ResponsibilityReportSnapshot,
  generatedAt: string,
): ReadonlyMap<EntityId, ResponsibilitySourceContext> => {
  const eligible = new Map<EntityId, ResponsibilitySourceContext>();

  for (const [signalId, source] of uniqueSources(snapshot.sources)) {
    try {
      validateResponsibilitySource(actor, source, new Date(generatedAt));
      eligible.set(signalId, source);
    } catch (error) {
      if (!isResponsibilityError(error)) {
        throw error;
      }
    }
  }

  return eligible;
};

const taskIsVisibleAndCurrent = (
  actor: MemberActor,
  members: readonly Member[],
  domain: Domain,
  task: Task,
): boolean =>
  domain.status === "active" &&
  task.status !== "cancelled" &&
  task.reviewState === "current" &&
  canReadSharedVisibility(actor.memberId, domain.visibility, members) &&
  canReadSharedVisibility(actor.memberId, task.visibility, members);

const eligibleTasks = (
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  snapshot: ResponsibilityReportSnapshot,
  domains: ReadonlyMap<EntityId, Domain>,
  sources: ReadonlyMap<EntityId, ResponsibilitySourceContext>,
): readonly Task[] => {
  const records = new Map<EntityId, (typeof snapshot.tasks)[number]>();

  for (const record of snapshot.tasks) {
    const previous = records.get(record.task.id);

    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw createResponsibilityError("internal_failure");
    }

    records.set(record.task.id, record);
  }

  return [...records.values()]
    .filter(({ sourceSignalId, task }) => {
      const domain = domains.get(task.domainId);
      const source = sources.get(sourceSignalId);

      return (
        domain !== undefined &&
        source !== undefined &&
        task.spaceId === actor.spaceId &&
        inPeriod(task.createdAt, request) &&
        taskIsVisibleAndCurrent(actor, snapshot.members, domain, task) &&
        domainAndTaskMatchSource(domain, task, source) &&
        doesNotWidenVisibility(
          domain.visibility,
          source.signal.visibility,
          snapshot.members,
        ) &&
        doesNotWidenVisibility(
          task.visibility,
          source.signal.visibility,
          snapshot.members,
        ) &&
        attributionUsesActiveMembers(
          taskAttribution(task),
          snapshot.members,
          actor.spaceId,
        )
      );
    })
    .map(({ task }) => task);
};

const activeReportMembers = (
  actor: MemberActor,
  members: readonly Member[],
): readonly Member[] => {
  const active = [...uniqueById(members).values()]
    .filter(
      ({ spaceId, status }) =>
        spaceId === actor.spaceId && status === "active",
    )
    .sort(({ id: left }, { id: right }) => left.localeCompare(right));

  if (!active.some(({ id }) => id === actor.memberId)) {
    throw createResponsibilityError("forbidden");
  }

  return active;
};

const stageOwner = (task: Task, stage: ResponsibilityStage): EntityId | null =>
  task[stage];

const rows = (
  tasks: readonly Task[],
  members: readonly Member[],
) =>
  RESPONSIBILITY_STAGES.map((stage) => {
    const counts = new Map<EntityId, number>(
      members.map(({ id }) => [id, 0] as const),
    );

    for (const task of tasks) {
      const ownerId = stageOwner(task, stage);

      if (ownerId !== null && counts.has(ownerId)) {
        counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
      }
    }

    const nonzeroCounts = [...counts]
      .filter(([, count]) => count > 0)
      .sort(
        ([leftId, leftCount], [rightId, rightCount]) =>
          rightCount - leftCount || leftId.localeCompare(rightId),
      )
      .map(([memberId, count]) => ({ count, memberId }));

    return {
      counts:
        nonzeroCounts.length > 0
          ? nonzeroCounts
          : [{ count: 0, memberId: members[0]?.id }],
      stage,
    };
  });

const narrativeFor = (tasks: readonly Task[]): string => {
  const allOwners = RESPONSIBILITY_STAGES.flatMap((stage) =>
    tasks
      .map((task) => stageOwner(task, stage))
      .filter((ownerId): ownerId is EntityId => ownerId !== null),
  );

  if (allOwners.length === 0) {
    return RESPONSIBILITY_REPORT_TEMPLATES.empty;
  }

  const hiddenStages = RESPONSIBILITY_STAGES.filter(
    (stage) => stage !== "executedBy",
  );
  const hiddenOwners = hiddenStages.flatMap((stage) =>
    tasks
      .map((task) => stageOwner(task, stage))
      .filter((ownerId): ownerId is EntityId => ownerId !== null),
  );
  const hiddenCounts = new Map<EntityId, number>();

  for (const ownerId of hiddenOwners) {
    hiddenCounts.set(ownerId, (hiddenCounts.get(ownerId) ?? 0) + 1);
  }

  const concentratedEntry = [...hiddenCounts].sort(
    ([leftId, leftCount], [rightId, rightCount]) =>
      rightCount - leftCount || leftId.localeCompare(rightId),
  )[0];
  const executionOwners = new Set(
    tasks
      .map(({ executedBy }) => executedBy)
      .filter((ownerId): ownerId is EntityId => ownerId !== null),
  );

  if (
    concentratedEntry !== undefined &&
    concentratedEntry[1] * 2 > hiddenOwners.length &&
    [...executionOwners].some((ownerId) => ownerId !== concentratedEntry[0])
  ) {
    return RESPONSIBILITY_REPORT_TEMPLATES.concentrated;
  }

  const ownerCounts = new Map<EntityId, number>();

  for (const ownerId of allOwners) {
    ownerCounts.set(ownerId, (ownerCounts.get(ownerId) ?? 0) + 1);
  }

  const totals = [...ownerCounts.values()];
  const maximum = Math.max(...totals);
  const minimum = Math.min(...totals);

  return maximum - minimum <= 1
    ? RESPONSIBILITY_REPORT_TEMPLATES.distributed
    : RESPONSIBILITY_REPORT_TEMPLATES.mixed;
};

const excludedNeedsReviewCount = (
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  snapshot: ResponsibilityReportSnapshot,
  domains: ReadonlyMap<EntityId, Domain>,
): number =>
  [...new Map(snapshot.tasks.map(({ task }) => [task.id, task] as const)).values()]
    .filter((task) => {
      const domain = domains.get(task.domainId);

      return (
        domain !== undefined &&
        task.spaceId === actor.spaceId &&
        inPeriod(task.createdAt, request) &&
        (task.reviewState === "needs_review" ||
          domain.status === "needs_review") &&
        canReadSharedVisibility(actor.memberId, task.visibility, snapshot.members) &&
        canReadSharedVisibility(
          actor.memberId,
          domain.visibility,
          snapshot.members,
        )
      );
    }).length;

const unownedDomainCount = (
  actor: MemberActor,
  snapshot: ResponsibilityReportSnapshot,
  domains: ReadonlyMap<EntityId, Domain>,
  sources: ReadonlyMap<EntityId, ResponsibilitySourceContext>,
): number => {
  const eligibleEvidenceIds = new Set(
    [...sources.values()].flatMap(({ evidence }) =>
      evidence.map(({ id }) => id),
    ),
  );

  return [...domains.values()].filter(
    (domain) =>
      domain.spaceId === actor.spaceId &&
      domain.status === "active" &&
      domain.ownerId === null &&
      canReadSharedVisibility(
        actor.memberId,
        domain.visibility,
        snapshot.members,
      ) &&
      domain.evidenceIds.length > 0 &&
      domain.evidenceIds.every((id) => eligibleEvidenceIds.has(id)),
  ).length;
};

export const createResponsibilityReport = (
  actor: MemberActor,
  request: GetResponsibilityReportRequest,
  snapshot: ResponsibilityReportSnapshot,
  generatedAtInput: string,
): GetResponsibilityReportResult => {
  validateActorAndSpace(actor, snapshot);

  if (request.spaceId !== actor.spaceId) {
    throw createResponsibilityError("not_found");
  }

  const generatedAt = TimestampSchema.safeParse(generatedAtInput);

  if (!generatedAt.success) {
    throw createResponsibilityError("internal_failure");
  }

  const members = activeReportMembers(actor, snapshot.members);
  const domains = uniqueById(snapshot.domains);
  const sources = eligibleSources(actor, snapshot, generatedAt.data);
  const tasks = eligibleTasks(actor, request, snapshot, domains, sources);

  return GetResponsibilityReportResultSchema.parse({
    status: "ready",
    report: {
      excludedNeedsReviewCount: excludedNeedsReviewCount(
        actor,
        request,
        snapshot,
        domains,
      ),
      generatedAt: generatedAt.data,
      narrative: narrativeFor(tasks),
      period: request.period,
      rows: rows(tasks, members),
      source: "deterministic_template",
      spaceId: actor.spaceId,
      unownedDomainCount: unownedDomainCount(
        actor,
        snapshot,
        domains,
        sources,
      ),
    },
  });
};
