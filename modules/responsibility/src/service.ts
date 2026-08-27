import { randomUUID } from "node:crypto";

import type { ZodType } from "zod";

import {
  AuditEntrySchema,
  CorrectTaskAttributionRequestSchema,
  EntityIdSchema,
  GetResponsibilityReportRequestSchema,
  MemberActorSchema,
  TaskSchema,
  TimestampSchema,
  type Clock,
  type CorrectTaskAttributionResult,
  type EntityId,
  type GetResponsibilityReportResult,
  type MemberActor,
  type ResponsibilityAttribution,
  type Task,
  type Timestamp,
} from "../../../packages/contracts/src/index";

import {
  attributionUsesActiveMembers,
  responsibilitySourceGuard,
  taskAttribution,
  validateActorAndSpace,
  validateReadyDraft,
  validateResponsibilitySource,
} from "./eligibility";
import {
  createResponsibilityError,
  isResponsibilityError,
  type ResponsibilityErrorCode,
} from "./errors";
import { hashResponsibilityRequest } from "./hash";
import {
  AttributionCorrectionCommandSchema,
  AttributionCorrectionCommitResultSchema,
  AttributionCorrectionContextSchema,
  AttributionCorrectionResolutionSchema,
  CreateResponsibilityRequestSchema,
  ResponsibilityCreationCommandSchema,
  ResponsibilityCreationResultSchema,
  ResponsibilityDraftInputSchema,
  ResponsibilityDraftResultSchema,
  ResponsibilityReportSnapshotSchema,
  ResponsibilitySourceContextSchema,
  type AttributionCorrectionContext,
  type AttributionCorrectionGuard,
  type CreateResponsibilityRequest,
  type ResponsibilityCreationResult,
  type VersionGuardEntry,
} from "./model";
import type {
  AttributionCorrectionPort,
  ResponsibilityDraftPort,
  ResponsibilityPersistencePort,
  ResponsibilityReportPort,
  ResponsibilitySourcePort,
} from "./ports";
import { createResponsibilityReport } from "./report";
import { canReadSharedVisibility } from "./visibility";

export interface ResponsibilityServiceDependencies {
  readonly clock: Clock;
  readonly corrections?: AttributionCorrectionPort;
  readonly drafts: ResponsibilityDraftPort;
  readonly idGenerator?: () => EntityId;
  readonly persistence: ResponsibilityPersistencePort;
  readonly reports: ResponsibilityReportPort;
  readonly sources: ResponsibilitySourcePort;
}

export interface ResponsibilityService {
  createFromSharedSignal(
    actor: unknown,
    request: unknown,
  ): Promise<ResponsibilityCreationResult>;
  correctTaskAttribution(
    actor: unknown,
    request: unknown,
  ): Promise<CorrectTaskAttributionResult>;
  getResponsibilityReport(
    actor: unknown,
    request: unknown,
  ): Promise<GetResponsibilityReportResult>;
}

const parseInput = <Output>(
  schema: ZodType<Output>,
  input: unknown,
  errorCode: ResponsibilityErrorCode,
): Output => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw createResponsibilityError(errorCode);
  }

  return parsed.data;
};

const executeSafely = async <Result>(
  work: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (isResponsibilityError(error)) {
      throw error;
    }

    throw createResponsibilityError("internal_failure");
  }
};

const timestampNow = (clock: Clock): Timestamp =>
  parseInput(TimestampSchema, clock.now().toISOString(), "internal_failure");

const entityId = (generator: () => EntityId): EntityId =>
  parseInput(
    EntityIdSchema,
    generator(),
    "internal_failure",
  );

const parseMemberActor = (input: unknown): MemberActor =>
  parseInput(MemberActorSchema, input, "unauthenticated");

const sameValue = (left: unknown, right: unknown): boolean =>
  hashResponsibilityRequest(left) === hashResponsibilityRequest(right);

