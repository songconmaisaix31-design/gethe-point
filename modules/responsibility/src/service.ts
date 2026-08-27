import { createHash, randomUUID } from "node:crypto";

import {
  AuditEntrySchema,
  CorrectTaskAttributionRequestSchema,
  EntityIdSchema,
  GetResponsibilityReportRequestSchema,
  GetResponsibilityReportResultSchema,
  MemberActorSchema,
  TimestampSchema,
  type AuditEntry,
  type Clock,
  type CorrectTaskAttributionRequest,
  type CorrectTaskAttributionResult,
  type GetResponsibilityReportRequest,
  type GetResponsibilityReportResult,
  type MemberActor,
  type ResponsibilityAttribution,
  type ResponsibilityStage,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  AttributionCorrectionContextSchema,
  CorrectionCommitResultSchema,
  CorrectionIdempotencyResolutionSchema,
  ResponsibilityReportContextSchema,
  type AttributionCorrectionContext,
  type AttributionCorrectionGuard,
  type CorrectionStoredResult,
  type VersionGuardEntry,
} from "./model";
import {
  RESPONSIBILITY_STAGES,
  createResponsibilityReport,
} from "./report";
import { canMemberReadVisibility, hasUniqueIds } from "./visibility";

export type ResponsibilityFailureCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
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

export type AttributionCorrectionResult = CorrectTaskAttributionResult &
  Readonly<{
    auditOccurredAt: string;
    replayed: boolean;
  }>;

