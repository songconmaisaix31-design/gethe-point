import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  type Database,
  type DatabaseTransaction,
  domains,
  handovers,
  idempotencyRecords,
} from "../../../../../packages/db/src/index";
import {
  createDatabaseHandoverAcceptancePort,
  createHandoverError,
  createHandoverService,
  type HandoverStateMutationInput,
  type HandoverStatePort,
} from "../../../../../modules/handover/src/index";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import {
  MvpCoreHandoverMutationResultSchema,
  type MvpCoreHandover,
  type MvpCoreMemberActor,
} from "./contract-projections";
import { handoverFromRow, lockMvpCoreTransaction } from "./persistence";

const EntityIdSchema = z.uuid();

const memberIdFromActorKey = (actorKey: string): string => {
  const parsed = EntityIdSchema.safeParse(
    actorKey.startsWith("member:") ? actorKey.slice("member:".length) : null,
  );
  if (!parsed.success) {
    throw createHandoverError("forbidden");
  }
  return parsed.data;
};

const replayFor = async (
  tx: DatabaseTransaction,
  input: HandoverStateMutationInput,
) => {
  const [existing] = await tx
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.spaceId, input.spaceId),
        eq(idempotencyRecords.operation, input.operation),
        eq(idempotencyRecords.actorKey, input.actorKey),
        eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing === undefined) {
    return undefined;
  }
  if (existing.requestHash !== input.requestHash) {
    throw createHandoverError("idempotency_conflict");
  }
  if (existing.state !== "completed") {
    throw createHandoverError("conflict");
  }
  return MvpCoreHandoverMutationResultSchema.parse(existing.result);
};

const handoverUpdate = (handover: MvpCoreHandover) => ({
  acceptedAt: handover.acceptedAt,
  declineReason: handover.declineReason,
  declinedBy: handover.declinedBy,
  expiresAt: handover.expiresAt,
  fromConfirmedAt: handover.fromConfirmedAt,
  missingInfo: handover.missingInfo.map((item) => ({ ...item })),
  packet: {
    constraints: [...handover.packet.constraints],
    contacts: handover.packet.contacts.map((contact) => ({ ...contact })),
    evidenceIds: [...handover.packet.evidenceIds],
    history: [...handover.packet.history],
    knownInformation: [...handover.packet.knownInformation],
    nextAction: handover.packet.nextAction,
    scope: handover.packet.scope,
  },
  status: handover.status,
  terminalAt: handover.terminalAt,
  toConfirmedAt: handover.toConfirmedAt,
  updatedAt: handover.updatedAt,
  version: handover.version,
});

const transition = async (
  database: Database,
  input: HandoverStateMutationInput,
  plan: Parameters<HandoverStatePort["transition"]>[1],
) =>
  database.transaction(async (tx) => {
    await lockMvpCoreTransaction(tx);
    const replay = await replayFor(tx, input);
    if (replay !== undefined) {
      return replay;
    }

    const actorMemberId = memberIdFromActorKey(input.actorKey);
    await tx.insert(idempotencyRecords).values({
      actorKey: input.actorKey,
      actorKind: "member",
      actorMemberId,
      actorService: null,
      claimedAt: MVP_CORE_FIXTURE.eventTimeline.createdAt,
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      operation: input.operation,
      requestHash: input.requestHash,
      spaceId: input.spaceId,
      state: "claimed",
    });

    const [row] = await tx
      .select()
      .from(handovers)
      .where(
        and(
          eq(handovers.spaceId, input.spaceId),
          eq(handovers.id, input.handoverId),
        ),
      )
      .for("update")
      .limit(1);
    const current = row === undefined ? null : handoverFromRow(row);
    const planned = plan(current);
    const result = MvpCoreHandoverMutationResultSchema.parse(planned.result);
    const next = planned.handover;
    if (
      current?.version !== input.expectedVersion ||
      next.id !== input.handoverId ||
      next.spaceId !== input.spaceId ||
      next.version !== current.version + 1
    ) {
      throw createHandoverError("stale_version");
    }

    const updated = await tx
      .update(handovers)
      .set(handoverUpdate(next))
      .where(
        and(
          eq(handovers.spaceId, input.spaceId),
          eq(handovers.id, input.handoverId),
          eq(handovers.version, input.expectedVersion),
        ),
      )
      .returning({ id: handovers.id });
    if (updated.length !== 1) {
      throw createHandoverError("stale_version");
    }

    const completed = await tx
      .update(idempotencyRecords)
      .set({
        completedAt: next.updatedAt,
        result,
        state: "completed",
      })
      .where(
        and(
          eq(idempotencyRecords.spaceId, input.spaceId),
          eq(idempotencyRecords.operation, input.operation),
          eq(idempotencyRecords.actorKey, input.actorKey),
          eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          eq(idempotencyRecords.requestHash, input.requestHash),
          eq(idempotencyRecords.state, "claimed"),
        ),
      )
      .returning({ id: idempotencyRecords.id });
    if (completed.length !== 1) {
      throw createHandoverError("internal_failure");
    }
    return result;
  });

