import { createHash } from "node:crypto";

import { z } from "zod";

import {
  DomainSchema,
  EntityIdSchema,
  IdempotencyKeySchema,
  MemberActorSchema,
  RequestIdSchema,
  SharedVisibilitySchema,
  ShortTextSchema,
  TaskSchema,
  TimestampSchema,
  type Domain,
  type EntityId,
  type MemberActor,
  type SharedVisibility,
  type Task,
} from "../../../packages/contracts/src/index";
import {
  DomainDraftSchema,
  isDomainDraftError,
  validateDomainDraft,
  type DomainDraft,
} from "../../ai-domain/src/index";
import {
  ResponsibilityTaskFactSchema,
  assessTaskEligibility,
  canReadSharedVisibility,
  type ResponsibilityTaskFact,
} from "./eligibility";
import { responsibilityError } from "./errors";

const uniqueIds = (minimum: number, maximum: number) =>
  z
    .array(EntityIdSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "Identifiers must be unique.",
        });
      }
    });

const ExpectedTaskVersionSchema = z.strictObject({
  taskId: EntityIdSchema,
  version: z.number().int().nonnegative(),
});

export const ConfirmDomainGroupingRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  draft: DomainDraftSchema,
  confirmation: z.strictObject({
    domainId: EntityIdSchema,
    name: ShortTextSchema,
    ownerId: EntityIdSchema.nullable(),
    taskIds: uniqueIds(1, 50),
    evidenceIds: uniqueIds(1, 50),
    visibility: SharedVisibilitySchema,
    expectedTaskVersions: z
      .array(ExpectedTaskVersionSchema)
      .min(1)
      .max(50)
      .superRefine((values, context) => {
        const ids = values.map(({ taskId }) => taskId);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: "custom",
            message: "Expected task versions must be unique by task.",
          });
        }
      }),
    confirmedAt: TimestampSchema,
  }),
});
export type ConfirmDomainGroupingRequest = z.infer<
  typeof ConfirmDomainGroupingRequestSchema
>;

export const DomainGroupingContextSchema = z.strictObject({
  taskFacts: z.array(ResponsibilityTaskFactSchema).min(1).max(50),
  activeMemberIds: uniqueIds(1, 3),
});
export type DomainGroupingContext = z.infer<
  typeof DomainGroupingContextSchema
>;

export const ConfirmDomainGroupingResultSchema = z.strictObject({
  status: z.literal("confirmed"),
  domain: DomainSchema,
  tasks: z.array(TaskSchema).min(1).max(50),
  confirmation: z.strictObject({
    actorMemberId: EntityIdSchema,
    draftId: EntityIdSchema,
    draftSource: DomainDraftSchema.shape.source,
    confirmedAt: TimestampSchema,
  }),
});
export type ConfirmDomainGroupingResult = z.infer<
  typeof ConfirmDomainGroupingResultSchema
>;

export const DomainGroupingReplaySchema = z.strictObject({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: ConfirmDomainGroupingResultSchema,
});

export interface DomainGroupingCommit {
  readonly actor: MemberActor;
  readonly request: ConfirmDomainGroupingRequest;
  readonly requestHash: string;
  readonly validatedDraft: DomainDraft;
  readonly domain: Domain;
  readonly updatedTasks: readonly Task[];
}

export interface DomainGroupingRepository {
  findDomainGrouping(input: Readonly<{
    actor: MemberActor;
    idempotencyKey: string;
  }>): Promise<unknown>;
  loadDomainGroupingContext(input: Readonly<{
    spaceId: EntityId;
    taskIds: readonly EntityId[];
  }>): Promise<unknown>;
  commitDomainGrouping(command: DomainGroupingCommit): Promise<unknown>;
}

export interface ConfirmDomainGroupingInput {
  readonly actor: unknown;
  readonly request: unknown;
  readonly repository: DomainGroupingRepository;
}

const hashDomainGroupingRequest = (
  request: ConfirmDomainGroupingRequest,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        confirmation: {
          confirmedAt: request.confirmation.confirmedAt,
          domainId: request.confirmation.domainId,
          evidenceIds: [...request.confirmation.evidenceIds].sort(),
          expectedTaskVersions: [...request.confirmation.expectedTaskVersions]
            .sort((left, right) => left.taskId.localeCompare(right.taskId))
            .map(({ taskId, version }) => [taskId, version]),
          name: request.confirmation.name,
          ownerId: request.confirmation.ownerId,
          taskIds: [...request.confirmation.taskIds].sort(),
          visibility: request.confirmation.visibility,
        },
        draft: request.draft,
      }),
    )
    .digest("hex");