const SAFE_MESSAGES: Readonly<Record<ResponsibilityFailureCode, string>> = {
  invalid_request: "The responsibility request is invalid.",
  unauthenticated: "A valid member actor is required.",
  forbidden: "The actor is not allowed to perform this operation.",
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

export interface ResolveAttributionCorrectionInput {
  readonly actor: MemberActor;
  readonly operation: "CorrectTaskAttribution";
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

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
 * Implementations must make `commitAttributionCorrection` one transaction. It
 * rechecks the guard, arbitrates a concurrent idempotency claim, updates the
 * task, writes the audit, and stores the replay result or writes nothing.
 */
export interface ResponsibilityRepository {
  resolveAttributionCorrection(
    input: ResolveAttributionCorrectionInput,
  ): Promise<unknown>;
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

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  hasUniqueIds(left) &&
  hasUniqueIds(right) &&
  left.every((id) => right.includes(id));

const taskAttribution = (task: Task): ResponsibilityAttribution => ({
  discoveredBy: task.discoveredBy,
  deadlineKeptBy: task.deadlineKeptBy,
  scheduledBy: task.scheduledBy,
  executedBy: task.executedBy,
  followedUpBy: task.followedUpBy,
});

const changedStages = (
  before: ResponsibilityAttribution,
  after: ResponsibilityAttribution,
): ResponsibilityStage[] =>
  RESPONSIBILITY_STAGES.filter((stage) => before[stage] !== after[stage]);

const correctionRequestHash = (
  actor: MemberActor,
  request: CorrectTaskAttributionRequest,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        operation: "CorrectTaskAttribution",
        spaceId: actor.spaceId,
        actorId: actor.memberId,
        taskId: request.taskId,
        attribution: request.attribution,
        reason: request.reason,
        expectedVersion: request.expectedVersion,
      }),
    )
    .digest("hex");

interface ValidatedCorrectionContext {
  readonly context: AttributionCorrectionContext;
  readonly guard: AttributionCorrectionGuard;
}

type CorrectionContextResult =
  | Readonly<{ ok: true; value: ValidatedCorrectionContext }>
  | Readonly<{
      ok: false;
      code: Extract<
        ResponsibilityFailureCode,
        "not_found" | "stale_version" | "evidence_missing" | "forbidden"
      >;
    }>;

const guardEntry = ({ id, version }: VersionGuardEntry): VersionGuardEntry => ({
  id,
  version,
});

const sortedGuardEntries = (
  records: readonly VersionGuardEntry[],
): VersionGuardEntry[] =>
  records.map(guardEntry).sort((left, right) => left.id.localeCompare(right.id));

const validateCorrectionContext = (
  context: AttributionCorrectionContext,
  actor: MemberActor,
  request: CorrectTaskAttributionRequest,
): CorrectionContextResult => {
  if (
    context.space.id !== actor.spaceId ||
    context.space.status !== "active" ||
    context.actorMember.id !== actor.memberId ||
    context.actorMember.spaceId !== actor.spaceId ||
    context.actorMember.role !== actor.role
  ) {
    return { ok: false, code: "not_found" };
  }
  if (context.actorMember.status !== "active") {
    return { ok: false, code: "forbidden" };
  }

  const memberIds = context.members.map(({ id }) => id);
  if (
    !hasUniqueIds(memberIds) ||
    context.members.some(({ spaceId }) => spaceId !== actor.spaceId) ||
    !context.members.some(
      ({ id, version }) =>
        id === context.actorMember.id && version === context.actorMember.version,
    )
  ) {
    return { ok: false, code: "not_found" };
  }

  const { domain, evidence, task } = context;
  if (
    task.id !== request.taskId ||
    task.spaceId !== actor.spaceId ||
    domain.id !== task.domainId ||
    domain.spaceId !== actor.spaceId ||
    domain.status !== "active" ||
    task.reviewState !== "current" ||
    !canMemberReadVisibility(task.visibility, actor.memberId) ||
    !canMemberReadVisibility(domain.visibility, actor.memberId)
  ) {
    return { ok: false, code: "not_found" };
  }
  if (task.version !== request.expectedVersion) {
    return { ok: false, code: "stale_version" };
  }

  const evidenceIds = evidence.map(({ id }) => id);
  if (
    !sameIds(task.evidenceIds, evidenceIds) ||
    evidence.some(({ spaceId }) => spaceId !== actor.spaceId)
  ) {
    return { ok: false, code: "not_found" };
  }
  if (evidence.some(({ state }) => state !== "available")) {
    return { ok: false, code: "evidence_missing" };
  }

  const membersById = new Map(context.members.map((member) => [member.id, member]));
  const attributedMembers = Object.values(request.attribution).filter(
    (memberId): memberId is string => memberId !== null,
  );
  if (
    attributedMembers.some(
      (memberId) => membersById.get(memberId)?.status !== "active",
    )
  ) {
    return { ok: false, code: "forbidden" };
  }

  return {
    ok: true,
    value: {
      context,
      guard: {
        space: guardEntry(context.space),
        actorMember: guardEntry(context.actorMember),
        members: sortedGuardEntries(context.members),
        domain: guardEntry(domain),
        task: guardEntry(task),
        evidence: sortedGuardEntries(evidence),
      },
    },
  };
};

const storedResultMatchesRequest = (
  stored: CorrectionStoredResult,
  actor: MemberActor,
  request: CorrectTaskAttributionRequest,
): boolean =>
  stored.task.id === request.taskId &&
  stored.task.spaceId === actor.spaceId &&
  stored.task.version === request.expectedVersion + 1 &&
  RESPONSIBILITY_STAGES.every(
    (stage) => stored.task[stage] === request.attribution[stage],
  );

const correctionResult = (
  stored: CorrectionStoredResult,
  replayed: boolean,
): AttributionCorrectionResult => ({
  status: "corrected",
  task: stored.task,
  auditEntryId: stored.auditEntryId,
  auditOccurredAt: stored.auditOccurredAt,
  replayed,
});

const createCorrectionAudit = (
  id: string,
  actor: MemberActor,
  task: Task,
  attribution: ResponsibilityAttribution,
  occurredAt: string,
): AuditEntry | undefined => {
  const before = taskAttribution(task);
  const parsed = AuditEntrySchema.safeParse({
    id,
    spaceId: actor.spaceId,
    actor: {
      kind: "member",
      memberId: actor.memberId,
      spaceId: actor.spaceId,
      role: actor.role,
    },
    action: "task_attribution_corrected",
    targetType: "task",
    targetId: task.id,
    beforeVersion: task.version,
    afterVersion: task.version + 1,
    changes: changedStages(before, attribution).map((stage) => ({
      field: stage,
      before: { kind: "id", value: before[stage] },
      after: { kind: "id", value: attribution[stage] },
    })),
    visibility: task.visibility,
    occurredAt,
    retention: "until_space_deleted",
  });
  return parsed.success ? parsed.data : undefined;
};

const mapCommitFailure = (
  status: Exclude<
    (typeof CorrectionCommitResultSchema)["_output"]["status"],
    "corrected" | "replayed"
  >,
): ResponsibilityFailureCode => {
  switch (status) {
    case "not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
    case "stale_version":
      return "stale_version";
    case "evidence_missing":
      return "evidence_missing";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "conflict":
      return "conflict";
  }
};

export const createResponsibilityService = (
  dependencies: ResponsibilityServiceDependencies,
) => {
  const createId = dependencies.createId ?? randomUUID;

  const correctTaskAttribution = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<ResponsibilityResult<AttributionCorrectionResult>> => {
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
    const requestHash = correctionRequestHash(actor, request);

    let rawResolution: unknown;
    try {
      rawResolution = await dependencies.repository.resolveAttributionCorrection({
        actor,
        operation: "CorrectTaskAttribution",
        taskId: request.taskId,
        idempotencyKey: request.idempotencyKey,
        requestHash,
      });
    } catch {
      return fail("internal_failure");
    }
    const resolution = CorrectionIdempotencyResolutionSchema.safeParse(rawResolution);
    if (!resolution.success) {
      return fail("internal_failure");
    }
    if (resolution.data.status === "conflict") {
      return fail("idempotency_conflict");
    }
    if (resolution.data.status === "replayed") {
      return storedResultMatchesRequest(resolution.data.result, actor, request)
        ? { ok: true, result: correctionResult(resolution.data.result, true) }
        : fail("internal_failure");
    }

    let rawContext: unknown;
    try {
      rawContext = await dependencies.repository.loadAttributionCorrectionContext({
        actor,
        taskId: request.taskId,
      });
    } catch {
      return fail("internal_failure");
    }
    const parsedContext = AttributionCorrectionContextSchema.safeParse(rawContext);
    if (!parsedContext.success) {
      return fail("internal_failure");
    }
    const validated = validateCorrectionContext(parsedContext.data, actor, request);
    if (!validated.ok) {
      return fail(validated.code);
    }
    if (
      changedStages(
        taskAttribution(validated.value.context.task),
        request.attribution,
      ).length === 0
    ) {
      return fail("conflict");
    }

    const auditEntryId = createId();
    if (!EntityIdSchema.safeParse(auditEntryId).success) {
      return fail("internal_failure");
    }
    let auditOccurredAt: string;
    try {
      auditOccurredAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }
    if (!TimestampSchema.safeParse(auditOccurredAt).success) {
      return fail("internal_failure");
    }
    const auditEntry = createCorrectionAudit(
      auditEntryId,
      actor,
      validated.value.context.task,
      request.attribution,
      auditOccurredAt,
    );
    if (auditEntry === undefined) {
      return fail("internal_failure");
    }

    let rawCommit: unknown;
    try {
      rawCommit = await dependencies.repository.commitAttributionCorrection({
        actor,
        request: {
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          taskId: request.taskId,
          attribution: request.attribution,
          expectedVersion: request.expectedVersion,
        },
        requestHash,
        guard: validated.value.guard,
        auditEntry,
      });
    } catch {
      return fail("internal_failure");
    }

    const commit = CorrectionCommitResultSchema.safeParse(rawCommit);
    if (!commit.success) {
      return fail("internal_failure");
    }
    if (commit.data.status !== "corrected" && commit.data.status !== "replayed") {
      return fail(mapCommitFailure(commit.data.status));
    }
    if (!storedResultMatchesRequest(commit.data.result, actor, request)) {
      return fail("internal_failure");
    }
    if (
      commit.data.status === "corrected" &&
      (commit.data.result.auditEntryId !== auditEntryId ||
        commit.data.result.auditOccurredAt !== auditOccurredAt)
    ) {
      return fail("internal_failure");
    }

    return {
      ok: true,
      result: correctionResult(
        commit.data.result,
        commit.data.status === "replayed",
      ),
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
    const context = ResponsibilityReportContextSchema.safeParse(rawContext);
    if (!context.success) {
      return fail("internal_failure");
    }

    let generatedAt: string;
    try {
      generatedAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }
    if (!TimestampSchema.safeParse(generatedAt).success) {
      return fail("internal_failure");
    }

    const report = createResponsibilityReport(
      context.data,
      actor,
      request,
      generatedAt,
    );
    if (report === undefined) {
      return fail("not_found");
    }
    const result = GetResponsibilityReportResultSchema.safeParse({
      status: "ready",
      report,
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
