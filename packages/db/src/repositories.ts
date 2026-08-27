import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  AcceptHandoverRequestSchema,
  ActorSchema,
  RequestHashSchema,
  TimestampSchema,
  type Actor,
  type AuditEntry,
} from "../../contracts/src/index";
import type { Database, DatabaseTransaction } from "./client";
import {
  auditLogs,
  domains,
  handovers,
  idempotencyRecords,
  reminders,
} from "./schema";

export const AcceptHandoverPersistenceInputSchema =
  AcceptHandoverRequestSchema.extend({
    acceptedAt: TimestampSchema,
    requestHash: RequestHashSchema,
  });

export type AcceptHandoverPersistenceInput = z.infer<
  typeof AcceptHandoverPersistenceInputSchema
>;

const AcceptedHandoverPersistenceResultSchema = z.strictObject({
  status: z.enum(["accepted", "replayed"]),
  handoverId: z.uuid(),
  domainId: z.uuid(),
  previousOwnerId: z.uuid(),
  newOwnerId: z.uuid(),
  futureTaskDefaultsUpdated: z.literal(true),
  migratedReminderIds: z.array(z.uuid()),
  auditEntryId: z.uuid(),
});

export type AcceptedHandoverPersistenceResult = z.infer<
  typeof AcceptedHandoverPersistenceResultSchema
>;

export type RepositoryErrorCode =
  | "forbidden"
  | "handover_blocked"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "internal_failure"
  | "invalid_actor"
  | "invalid_request"
  | "invariant_violation"
  | "not_found"
  | "stale_version"
  | "transition_denied";

export interface RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly name: "RepositoryError";
}

const SAFE_ERROR_MESSAGES: Readonly<Record<RepositoryErrorCode, string>> = {
  forbidden: "The actor is not allowed to perform this persistence operation.",
  handover_blocked: "The handover is not ready for acceptance.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  idempotency_in_progress: "The idempotent operation has not completed.",
  internal_failure: "The persistence operation failed.",
  invalid_actor: "A valid explicit actor is required.",
  invalid_request: "The persistence request is invalid.",
  invariant_violation: "The persisted state does not satisfy the required invariant.",
  not_found: "The requested record was not found.",
  stale_version: "The persisted record version has changed.",
  transition_denied: "The requested state transition is not allowed.",
};

const repositoryError = (code: RepositoryErrorCode): RepositoryError =>
  Object.assign(new Error(SAFE_ERROR_MESSAGES[code]), {
    code,
    name: "RepositoryError" as const,
  });

export const isRepositoryError = (error: unknown): error is RepositoryError =>
  error instanceof Error && error.name === "RepositoryError";

export const validateRepositoryActor = (input: unknown): Actor => {
  const parsed = ActorSchema.safeParse(input);

  if (!parsed.success) {
    throw repositoryError("invalid_actor");
  }

  return parsed.data;
};

const actorKey = (actor: Actor): string =>
  actor.kind === "member"
    ? `member:${actor.memberId}`
    : `system:${actor.service}`;

const actorColumns = (actor: Actor) =>
  actor.kind === "member"
    ? {
        actorKind: "member" as const,
        actorMemberId: actor.memberId,
        actorService: null,
      }
    : {
        actorKind: "system" as const,
        actorMemberId: null,
        actorService: actor.service,
      };

const parseAcceptInput = (input: unknown): AcceptHandoverPersistenceInput => {
  const parsed = AcceptHandoverPersistenceInputSchema.safeParse(input);

  if (!parsed.success) {
    throw repositoryError("invalid_request");
  }

  return parsed.data;
};