const createResponsibility = async (
  dependencies: ResponsibilityServiceDependencies,
  actor: MemberActor,
  request: CreateResponsibilityRequest,
): Promise<ResponsibilityCreationResult> => {
  const contextInput = await dependencies.sources.load({
    actorId: actor.memberId,
    sourceSignalId: request.sourceSignalId,
    spaceId: actor.spaceId,
  });

  if (contextInput === null || contextInput === undefined) {
    throw createResponsibilityError("not_found");
  }

  const context = parseInput(
    ResponsibilitySourceContextSchema,
    contextInput,
    "internal_failure",
  );

  if (context.signal.id !== request.sourceSignalId) {
    throw createResponsibilityError("not_found");
  }

  const observedAt = timestampNow(dependencies.clock);
  validateResponsibilitySource(actor, context, new Date(observedAt), true);

  const draftInput = ResponsibilityDraftInputSchema.parse({
    signal: context.signal,
    sourceDraft: context.draft,
  });
  const draft = parseInput(
    ResponsibilityDraftResultSchema,
    await dependencies.drafts.draft(draftInput),
    "internal_failure",
  );

  if (draft.status === "needs_human_review") {
    throw createResponsibilityError("needs_human_review");
  }

  validateReadyDraft(actor, context, draft);

  const command = ResponsibilityCreationCommandSchema.parse({
    actor,
    consentDecisionId: context.consent.id,
    domain: draft.domain,
    guard: responsibilitySourceGuard(context),
    requestId: request.requestId,
    sourceDraftId: context.draft.id,
    sourceSignalId: context.signal.id,
    task: draft.task,
  });
  const result = parseInput(
    ResponsibilityCreationResultSchema,
    await dependencies.persistence.create(command),
    "internal_failure",
  );

  if (
    result.sourceSignalId !== command.sourceSignalId ||
    !sameValue(result.domain, command.domain) ||
    !sameValue(result.task, command.task)
  ) {
    throw createResponsibilityError("internal_failure");
  }

  return result;
};

const idsAreExact = (
  left: readonly EntityId[],
  right: readonly EntityId[],
): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((id) => rightSet.has(id))
  );
};

const validateCorrectionContext = (
  actor: MemberActor,
  request: ReturnType<typeof CorrectTaskAttributionRequestSchema.parse>,
  context: AttributionCorrectionContext,
): void => {
  validateActorAndSpace(actor, context);

  if (
    context.task.id !== request.taskId ||
    context.task.spaceId !== actor.spaceId ||
    context.domain.spaceId !== actor.spaceId ||
    context.task.domainId !== context.domain.id ||
    context.domain.status !== "active"
  ) {
    throw createResponsibilityError("not_found");
  }

  if (
    !canReadSharedVisibility(
      actor.memberId,
      context.domain.visibility,
      context.members,
    ) ||
    !canReadSharedVisibility(
      actor.memberId,
      context.task.visibility,
      context.members,
    )
  ) {
    throw createResponsibilityError("forbidden");
  }

  if (context.task.version !== request.expectedVersion) {
    throw createResponsibilityError("stale_version");
  }

  if (
    context.task.reviewState !== "current" ||
    context.evidence.some(({ state }) => state !== "available") ||
    !idsAreExact(
      context.task.evidenceIds,
      context.evidence.map(({ id }) => id),
    )
  ) {
    throw createResponsibilityError("evidence_missing");
  }

  if (
    !attributionUsesActiveMembers(
      request.attribution,
      context.members,
      actor.spaceId,
    )
  ) {
    throw createResponsibilityError("forbidden");
  }
};

const correctionGuard = (
  context: AttributionCorrectionContext,
): AttributionCorrectionGuard => {
  const versionEntry = ({
    id,
    version,
  }: VersionGuardEntry): VersionGuardEntry => ({ id, version });
  const versionEntries = (values: readonly VersionGuardEntry[]) =>
    values
      .map(versionEntry)
      .sort(({ id: left }, { id: right }) => left.localeCompare(right));

  return {
    actorMember: versionEntry(context.actorMember),
    domain: versionEntry(context.domain),
    evidence: versionEntries(context.evidence),
    members: versionEntries(context.members),
    space: versionEntry(context.space),
    task: versionEntry(context.task),
  };
};

const RESPONSIBILITY_FIELDS = [
  "discoveredBy",
  "deadlineKeptBy",
  "scheduledBy",
  "executedBy",
  "followedUpBy",
] as const satisfies readonly (keyof ResponsibilityAttribution)[];

const correctedTask = (
  current: Task,
  attribution: ResponsibilityAttribution,
  updatedAt: Timestamp,
): Task =>
  TaskSchema.parse({
    ...current,
    ...attribution,
    updatedAt,
    version: current.version + 1,
  });