export const createDatabaseHandoverStatePort = (
  database: Database,
): HandoverStatePort => ({
  getById: ({ handoverId, spaceId }) =>
    database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(handovers)
        .where(
          and(eq(handovers.spaceId, spaceId), eq(handovers.id, handoverId)),
        )
        .limit(1);
      return row === undefined ? null : handoverFromRow(row);
    }),
  propose: () => Promise.reject(createHandoverError("transition_denied")),
  transition: (input, plan) => transition(database, input, plan),
});

const handoverService = (database: Database, now: string) =>
  createHandoverService({
    acceptance: createDatabaseHandoverAcceptancePort(database),
    clock: { now: () => new Date(now) },
    state: createDatabaseHandoverStatePort(database),
  });

export const getCanonicalHandover = async (
  database: Database,
): Promise<MvpCoreHandover> => {
  const handover = await createDatabaseHandoverStatePort(database).getById({
    handoverId: MVP_CORE_FIXTURE.handover.blocked.id,
    spaceId: MVP_CORE_FIXTURE.space.id,
  });
  if (handover === null) {
    throw createHandoverError("not_found");
  }
  return handover;
};

const acceptIfReady = async (
  database: Database,
  handover: MvpCoreHandover,
): Promise<MvpCoreHandover> => {
  if (handover.status === "accepted") {
    return handover;
  }
  if (
    handover.status !== "awaiting_confirmations" ||
    handover.fromConfirmedAt === null ||
    handover.toConfirmedAt === null
  ) {
    return handover;
  }

  const [domain] = await database
    .select({ version: domains.version })
    .from(domains)
    .where(
      and(
        eq(domains.spaceId, handover.spaceId),
        eq(domains.id, handover.domainId),
      ),
    )
    .limit(1);
  if (domain === undefined) {
    throw createHandoverError("not_found");
  }

  await handoverService(
    database,
    MVP_CORE_FIXTURE.eventTimeline.acceptedAt,
  ).accept(MVP_CORE_FIXTURE.actors.handoverService, {
    expectedDomainVersion: domain.version,
    expectedHandoverVersion: handover.version,
    handoverId: handover.id,
    idempotencyKey: "mvp-core-accept-handover-v1",
    requestId: MVP_CORE_FIXTURE.ids.request,
  });
  return getCanonicalHandover(database);
};

export const supplyCanonicalHandoverInformation = async (
  database: Database,
  actor: MvpCoreMemberActor,
): Promise<MvpCoreHandover> => {
  const current = await getCanonicalHandover(database);
  if (current.status === "awaiting_confirmations") {
    return current;
  }
  const result = await handoverService(
    database,
    MVP_CORE_FIXTURE.privateConversation.consentDecision.updatedAt,
  ).supplyInformation(actor, {
    expectedVersion: current.version,
    handoverId: current.id,
    idempotencyKey: "mvp-core-supply-info-v1",
    requestId: MVP_CORE_FIXTURE.ids.request,
    resolvedItems: [MVP_CORE_FIXTURE.handover.supplyAction.resolvedItem],
  });
  return result.handover;
};

export const confirmCanonicalHandoverFrom = async (
  database: Database,
  actor: MvpCoreMemberActor,
): Promise<MvpCoreHandover> => {
  const current = await getCanonicalHandover(database);
  if (current.fromConfirmedAt !== null) {
    return acceptIfReady(database, current);
  }
  const result = await handoverService(
    database,
    MVP_CORE_FIXTURE.eventTimeline.fromConfirmedAt,
  ).confirmFrom(actor, {
    confirmedAt: MVP_CORE_FIXTURE.eventTimeline.fromConfirmedAt,
    expectedVersion: current.version,
    handoverId: current.id,
    idempotencyKey: "mvp-core-confirm-from-v1",
    requestId: MVP_CORE_FIXTURE.ids.request,
  });
  return acceptIfReady(database, result.handover);
};

export const confirmCanonicalHandoverTo = async (
  database: Database,
  actor: MvpCoreMemberActor,
): Promise<MvpCoreHandover> => {
  const current = await getCanonicalHandover(database);
  if (current.toConfirmedAt !== null) {
    return acceptIfReady(database, current);
  }
  const result = await handoverService(
    database,
    MVP_CORE_FIXTURE.eventTimeline.toConfirmedAt,
  ).confirmTo(actor, {
    confirmedAt: MVP_CORE_FIXTURE.eventTimeline.toConfirmedAt,
    expectedVersion: current.version,
    handoverId: current.id,
    idempotencyKey: "mvp-core-confirm-to-v1",
    requestId: MVP_CORE_FIXTURE.ids.request,
  });
  return acceptIfReady(database, result.handover);
};
