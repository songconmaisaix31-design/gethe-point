import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AuditEntrySchema,
  CorrectTaskAttributionRequestSchema,
  CorrectTaskAttributionResultSchema,
  EntityIdSchema,
  MemberActorSchema,
  ResponsibilityStageSchema,
  TaskSchema,
  TimestampSchema,
  type AuditEntry,
  type CorrectTaskAttributionRequest,
  type CorrectTaskAttributionResult,
  type EntityId,
  type MemberActor,
  type ResponsibilityStage,
  type Task,
} from "../../../packages/contracts/src/index";
import {
  ResponsibilityTaskFactSchema,
  assessTaskEligibility,
  type ResponsibilityTaskFact,
} from "./eligibility";
import { responsibilityError } from "./errors";

const uniqueMemberIds = z
  .array(EntityIdSchema)
  .min(1)
  .max(3)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Member identifiers must be unique.",
      });
    }
  });

export const AttributionCorrectionContextSchema = z.strictObject({
  taskFact: ResponsibilityTaskFactSchema,
  activeMemberIds: uniqueMemberIds,
});
export type AttributionCorrectionContext = z.infer<
  typeof AttributionCorrectionContextSchema
>;

export const AttributionCorrectionReplaySchema = z.strictObject({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: CorrectTaskAttributionResultSchema,
});
export type AttributionCorrectionReplay = z.infer<
  typeof AttributionCorrectionReplaySchema
>;

export interface AttributionCorrectionCommit {
  readonly actor: MemberActor;
  readonly request: CorrectTaskAttributionRequest;
  readonly requestHash: string;
  readonly updatedTask: Task;
  readonly auditEntry: AuditEntry;
  readonly correctedFields: readonly ResponsibilityStage[];
}

export interface AttributionCorrectionRepository {
  findAttributionCorrection(input: Readonly<{
    actor: MemberActor;
    idempotencyKey: string;
  }>): Promise<unknown>;
  loadAttributionCorrectionContext(input: Readonly<{
    spaceId: EntityId;
    taskId: EntityId;
  }>): Promise<unknown>;
  commitAttributionCorrection(
    command: AttributionCorrectionCommit,
  ): Promise<unknown>;
}

export interface CorrectTaskAttributionInput {
  readonly actor: unknown;
  readonly request: unknown;
  readonly repository: AttributionCorrectionRepository;
  readonly now: () => unknown;
  readonly createId: () => unknown;
}

const ATTRIBUTION_STAGES = ResponsibilityStageSchema.options;

const hashCorrectionRequest = (
  request: CorrectTaskAttributionRequest,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        attribution: ATTRIBUTION_STAGES.map(
          (stage) => request.attribution[stage],
        ),
        expectedVersion: request.expectedVersion,
        reason: request.reason,
        taskId: request.taskId,
      }),
    )
    .digest("hex");

const changedStages = (
  task: ResponsibilityTaskFact["task"],
  request: CorrectTaskAttributionRequest,
): ResponsibilityStage[] =>
  ATTRIBUTION_STAGES.filter(
    (stage) => task[stage] !== request.attribution[stage],
  );

const allAttributionTargetsAreActive = (
  request: CorrectTaskAttributionRequest,
  activeMemberIds: readonly EntityId[],
): boolean => {
  const activeMembers = new Set(activeMemberIds);
  return ATTRIBUTION_STAGES.every((stage) => {
    const memberId = request.attribution[stage];
    return memberId === null || activeMembers.has(memberId);
  });
};

const buildUpdatedTask = (
  task: ResponsibilityTaskFact["task"],
  request: CorrectTaskAttributionRequest,
  occurredAt: string,
): Task =>
  TaskSchema.parse({
    ...task,
    ...request.attribution,
    updatedAt: occurredAt,
    version: task.version + 1,
  });

const buildAuditEntry = (
  auditEntryId: EntityId,
  actor: MemberActor,
  previousTask: ResponsibilityTaskFact["task"],
  updatedTask: Task,
  correctedFields: readonly ResponsibilityStage[],
  occurredAt: string,
): AuditEntry =>
  AuditEntrySchema.parse({
    id: auditEntryId,
    spaceId: actor.spaceId,
    actor: {
      kind: "member",
      memberId: actor.memberId,
      spaceId: actor.spaceId,
      role: actor.role,
    },
    action: "task_attribution_corrected",
    targetType: "task",
    targetId: previousTask.id,
    beforeVersion: previousTask.version,
    afterVersion: updatedTask.version,
    changes: correctedFields.map((field) => ({
      field,
      before: { kind: "id", value: previousTask[field] },
      after: { kind: "id", value: updatedTask[field] },
    })),
    visibility: previousTask.visibility,
    occurredAt,
    retention: "until_space_deleted",
  });

