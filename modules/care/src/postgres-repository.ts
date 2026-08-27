import { and, asc, eq, inArray } from "drizzle-orm";

import {
  ActorSchema,
  AuditEntrySchema,
  CareEventSchema,
  CareRuleSchema,
  TimestampSchema,
  type Actor,
  type CareEvent,
  type CareRule,
  type Timestamp,
  type Visibility,
} from "../../../packages/contracts/src/index";
import {
  auditLogs,
  careEvents,
  careRules,
  evidence,
  idempotencyRecords,
  members,
  type Database,
  type DatabaseTransaction,
} from "../../../packages/db/src/index";
import { deterministicUuid } from "./deterministic";
import {
  careOperationError,
  isCareOperationError,
  throwCareOperationError,
  type CareRepository,
  type CareTransaction,
  type IdempotentExecution,
  type IdempotentExecutionInput,
} from "./repository";

const normalizedTimestamp = (value: string): Timestamp =>
  TimestampSchema.parse(new Date(value).toISOString());

const normalizedNullableTimestamp = (value: string | null): Timestamp | null =>
  value === null ? null : normalizedTimestamp(value);

const parseCareRuleRow = (
  row: typeof careRules.$inferSelect,
): CareRule =>
  CareRuleSchema.parse({
    ...row,
    confirmedAt: normalizedNullableTimestamp(row.confirmedAt),
    createdAt: normalizedTimestamp(row.createdAt),
    updatedAt: normalizedTimestamp(row.updatedAt),
  });

const parseCareEventRow = (
  row: typeof careEvents.$inferSelect,
): CareEvent =>
  CareEventSchema.parse({
    ...row,
    acknowledgementDeadline: normalizedNullableTimestamp(
      row.acknowledgementDeadline,
    ),
    acknowledgedAt: normalizedNullableTimestamp(row.acknowledgedAt),
    closedAt: normalizedNullableTimestamp(row.closedAt),
    createdAt: normalizedTimestamp(row.createdAt),
    escalatedAt: normalizedNullableTimestamp(row.escalatedAt),
    handledAt: normalizedNullableTimestamp(row.handledAt),
    notificationIntentIds: [],
    notifiedAt: normalizedNullableTimestamp(row.notifiedAt),
    scheduledFor: normalizedTimestamp(row.scheduledFor),
    timedOutAt: normalizedNullableTimestamp(row.timedOutAt),
    unresolvedAt: normalizedNullableTimestamp(row.unresolvedAt),
    updatedAt: normalizedTimestamp(row.updatedAt),
  });

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

const visibilityColumns = (
  visibility: Visibility,
): Readonly<{
  visibilityKind: Visibility["kind"];
  visibilityMemberIds: string[];
  visibilitySubjectId: string | null;
}> => {
  switch (visibility.kind) {
    case "self":
      return {
        visibilityKind: "self",
        visibilityMemberIds: [visibility.memberId],
        visibilitySubjectId: null,
      };
    case "space":
      return {
        visibilityKind: "space",
        visibilityMemberIds: [],
        visibilitySubjectId: null,
      };
    case "members":
      return {
        visibilityKind: "members",
        visibilityMemberIds: [...visibility.memberIds],
        visibilitySubjectId: null,
      };
    case "care_related":
      return {
        visibilityKind: "care_related",
        visibilityMemberIds: [...visibility.memberIds],
        visibilitySubjectId: visibility.subjectId,
      };
  }
};

const careRuleUpdate = (rule: CareRule) => ({
  ackTimeoutSec: rule.ackTimeoutSec,
  confirmedAt: rule.confirmedAt,
  confirmedBy: rule.confirmedBy,
  escalationChain: [...rule.escalationChain],
  requireAck: rule.requireAck,
  schedule: rule.schedule,
  status: rule.status,
  terminalBehavior: rule.terminalBehavior,
  updatedAt: rule.updatedAt,
  version: rule.version,
});