const correctAttribution = async (
  dependencies: ResponsibilityServiceDependencies,
  actor: MemberActor,
  request: ReturnType<typeof CorrectTaskAttributionRequestSchema.parse>,
): Promise<CorrectTaskAttributionResult> => {
  const port = dependencies.corrections;

  if (port === undefined) {
    throw createResponsibilityError("internal_failure");
  }

  const requestHash = hashResponsibilityRequest(request);
  const resolution = parseInput(
    AttributionCorrectionResolutionSchema,
    await port.resolve({ actor, request, requestHash }),
    "internal_failure",
  );

  if (resolution.status === "replay") {
    return resolution.result;
  }

  if (resolution.status === "conflict") {
    throw createResponsibilityError("idempotency_conflict");
  }

  const contextInput = await port.load({
    actorId: actor.memberId,
    spaceId: actor.spaceId,
    taskId: request.taskId,
  });

  if (contextInput === null || contextInput === undefined) {
    throw createResponsibilityError("not_found");
  }

  const context = parseInput(
    AttributionCorrectionContextSchema,
    contextInput,
    "internal_failure",
  );
  validateCorrectionContext(actor, request, context);

  const changes = RESPONSIBILITY_FIELDS.flatMap((field) =>
    context.task[field] === request.attribution[field]
      ? []
      : [
          {
            after: { kind: "id" as const, value: request.attribution[field] },
            before: { kind: "id" as const, value: context.task[field] },
            field,
          },
        ],
  );

  if (changes.length === 0) {
    throw createResponsibilityError("invalid_request");
  }

  const occurredAt = timestampNow(dependencies.clock);
  const task = correctedTask(context.task, request.attribution, occurredAt);
  const audit = AuditEntrySchema.parse({
    action: "task_attribution_corrected",
    actor: {
      kind: "member",
      memberId: actor.memberId,
      role: actor.role,
      spaceId: actor.spaceId,
    },
    afterVersion: task.version,
    beforeVersion: context.task.version,
    changes,
    id: entityId(dependencies.idGenerator ?? randomUUID),
    occurredAt,
    retention: "until_space_deleted",
    spaceId: actor.spaceId,
    targetId: task.id,
    targetType: "task",
    visibility: task.visibility,
  });
  const command = AttributionCorrectionCommandSchema.parse({
    actor,
    audit,
    guard: correctionGuard(context),
    request,
    requestHash,
    task,
  });
  const committed = parseInput(
    AttributionCorrectionCommitResultSchema,
    await port.commit(command),
    "internal_failure",
  );

  if (committed.status === "stale") {
    throw createResponsibilityError("stale_version");
  }

  if (committed.status === "conflict") {
    throw createResponsibilityError("idempotency_conflict");
  }

  const expectedResult: CorrectTaskAttributionResult = {
    auditEntryId: audit.id,
    status: "corrected",
    task,
  };

  if (
    committed.status === "replayed" &&
    committed.result.task.id === request.taskId &&
    committed.result.task.spaceId === actor.spaceId &&
    sameValue(
      taskAttribution(committed.result.task),
      request.attribution,
    )
  ) {
    return committed.result;
  }

  if (
    committed.status !== "committed" ||
    !sameValue(committed.result, expectedResult)
  ) {
    throw createResponsibilityError("internal_failure");
  }

  return committed.result;
};

export const createResponsibilityService = (
  dependencies: ResponsibilityServiceDependencies,
): ResponsibilityService => ({
  createFromSharedSignal: (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        CreateResponsibilityRequestSchema,
        requestInput,
        "invalid_request",
      );

      return createResponsibility(dependencies, actor, request);
    }),

  correctTaskAttribution: (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        CorrectTaskAttributionRequestSchema,
        requestInput,
        "invalid_request",
      );

      return correctAttribution(dependencies, actor, request);
    }),

  getResponsibilityReport: (actorInput, requestInput) =>
    executeSafely(async () => {
      const actor = parseMemberActor(actorInput);
      const request = parseInput(
        GetResponsibilityReportRequestSchema,
        requestInput,
        "invalid_request",
      );

      if (request.spaceId !== actor.spaceId) {
        throw createResponsibilityError("not_found");
      }

      const snapshot = parseInput(
        ResponsibilityReportSnapshotSchema,
        await dependencies.reports.load({ actor, request }),
        "internal_failure",
      );

      return createResponsibilityReport(
        actor,
        request,
        snapshot,
        timestampNow(dependencies.clock),
      );
    }),
});