const isSubset = (
  values: readonly EntityId[],
  allowedValues: readonly EntityId[],
): boolean => {
  const allowed = new Set(allowedValues);
  return values.every((value) => allowed.has(value));
};

const sameIds = (
  left: readonly EntityId[],
  right: readonly EntityId[],
): boolean =>
  left.length === right.length && isSubset(left, right) && isSubset(right, left);

const visibilityAudience = (
  visibility: SharedVisibility,
  activeMemberIds: readonly EntityId[],
): ReadonlySet<EntityId> => {
  switch (visibility.kind) {
    case "space":
      return new Set(activeMemberIds);
    case "members":
      return new Set(visibility.memberIds);
    case "care_related":
      return new Set([visibility.subjectId, ...visibility.memberIds]);
  }
};

const doesNotWidenVisibility = (
  requested: SharedVisibility,
  source: SharedVisibility,
  activeMemberIds: readonly EntityId[],
): boolean => {
  const requestedAudience = visibilityAudience(requested, activeMemberIds);
  const sourceAudience = visibilityAudience(source, activeMemberIds);
  return [...requestedAudience].every((memberId) =>
    sourceAudience.has(memberId),
  );
};

const confirmationVisibilityIsAuthorized = (
  actor: MemberActor,
  visibility: SharedVisibility,
  evidenceIds: readonly EntityId[],
  selectedFacts: readonly ResponsibilityTaskFact[],
  activeMemberIds: readonly EntityId[],
): boolean => {
  if (!canReadSharedVisibility(actor, actor.spaceId, visibility)) {
    return false;
  }

  return selectedFacts.every(
    (fact) =>
      doesNotWidenVisibility(
        visibility,
        fact.task.visibility,
        activeMemberIds,
      ) &&
      fact.sourceLinks
        .filter(
          ({ draft, signal }) =>
            draft.kind === "potential_task" &&
            signal?.purpose === "responsibility" &&
            signal.evidenceState === "available" &&
            signal.provenance.some(({ evidenceId }) =>
              evidenceIds.includes(evidenceId),
            ),
        )
        .every(
          ({ signal }) =>
            signal !== null &&
            doesNotWidenVisibility(
              visibility,
              signal.visibility,
              activeMemberIds,
            ),
        ),
  );
};

const validateDraftForConfirmation = (
  draft: DomainDraft,
  scope: Readonly<{
    spaceId: EntityId;
    authorizedTaskIds: readonly EntityId[];
    authorizedEvidenceIds: readonly EntityId[];
    activeMemberIds: readonly EntityId[];
  }>,
): DomainDraft => {
  try {
    return validateDomainDraft(draft, scope);
  } catch (error) {
    if (
      isDomainDraftError(error) &&
      (error.code === "space_mismatch" ||
        error.code === "unauthorized_reference")
    ) {
      throw responsibilityError("forbidden");
    }

    throw responsibilityError("invalid_request");
  }
};

const buildDomain = (
  request: ConfirmDomainGroupingRequest,
): Domain =>
  DomainSchema.parse({
    id: request.confirmation.domainId,
    spaceId: request.draft.spaceId,
    createdAt: request.confirmation.confirmedAt,
    updatedAt: request.confirmation.confirmedAt,
    version: 0,
    name: request.confirmation.name,
    ownerId: request.confirmation.ownerId,
    status: "active",
    nextAction: null,
    visibility: request.confirmation.visibility,
    evidenceIds: request.confirmation.evidenceIds,
  });

const taskMatchesExpectedGrouping = (
  persistedTask: Task,
  expectedTask: Task,
): boolean =>
  persistedTask.id === expectedTask.id &&
  persistedTask.spaceId === expectedTask.spaceId &&
  persistedTask.domainId === expectedTask.domainId &&
  persistedTask.version === expectedTask.version;

/**
 * Turns a validated suggestion into an explicit member-confirmed persistence
 * command. The original draft is never treated as mutation authority.
 */