const claimAcceptance = async (
  tx: DatabaseTransaction,
  actor: Actor,
  input: AcceptHandoverPersistenceInput,
): Promise<AcceptedHandoverPersistenceResult | undefined> => {
  const id = randomUUID();
  const scopedActorKey = actorKey(actor);
  const [inserted] = await tx
    .insert(idempotencyRecords)
    .values({
      ...actorColumns(actor),
      actorKey: scopedActorKey,
      claimedAt: input.acceptedAt,
      id,
      idempotencyKey: input.idempotencyKey,
      operation: "AcceptHandover",
      requestHash: input.requestHash,
      spaceId: actor.spaceId,
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.spaceId,
        idempotencyRecords.operation,
        idempotencyRecords.actorKey,
        idempotencyRecords.idempotencyKey,
      ],
    })
    .returning({ id: idempotencyRecords.id });

  if (inserted !== undefined) {
    return undefined;
  }

  const [existing] = await tx
    .select({
      requestHash: idempotencyRecords.requestHash,
      result: idempotencyRecords.result,
      state: idempotencyRecords.state,
    })
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.spaceId, actor.spaceId),
        eq(idempotencyRecords.operation, "AcceptHandover"),
        eq(idempotencyRecords.actorKey, scopedActorKey),
        eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing === undefined) {
    throw repositoryError("internal_failure");
  }

  if (existing.requestHash !== input.requestHash) {
    throw repositoryError("idempotency_conflict");
  }

  if (existing.state !== "completed") {
    throw repositoryError("idempotency_in_progress");
  }

  const replay = AcceptedHandoverPersistenceResultSchema.safeParse(
    existing.result,
  );

  if (!replay.success) {
    throw repositoryError("invariant_violation");
  }

  return { ...replay.data, status: "replayed" };
};

const completeAcceptance = async (
  tx: DatabaseTransaction,
  actor: Actor,
  input: AcceptHandoverPersistenceInput,
  result: AcceptedHandoverPersistenceResult,
): Promise<void> => {
  const completed = await tx
    .update(idempotencyRecords)
    .set({
      completedAt: input.acceptedAt,
      result,
      state: "completed",
    })
    .where(
      and(
        eq(idempotencyRecords.spaceId, actor.spaceId),
        eq(idempotencyRecords.operation, "AcceptHandover"),
        eq(idempotencyRecords.actorKey, actorKey(actor)),
        eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
        eq(idempotencyRecords.requestHash, input.requestHash),
        eq(idempotencyRecords.state, "claimed"),
      ),
    )
    .returning({ id: idempotencyRecords.id });

  if (completed.length !== 1) {
    throw repositoryError("invariant_violation");
  }
};