const taskMatchesExpectedMutation = (
  persistedTask: Task,
  expectedTask: Task,
): boolean =>
  persistedTask.id === expectedTask.id &&
  persistedTask.spaceId === expectedTask.spaceId &&
  persistedTask.version === expectedTask.version &&
  ATTRIBUTION_STAGES.every(
    (stage) => persistedTask[stage] === expectedTask[stage],
  );

/**
 * Authorizes and prepares one atomic task-plus-audit write. The repository is
 * responsible only for optimistic/idempotent persistence, not policy decisions.
 */
export const correctTaskAttribution = async ({
  actor: actorInput,
  createId,
  now,
  repository,
  request: requestInput,
}: CorrectTaskAttributionInput): Promise<CorrectTaskAttributionResult> => {
  const actor = MemberActorSchema.safeParse(actorInput);
  const request = CorrectTaskAttributionRequestSchema.safeParse(requestInput);

  if (!actor.success || !request.success) {
    throw responsibilityError("invalid_request");
  }

  const requestHash = hashCorrectionRequest(request.data);
  const replayInput = await repository.findAttributionCorrection({
    actor: actor.data,
    idempotencyKey: request.data.idempotencyKey,
  });

  if (replayInput !== null) {
    const replay = AttributionCorrectionReplaySchema.safeParse(replayInput);

    if (!replay.success) {
      throw responsibilityError("invariant_violation");
    }

    if (replay.data.requestHash !== requestHash) {
      throw responsibilityError("idempotency_conflict");
    }

    return replay.data.result;
  }

  const contextInput = await repository.loadAttributionCorrectionContext({
    spaceId: actor.data.spaceId,
    taskId: request.data.taskId,
  });

  if (contextInput === null) {
    throw responsibilityError("not_found");
  }

  const context = AttributionCorrectionContextSchema.safeParse(contextInput);

  if (!context.success) {
    throw responsibilityError("invariant_violation");
  }

  const { activeMemberIds, taskFact } = context.data;

  if (
    taskFact.task.spaceId !== actor.data.spaceId ||
    !activeMemberIds.includes(actor.data.memberId)
  ) {
    throw responsibilityError("forbidden");
  }

  const eligibility = assessTaskEligibility(actor.data, taskFact);

  if (!eligibility.eligible) {
    throw responsibilityError(
      eligibility.reason === "visibility_denied"
        ? "forbidden"
        : "evidence_missing",
    );
  }

  if (taskFact.task.version !== request.data.expectedVersion) {
    throw responsibilityError("stale_version");
  }

  if (!allAttributionTargetsAreActive(request.data, activeMemberIds)) {
    throw responsibilityError("invalid_request");
  }

  const correctedFields = changedStages(taskFact.task, request.data);

  if (correctedFields.length === 0) {
    throw responsibilityError("invalid_request");
  }

  const occurredAt = TimestampSchema.safeParse(now());
  const auditEntryId = EntityIdSchema.safeParse(createId());

  if (!occurredAt.success || !auditEntryId.success) {
    throw responsibilityError("internal_failure");
  }

  const updatedTask = buildUpdatedTask(
    taskFact.task,
    request.data,
    occurredAt.data,
  );
  const auditEntry = buildAuditEntry(
    auditEntryId.data,
    actor.data,
    taskFact.task,
    updatedTask,
    correctedFields,
    occurredAt.data,
  );
  const committedInput = await repository.commitAttributionCorrection({
    actor: actor.data,
    request: request.data,
    requestHash,
    updatedTask,
    auditEntry,
    correctedFields,
  });
  const committed = CorrectTaskAttributionResultSchema.safeParse(committedInput);

  if (
    !committed.success ||
    committed.data.auditEntryId !== auditEntry.id ||
    !taskMatchesExpectedMutation(committed.data.task, updatedTask)
  ) {
    throw responsibilityError("invariant_violation");
  }

  return committed.data;
};
