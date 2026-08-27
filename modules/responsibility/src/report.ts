import { z } from "zod";

import {
  GetResponsibilityReportRequestSchema,
  GetResponsibilityReportResultSchema,
  MemberActorSchema,
  MemberSchema,
  ResponsibilityReportSchema,
  ResponsibilityStageSchema,
  TimestampSchema,
  type EntityId,
  type GetResponsibilityReportResult,
  type ResponsibilityReport,
  type ResponsibilityStage,
} from "../../../packages/contracts/src/index";
import {
  ResponsibilityDomainFactSchema,
  ResponsibilityTaskFactSchema,
  assessDomainEligibility,
  assessTaskEligibility,
  canReadSharedVisibility,
  hasActorVisibleResponsibilitySignal,
  type EligibilityFailure,
} from "./eligibility";
import { responsibilityError } from "./errors";

export const ResponsibilityReportDatasetSchema = z.strictObject({
  members: z.array(MemberSchema).min(1).max(3),
  tasks: z.array(ResponsibilityTaskFactSchema).max(10_000),
  domains: z.array(ResponsibilityDomainFactSchema).max(1_000),
});
export type ResponsibilityReportDataset = z.infer<
  typeof ResponsibilityReportDatasetSchema
>;

export interface ResponsibilityReportTrace {
  readonly includedTaskIds: readonly EntityId[];
  readonly excludedVisibleTasks: readonly Readonly<{
    taskId: EntityId;
    reason: EligibilityFailure;
  }>[];
  readonly includedUnownedDomainIds: readonly EntityId[];
}

export interface ResponsibilityReportBuild {
  readonly result: GetResponsibilityReportResult;
  readonly trace: ResponsibilityReportTrace;
}

const REPORT_NARRATIVES = Object.freeze({
  complete:
    "The stage counts summarize eligible, authorized records for the selected period. They describe recorded activity without evaluating effort, intent, or relationships.",
  withReviewExclusions:
    "The stage counts summarize eligible, authorized records for the selected period. Items awaiting review remain outside the counts; the report does not evaluate effort, intent, or relationships.",
});

const assertUniqueIds = (ids: readonly EntityId[]): void => {
  if (new Set(ids).size !== ids.length) {
    throw responsibilityError("invariant_violation");
  }
};

const isWithinClosedPeriod = (
  timestamp: string,
  period: Readonly<{ startAt: string; endAt: string }>,
): boolean => {
  const value = Date.parse(timestamp);
  return value >= Date.parse(period.startAt) && value <= Date.parse(period.endAt);
};

const createEmptyCounts = (
  memberIds: readonly EntityId[],
): Map<ResponsibilityStage, Map<EntityId, number>> =>
  new Map(
    ResponsibilityStageSchema.options.map((stage) => [
      stage,
      new Map(memberIds.map((memberId) => [memberId, 0])),
    ]),
  );

const incrementStage = (
  counts: Map<ResponsibilityStage, Map<EntityId, number>>,
  stage: ResponsibilityStage,
  memberId: EntityId | null,
): void => {
  if (memberId === null) {
    return;
  }

  const stageCounts = counts.get(stage);
  const current = stageCounts?.get(memberId);

  if (stageCounts === undefined || current === undefined) {
    throw responsibilityError("invariant_violation");
  }

  stageCounts.set(memberId, current + 1);
};

const toReportRows = (
  counts: Map<ResponsibilityStage, Map<EntityId, number>>,
  memberIds: readonly EntityId[],
): ResponsibilityReport["rows"] =>
  ResponsibilityStageSchema.options.map((stage) => ({
    stage,
    counts: memberIds.map((memberId) => ({
      memberId,
      count: counts.get(stage)?.get(memberId) ?? 0,
    })),
  }));

export interface BuildResponsibilityReportInput {
  readonly actor: unknown;
  readonly request: unknown;
  readonly dataset: unknown;
  readonly generatedAt: unknown;
}

/**
 * Produces the contract report and a content-free trace from persisted facts.
 * Invisible record identifiers are deliberately omitted from the trace.
 */