const acceptHandover = async (
  tx: DatabaseTransaction,
  actor: Actor,
  rawInput: unknown,
): Promise<AcceptedHandoverPersistenceResult> => {
  if (actor.kind !== "system" || actor.service !== "handover_service") {
    throw repositoryError("forbidden");
  }

  const input = parseAcceptInput(rawInput);
  const replay = await claimAcceptance(tx, actor, input);

  if (replay !== undefined) {
    return replay;
  }

  const [handover] = await tx
    .select()
    .from(handovers)
    .where(
      and(
        eq(handovers.spaceId, actor.spaceId),
        eq(handovers.id, input.handoverId),
      ),
    )
    .for("update")
    .limit(1);

  if (handover === undefined) {
    throw repositoryError("not_found");
  }

  if (handover.version !== input.expectedHandoverVersion) {
    throw repositoryError("stale_version");
  }

  if (handover.status !== "awaiting_confirmations") {
    throw repositoryError(
      handover.status === "blocked" ? "handover_blocked" : "transition_denied",
    );
  }

  if (
    handover.fromConfirmedAt === null ||
    handover.toConfirmedAt === null ||
    !Array.isArray(handover.missingInfo) ||
    handover.missingInfo.length !== 0
  ) {
    throw repositoryError("handover_blocked");
  }

  const [domain] = await tx
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.spaceId, actor.spaceId),
        eq(domains.id, handover.domainId),
      ),
    )
    .for("update")
    .limit(1);

  if (domain === undefined) {
    throw repositoryError("not_found");
  }

  if (domain.version !== input.expectedDomainVersion) {
    throw repositoryError("stale_version");
  }

  if (domain.ownerId !== handover.fromMemberId) {
    throw repositoryError("invariant_violation");
  }

  const updatedDomains = await tx
    .update(domains)
    .set({
      futureTaskOwnerId: handover.toMemberId,
      ownerId: handover.toMemberId,
      updatedAt: input.acceptedAt,
      version: sql`${domains.version} + 1`,
    })
    .where(
      and(
        eq(domains.spaceId, actor.spaceId),
        eq(domains.id, domain.id),
        eq(domains.ownerId, handover.fromMemberId),
        eq(domains.version, input.expectedDomainVersion),
      ),
    )
    .returning({ id: domains.id });

  if (updatedDomains.length !== 1) {
    throw repositoryError("stale_version");
  }

  const migratedReminders = await tx
    .update(reminders)
    .set({
      ownerMemberId: handover.toMemberId,
      updatedAt: input.acceptedAt,
      version: sql`${reminders.version} + 1`,
    })
    .where(
      and(
        eq(reminders.spaceId, actor.spaceId),
        eq(reminders.domainId, domain.id),
        eq(reminders.ownerMemberId, handover.fromMemberId),
        eq(reminders.status, "active"),
      ),
    )
    .returning({ id: reminders.id });

  const updatedHandovers = await tx
    .update(handovers)
    .set({
      acceptedAt: input.acceptedAt,
      status: "accepted",
      terminalAt: input.acceptedAt,
      updatedAt: input.acceptedAt,
      version: sql`${handovers.version} + 1`,
    })
    .where(
      and(
        eq(handovers.spaceId, actor.spaceId),
        eq(handovers.id, handover.id),
        eq(handovers.status, "awaiting_confirmations"),
        eq(handovers.version, input.expectedHandoverVersion),
      ),
    )
    .returning({ id: handovers.id });

  if (updatedHandovers.length !== 1) {
    throw repositoryError("stale_version");
  }

  const auditEntryId = randomUUID();
  const changes = [
    {
      after: { kind: "id", value: handover.toMemberId },
      before: { kind: "id", value: handover.fromMemberId },
      field: "ownerId",
    },
    {
      after: { kind: "id", value: handover.toMemberId },
      before: { kind: "id", value: handover.fromMemberId },
      field: "reminderOwnerId",
    },
  ] satisfies AuditEntry["changes"];

  await tx.insert(auditLogs).values({
    ...actorColumns(actor),
    action: "handover_accepted",
    afterVersion: input.expectedHandoverVersion + 1,
    beforeVersion: input.expectedHandoverVersion,
    changes,
    id: auditEntryId,
    occurredAt: input.acceptedAt,
    spaceId: actor.spaceId,
    targetId: handover.id,
    targetType: "handover",
    visibilityKind: domain.visibilityKind,
    visibilityMemberIds: domain.visibilityMemberIds,
    visibilitySubjectId: domain.visibilitySubjectId,
  });

  const result: AcceptedHandoverPersistenceResult = {
    auditEntryId,
    domainId: domain.id,
    futureTaskDefaultsUpdated: true,
    handoverId: handover.id,
    migratedReminderIds: migratedReminders.map(({ id }) => id),
    newOwnerId: handover.toMemberId,
    previousOwnerId: handover.fromMemberId,
    status: "accepted",
  };

  await completeAcceptance(tx, actor, input, result);

  return result;
};

export interface ActorBoundRepositories {
  readonly actor: Actor;
  readonly handovers: {
    accept(input: unknown): Promise<AcceptedHandoverPersistenceResult>;
  };
}

const createActorBoundRepositories = (
  tx: DatabaseTransaction,
  actor: Actor,
): ActorBoundRepositories => ({
  actor,
  handovers: {
    accept: (input) => acceptHandover(tx, actor, input),
  },
});

export const withActorTransaction = async <Result>(
  database: Database,
  actorInput: unknown,
  work: (repositories: ActorBoundRepositories) => Promise<Result>,
): Promise<Result> => {
  const actor = validateRepositoryActor(actorInput);

  try {
    return await database.transaction(async (tx) =>
      work(createActorBoundRepositories(tx, actor)),
    );
  } catch (error) {
    if (isRepositoryError(error)) {
      throw error;
    }

    throw repositoryError("internal_failure");
  }
};