const careEventValues = (event: CareEvent) => ({
  acknowledgementDeadline: event.acknowledgementDeadline,
  acknowledgedAt: event.acknowledgedAt,
  careRuleId: event.careRuleId,
  closedAt: event.closedAt,
  createdAt: event.createdAt,
  escalatedAt: event.escalatedAt,
  escalationLevel: event.escalationLevel,
  handledAt: event.handledAt,
  id: event.id,
  notifiedAt: event.notifiedAt,
  occurrenceKey: event.occurrenceKey,
  scheduledFor: event.scheduledFor,
  spaceId: event.spaceId,
  state: event.state,
  subjectId: event.subjectId,
  timedOutAt: event.timedOutAt,
  unresolvedAt: event.unresolvedAt,
  updatedAt: event.updatedAt,
  version: event.version,
});

const careEventUpdate = (event: CareEvent) => {
  const { careRuleId, createdAt, id, occurrenceKey, scheduledFor, spaceId, subjectId, ...update } =
    careEventValues(event);
  void careRuleId;
  void createdAt;
  void id;
  void occurrenceKey;
  void scheduledFor;
  void spaceId;
  void subjectId;
  return update;
};

const createTransaction = (
  transaction: DatabaseTransaction,
  actor: Actor,
): CareTransaction => ({
  appendAuditEntry: async (rawAuditEntry) => {
    const auditEntry = AuditEntrySchema.parse(rawAuditEntry);
    await transaction.insert(auditLogs).values({
      ...actorColumns(actor),
      ...visibilityColumns(auditEntry.visibility),
      action: auditEntry.action,
      afterVersion: auditEntry.afterVersion,
      beforeVersion: auditEntry.beforeVersion,
      changes: [...auditEntry.changes],
      id: auditEntry.id,
      occurredAt: auditEntry.occurredAt,
      spaceId: actor.spaceId,
      targetId: auditEntry.targetId,
      targetType: auditEntry.targetType,
    });
  },
  areMembersActive: async (memberIds) => {
    const uniqueMemberIds = [...new Set(memberIds)];
    if (uniqueMemberIds.length === 0) {
      return true;
    }
    const activeMembers = await transaction
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.spaceId, actor.spaceId),
          eq(members.status, "active"),
          inArray(members.id, uniqueMemberIds),
        ),
      );
    return activeMembers.length === uniqueMemberIds.length;
  },
  getCareEventForUpdate: async (careEventId) => {
    const [row] = await transaction
      .select()
      .from(careEvents)
      .where(
        and(
          eq(careEvents.spaceId, actor.spaceId),
          eq(careEvents.id, careEventId),
        ),
      )
      .for("update")
      .limit(1);
    return row === undefined ? null : parseCareEventRow(row);
  },
  getCareRuleForUpdate: async (careRuleId) => {
    const [row] = await transaction
      .select()
      .from(careRules)
      .where(
        and(
          eq(careRules.spaceId, actor.spaceId),
          eq(careRules.id, careRuleId),
        ),
      )
      .for("update")
      .limit(1);
    return row === undefined ? null : parseCareRuleRow(row);
  },
  insertCareEvent: async (careEvent) => {
    const parsed = CareEventSchema.parse(careEvent);
    const inserted = await transaction
      .insert(careEvents)
      .values(careEventValues(parsed))
      .onConflictDoNothing()
      .returning({ id: careEvents.id });
    if (inserted.length === 1) {
      return "created";
    }
    const [existing] = await transaction
      .select({ id: careEvents.id })
      .from(careEvents)
      .where(
        and(
          eq(careEvents.spaceId, actor.spaceId),
          eq(careEvents.careRuleId, parsed.careRuleId),
          eq(careEvents.occurrenceKey, parsed.occurrenceKey),
        ),
      )
      .for("update")
      .limit(1);
    if (existing === undefined) {
      return throwCareOperationError("conflict");
    }
    return "existing";
  },
  isEvidenceAvailable: async (evidenceId) => {
    const [row] = await transaction
      .select({ id: evidence.id })
      .from(evidence)
      .where(
        and(
          eq(evidence.spaceId, actor.spaceId),
          eq(evidence.id, evidenceId),
          eq(evidence.state, "available"),
        ),
      )
      .limit(1);
    return row !== undefined;
  },
  listCareEventsForUpdate: async () => {
    const rows = await transaction
      .select()
      .from(careEvents)
      .where(eq(careEvents.spaceId, actor.spaceId))
      .orderBy(asc(careEvents.scheduledFor), asc(careEvents.id))
      .for("update");
    return rows.map((row) => parseCareEventRow(row));
  },
  listCareRulesForUpdate: async () => {
    const rows = await transaction
      .select()
      .from(careRules)
      .where(eq(careRules.spaceId, actor.spaceId))
      .orderBy(asc(careRules.id))
      .for("update");
    return rows.map((row) => parseCareRuleRow(row));
  },
  saveCareEvent: async (careEvent, expectedVersion) => {
    const parsed = CareEventSchema.parse(careEvent);
    const updated = await transaction
      .update(careEvents)
      .set(careEventUpdate(parsed))
      .where(
        and(
          eq(careEvents.spaceId, actor.spaceId),
          eq(careEvents.id, parsed.id),
          eq(careEvents.version, expectedVersion),
        ),
      )
      .returning({ id: careEvents.id });
    if (updated.length !== 1) {
      return throwCareOperationError("stale_version");
    }
  },
  saveCareRule: async (careRule, expectedVersion) => {
    const parsed = CareRuleSchema.parse(careRule);
    const updated = await transaction
      .update(careRules)
      .set(careRuleUpdate(parsed))
      .where(
        and(
          eq(careRules.spaceId, actor.spaceId),
          eq(careRules.id, parsed.id),
          eq(careRules.version, expectedVersion),
        ),
      )
      .returning({ id: careRules.id });
    if (updated.length !== 1) {
      return throwCareOperationError("stale_version");
    }
  },
});