export const buildResponsibilityReport = ({
  actor: actorInput,
  dataset: datasetInput,
  generatedAt: generatedAtInput,
  request: requestInput,
}: BuildResponsibilityReportInput): ResponsibilityReportBuild => {
  const actor = MemberActorSchema.safeParse(actorInput);
  const request = GetResponsibilityReportRequestSchema.safeParse(requestInput);
  const dataset = ResponsibilityReportDatasetSchema.safeParse(datasetInput);
  const generatedAt = TimestampSchema.safeParse(generatedAtInput);

  if (
    !actor.success ||
    !request.success ||
    !dataset.success ||
    !generatedAt.success
  ) {
    throw responsibilityError("invalid_request");
  }

  if (
    actor.data.spaceId !== request.data.spaceId ||
    dataset.data.members.some(
      (member) => member.spaceId !== request.data.spaceId,
    )
  ) {
    throw responsibilityError("forbidden");
  }

  const actorMember = dataset.data.members.find(
    ({ id }) => id === actor.data.memberId,
  );

  if (actorMember?.status !== "active") {
    throw responsibilityError("forbidden");
  }

  assertUniqueIds(dataset.data.members.map(({ id }) => id));
  assertUniqueIds(dataset.data.tasks.map(({ task }) => task.id));
  assertUniqueIds(dataset.data.domains.map(({ domain }) => domain.id));

  const memberIds = dataset.data.members
    .map(({ id }) => id)
    .sort((left, right) => left.localeCompare(right));
  const counts = createEmptyCounts(memberIds);
  const includedTaskIds: EntityId[] = [];
  const excludedVisibleTasks: {
    taskId: EntityId;
    reason: EligibilityFailure;
  }[] = [];
  let excludedNeedsReviewCount = 0;

  for (const fact of dataset.data.tasks) {
    if (
      fact.task.spaceId !== request.data.spaceId ||
      !isWithinClosedPeriod(fact.task.updatedAt, request.data.period)
    ) {
      continue;
    }

    const taskVisible = canReadSharedVisibility(
      actor.data,
      fact.task.spaceId,
      fact.task.visibility,
    );

    if (!taskVisible) {
      continue;
    }

    if (
      fact.task.reviewState === "needs_review" &&
      hasActorVisibleResponsibilitySignal(
        actor.data,
        fact.task.spaceId,
        fact.sourceLinks,
      )
    ) {
      excludedNeedsReviewCount += 1;
    }

    const assessment = assessTaskEligibility(actor.data, fact);

    if (!assessment.eligible) {
      excludedVisibleTasks.push({
        taskId: fact.task.id,
        reason: assessment.reason,
      });
      continue;
    }

    includedTaskIds.push(fact.task.id);
    incrementStage(counts, "discoveredBy", fact.task.discoveredBy);
    incrementStage(counts, "deadlineKeptBy", fact.task.deadlineKeptBy);
    incrementStage(counts, "scheduledBy", fact.task.scheduledBy);
    incrementStage(counts, "executedBy", fact.task.executedBy);
    incrementStage(counts, "followedUpBy", fact.task.followedUpBy);
  }

  const includedUnownedDomainIds = dataset.data.domains
    .filter(
      (fact) =>
        fact.domain.spaceId === request.data.spaceId &&
        fact.domain.ownerId === null &&
        assessDomainEligibility(actor.data, fact).eligible,
    )
    .map(({ domain }) => domain.id);

  const report = ResponsibilityReportSchema.parse({
    spaceId: request.data.spaceId,
    period: request.data.period,
    generatedAt: generatedAt.data,
    rows: toReportRows(counts, memberIds),
    unownedDomainCount: includedUnownedDomainIds.length,
    excludedNeedsReviewCount,
    narrative:
      excludedNeedsReviewCount > 0
        ? REPORT_NARRATIVES.withReviewExclusions
        : REPORT_NARRATIVES.complete,
    source: "deterministic_template",
  });

  return {
    result: GetResponsibilityReportResultSchema.parse({
      status: "ready",
      report,
    }),
    trace: {
      includedTaskIds,
      excludedVisibleTasks,
      includedUnownedDomainIds,
    },
  };
};