export const confirmDomainGrouping = async ({
  actor: actorInput,
  repository,
  request: requestInput,
}: ConfirmDomainGroupingInput): Promise<ConfirmDomainGroupingResult> => {
  const actor = MemberActorSchema.safeParse(actorInput);
  const request = ConfirmDomainGroupingRequestSchema.safeParse(requestInput);

  if (!actor.success || !request.success) {
    throw responsibilityError("invalid_request");
  }

  if (actor.data.spaceId !== request.data.draft.spaceId) {
    throw responsibilityError("forbidden");
  }

  const requestHash = hashDomainGroupingRequest(request.data);
  const replayInput = await repository.findDomainGrouping({
    actor: actor.data,
    idempotencyKey: request.data.idempotencyKey,
  });

  if (replayInput !== null) {
    const replay = DomainGroupingReplaySchema.safeParse(replayInput);

    if (!replay.success) {
      throw responsibilityError("invariant_violation");
    }

    if (replay.data.requestHash !== requestHash) {
      throw responsibilityError("idempotency_conflict");
    }

    return replay.data.result;
  }

  const contextInput = await repository.loadDomainGroupingContext({
    spaceId: actor.data.spaceId,
    taskIds: request.data.draft.taskIds,
  });

  if (contextInput === null) {
    throw responsibilityError("not_found");
  }

  const context = DomainGroupingContextSchema.safeParse(contextInput);

  if (!context.success) {
    throw responsibilityError("invariant_violation");
  }

  const contextTaskIds = context.data.taskFacts.map(({ task }) => task.id);

  if (
    !context.data.activeMemberIds.includes(actor.data.memberId) ||
    !sameIds(contextTaskIds, request.data.draft.taskIds) ||
    context.data.taskFacts.some(
      ({ task }) => task.spaceId !== actor.data.spaceId,
    )
  ) {
    throw responsibilityError("forbidden");
  }

  for (const fact of context.data.taskFacts) {
    const assessment = assessTaskEligibility(actor.data, fact);

    if (!assessment.eligible) {
      throw responsibilityError(
        assessment.reason === "visibility_denied"
          ? "forbidden"
          : "evidence_missing",
      );
    }
  }

  const authorizedEvidenceIds = [
    ...new Set(
      context.data.taskFacts.flatMap(({ task }) => task.evidenceIds),
    ),
  ];
  const validatedDraft = validateDraftForConfirmation(request.data.draft, {
    spaceId: actor.data.spaceId,
    authorizedTaskIds: contextTaskIds,
    authorizedEvidenceIds,
    activeMemberIds: context.data.activeMemberIds,
  });

  if (validatedDraft.missingInfo.length > 0) {
    throw responsibilityError("confirmation_required");
  }

  const { confirmation } = request.data;

  if (
    !isSubset(confirmation.taskIds, validatedDraft.taskIds) ||
    !isSubset(confirmation.evidenceIds, validatedDraft.evidenceIds) ||
    (confirmation.ownerId !== null &&
      !context.data.activeMemberIds.includes(confirmation.ownerId)) ||
    !sameIds(
      confirmation.taskIds,
      confirmation.expectedTaskVersions.map(({ taskId }) => taskId),
    )
  ) {
    throw responsibilityError("invalid_request");
  }

  const versions = new Map(
    confirmation.expectedTaskVersions.map(({ taskId, version }) => [
      taskId,
      version,
    ]),
  );
  const selectedFacts = context.data.taskFacts.filter(({ task }) =>
    confirmation.taskIds.includes(task.id),
  );
  const selectedEvidenceIds = [
    ...new Set(selectedFacts.flatMap(({ task }) => task.evidenceIds)),
  ];

  if (
    selectedFacts.some(
      ({ task }) => versions.get(task.id) !== task.version,
    ) ||
    !isSubset(selectedEvidenceIds, confirmation.evidenceIds) ||
    !confirmationVisibilityIsAuthorized(
      actor.data,
      confirmation.visibility,
      confirmation.evidenceIds,
      selectedFacts,
      context.data.activeMemberIds,
    )
  ) {
    if (
      selectedFacts.some(
        ({ task }) => versions.get(task.id) !== task.version,
      )
    ) {
      throw responsibilityError("stale_version");
    }

    throw responsibilityError("forbidden");
  }

  const domain = buildDomain(request.data);
  const updatedTasks = selectedFacts.map(({ task }) =>
    TaskSchema.parse({
      ...task,
      domainId: domain.id,
      updatedAt: confirmation.confirmedAt,
      version: task.version + 1,
    }),
  );
  const committedInput = await repository.commitDomainGrouping({
    actor: actor.data,
    request: request.data,
    requestHash,
    validatedDraft,
    domain,
    updatedTasks,
  });
  const committed = ConfirmDomainGroupingResultSchema.safeParse(committedInput);

  if (
    !committed.success ||
    committed.data.domain.id !== domain.id ||
    committed.data.domain.spaceId !== domain.spaceId ||
    committed.data.confirmation.actorMemberId !== actor.data.memberId ||
    committed.data.confirmation.draftId !== validatedDraft.id ||
    committed.data.tasks.length !== updatedTasks.length ||
    committed.data.tasks.some((task) => {
      const expected = updatedTasks.find(({ id }) => id === task.id);
      return expected === undefined || !taskMatchesExpectedGrouping(task, expected);
    })
  ) {
    throw responsibilityError("invariant_violation");
  }

  return committed.data;
};