const executeIdempotent = async <Result>(
  database: Database,
  input: IdempotentExecutionInput<Result>,
): Promise<IdempotentExecution<Result>> => {
  const actor = ActorSchema.parse(input.actor);
  try {
    return await database.transaction(async (transaction) => {
      const scopedActorKey = actorKey(actor);
      const recordId = deterministicUuid(
        `care-idempotency:${actor.spaceId}:${input.operation}:${scopedActorKey}:${input.idempotencyKey}`,
      );
      const inserted = await transaction
        .insert(idempotencyRecords)
        .values({
          ...actorColumns(actor),
          actorKey: scopedActorKey,
          claimedAt: input.claimedAt,
          id: recordId,
          idempotencyKey: input.idempotencyKey,
          operation: input.operation,
          requestHash: input.requestHash,
          spaceId: actor.spaceId,
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyRecords.id });

      if (inserted.length === 0) {
        const [existing] = await transaction
          .select({
            requestHash: idempotencyRecords.requestHash,
            result: idempotencyRecords.result,
            state: idempotencyRecords.state,
          })
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.spaceId, actor.spaceId),
              eq(idempotencyRecords.operation, input.operation),
              eq(idempotencyRecords.actorKey, scopedActorKey),
              eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing === undefined) {
          return throwCareOperationError("internal_failure");
        }
        if (existing.requestHash !== input.requestHash) {
          return throwCareOperationError("idempotency_conflict");
        }
        if (existing.state !== "completed" || existing.result === null) {
          return throwCareOperationError("conflict");
        }
        return { replayed: true, result: input.parseResult(existing.result) };
      }

      const result = await input.work(createTransaction(transaction, actor));
      const completed = await transaction
        .update(idempotencyRecords)
        .set({
          completedAt: input.claimedAt,
          result,
          state: "completed",
        })
        .where(
          and(
            eq(idempotencyRecords.id, recordId),
            eq(idempotencyRecords.state, "claimed"),
            eq(idempotencyRecords.requestHash, input.requestHash),
          ),
        )
        .returning({ id: idempotencyRecords.id });
      if (completed.length !== 1) {
        return throwCareOperationError("internal_failure");
      }
      return { replayed: false, result };
    });
  } catch (error) {
    if (isCareOperationError(error)) {
      throw error;
    }
    throw careOperationError("internal_failure");
  }
};

export const createPostgresCareRepository = (
  database: Database,
): CareRepository => ({
  executeIdempotent: <Result>(input: IdempotentExecutionInput<Result>) =>
    executeIdempotent(database, input),
});
