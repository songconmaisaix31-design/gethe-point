import { and, eq, sql } from "drizzle-orm";
import type {
  Database,
  DatabaseTransaction,
} from "../../../../../packages/db/src/index";
import {
  auditLogs,
  careEvents,
  careRules,
  consentDecisions,
  conversationMembers,
  conversations,
  domainEvidence,
  domains,
  evidence,
  handovers,
  idempotencyRecords,
  members,
  messages,
  reminders,
  signalDraftEvidence,
  signalDrafts,
  signalEvidence,
  signals,
  spaces,
  taskEvidence,
  tasks,
} from "../../../../../packages/db/src/index";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import {
  MvpCoreSnapshotSchema,
  type MvpCoreSnapshot,
} from "../../../../../packages/testkit/src/integration-seam";
import {
  MvpCoreHandoverSchema,
  MvpCoreResponsibilityReportReceiptSchema,
  type MvpCoreDomain,
  type MvpCoreHandover,
  type MvpCoreSharedVisibility,
  type MvpCoreSpace,
  type MvpCoreTask,
  type MvpCoreResponsibilityMember,
} from "./contract-projections";

export const FIXTURE_RESPONSIBILITY_OPERATION =
  "FixtureCreateResponsibility" as const;
export const FIXTURE_REPORT_OPERATION = "FixtureGenerateReport" as const;
export const FIXTURE_REPORT_KEY = "mvp-core-report-canonical-v1" as const;

export const FixtureReportReceiptSchema =
  MvpCoreResponsibilityReportReceiptSchema;

const FIXTURE_LOCK_ID = 821_470_013;

export const lockMvpCoreTransaction = async (
  tx: DatabaseTransaction,
): Promise<void> => {
  await tx.execute(sql`select pg_advisory_xact_lock(${FIXTURE_LOCK_ID})`);
};

export const toTimestamp = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("A persisted Local Fixture timestamp is invalid.");
  }
  return timestamp.toISOString();
};

/**
 * Preserve the frozen Fixture representation only after the persisted instant
 * has been proven equivalent. The deterministic Fixture provider compares the
 * canonical graph byte-for-byte, while PostgreSQL normalizes time-zone text.
 */
export const canonicalFixtureTimestamp = (
  value: string,
  expected: string,
): string => {
  if (Date.parse(value) !== Date.parse(expected)) {
    throw new Error("A persisted Local Fixture timestamp does not match its canonical instant.");
  }
  return expected;
};

export const visibilityFromColumns = (
  kind: "self" | "space" | "members" | "care_related",
  memberIds: readonly string[],
  subjectId: string | null,
): MvpCoreSharedVisibility => {
  if (kind === "self") {
    throw new Error("A shared Local Fixture row cannot use self visibility.");
  }

  if (kind === "space") {
    return { kind: "space" };
  }

  if (kind === "members") {
    if (memberIds.length === 0) {
      throw new Error("A member-visible Local Fixture row needs a member.");
    }
    return {
      kind: "members",
      memberIds: [...memberIds],
    };
  }

  if (memberIds.length === 0 || subjectId === null) {
    throw new Error("A care-visible Local Fixture row is incomplete.");
  }
  return {
    kind: "care_related",
    memberIds: [...memberIds],
    subjectId,
  };
};

export const spaceFromRow = (
  row: typeof spaces.$inferSelect,
): MvpCoreSpace => ({
    createdAt: toTimestamp(row.createdAt),
    createdBy: row.createdBy,
    id: row.id,
    name: row.name,
    spaceId: row.id,
    status: row.status,
    updatedAt: toTimestamp(row.updatedAt),
    version: row.version,
  });

export const memberFromRow = (
  row: typeof members.$inferSelect,
): MvpCoreResponsibilityMember => ({
    analysisConsent: row.analysisConsent,
    createdAt: toTimestamp(row.createdAt),
    displayName: row.displayName,
    id: row.id,
    joinedAt: toTimestamp(row.joinedAt),
    role: row.role,
    spaceId: row.spaceId,
    status: row.status,
    updatedAt: toTimestamp(row.updatedAt),
    version: row.version,
  });

export const domainFromRow = (
  row: typeof domains.$inferSelect,
  evidenceIds: readonly string[],
): MvpCoreDomain => ({
    createdAt: toTimestamp(row.createdAt),
    evidenceIds: [...evidenceIds],
    id: row.id,
    name: row.name,
    nextAction: row.nextAction,
    ownerId: row.ownerId,
    spaceId: row.spaceId,
    status: row.status,
    updatedAt: toTimestamp(row.updatedAt),
    version: row.version,
    visibility: visibilityFromColumns(
      row.visibilityKind,
      row.visibilityMemberIds,
      row.visibilitySubjectId,
    ),
  });

export const taskFromRow = (
  row: typeof tasks.$inferSelect,
  evidenceIds: readonly string[],
): MvpCoreTask => ({
    createdAt: toTimestamp(row.createdAt),
    deadlineKeptBy: row.deadlineKeptBy,
    discoveredBy: row.discoveredBy,
    domainId: row.domainId,
    dueAt: row.dueAt === null ? null : toTimestamp(row.dueAt),
    evidenceIds: [...evidenceIds],
    executedBy: row.executedBy,
    followedUpBy: row.followedUpBy,
    id: row.id,
    reviewState: row.reviewState,
    scheduledBy: row.scheduledBy,
    spaceId: row.spaceId,
    status: row.status,
    title: row.title,
    updatedAt: toTimestamp(row.updatedAt),
    version: row.version,
    visibility: visibilityFromColumns(
      row.visibilityKind,
      row.visibilityMemberIds,
      row.visibilitySubjectId,
    ),
  });

export const handoverFromRow = (
  row: typeof handovers.$inferSelect,
): MvpCoreHandover =>
  MvpCoreHandoverSchema.parse({
    acceptedAt:
      row.acceptedAt === null ? null : toTimestamp(row.acceptedAt),
    createdAt: toTimestamp(row.createdAt),
    declineReason: row.declineReason,
    declinedBy: row.declinedBy,
    domainId: row.domainId,
    expiresAt: toTimestamp(row.expiresAt),
    fromConfirmedAt:
      row.fromConfirmedAt === null
        ? null
        : toTimestamp(row.fromConfirmedAt),
    fromMemberId: row.fromMemberId,
    id: row.id,
    missingInfo: row.missingInfo,
    packet: row.packet,
    spaceId: row.spaceId,
    status: row.status,
    terminalAt:
      row.terminalAt === null ? null : toTimestamp(row.terminalAt),
    toConfirmedAt:
      row.toConfirmedAt === null ? null : toTimestamp(row.toConfirmedAt),
    toMemberId: row.toMemberId,
    updatedAt: toTimestamp(row.updatedAt),
    version: row.version,
  });

const seedMvpCore = async (tx: DatabaseTransaction): Promise<void> => {
  const fixture = MVP_CORE_FIXTURE;
  const domain = fixture.responsibility.domain;
  const task = fixture.responsibility.task;
  const privateMessage = fixture.privateConversation.message;
  const draft = fixture.privateConversation.derivedDraft;
  const blocked = fixture.handover.blocked;

  await tx.insert(spaces).values({
    createdAt: fixture.space.createdAt,
    createdBy: fixture.space.createdBy,
    id: fixture.space.id,
    name: fixture.space.name,
    status: fixture.space.status,
    updatedAt: fixture.space.updatedAt,
    version: fixture.space.version,
  });
  await tx.insert(members).values(
    fixture.members.map((member) => ({
      analysisConsent: member.analysisConsent,
      createdAt: member.createdAt,
      displayName: member.displayName,
      id: member.id,
      joinedAt: member.joinedAt,
      role: member.role,
      spaceId: member.spaceId,
      status: member.status,
      updatedAt: member.updatedAt,
      version: member.version,
    })),
  );
  await tx.insert(conversations).values({
    createdAt: fixture.privateConversation.conversation.createdAt,
    id: fixture.privateConversation.conversation.id,
    spaceId: fixture.privateConversation.conversation.spaceId,
    type: fixture.privateConversation.conversation.type,
    updatedAt: fixture.privateConversation.conversation.updatedAt,
    version: fixture.privateConversation.conversation.version,
  });
  await tx.insert(conversationMembers).values({
    conversationId: fixture.privateConversation.conversation.id,
    memberId: fixture.actors.subject.memberId,
    spaceId: fixture.space.id,
  });
  await tx.insert(messages).values({
    authorId: privateMessage.authorId,
    clientMessageId: privateMessage.clientMessageId,
    content: privateMessage.content,
    conversationId: privateMessage.conversationId,
    createdAt: privateMessage.createdAt,
    id: privateMessage.id,
    occurredAt: privateMessage.occurredAt,
    spaceId: privateMessage.spaceId,
    updatedAt: privateMessage.updatedAt,
    version: privateMessage.version,
    visibleToMemberId: privateMessage.visibility.memberId,
  });
  await tx.insert(evidence).values({
    createdAt: fixture.privateConversation.consentDecision.createdAt,
    id: fixture.privateConversation.derivedDraft.evidenceIds[0],
    occurredAt: privateMessage.occurredAt,
    rawRef: "device://fixture/evidence-1",
    sourceMessageId: privateMessage.id,
    sourceType: "agent_dm",
    spaceId: fixture.space.id,
    speakerId: fixture.actors.subject.memberId,
    state: "available",
    updatedAt: fixture.eventTimeline.consentedAt,
    version: 0,
    visibleToMemberId: fixture.actors.subject.memberId,
  });
  await tx.insert(domains).values({
    createdAt: domain.createdAt,
    futureTaskOwnerId: fixture.actors.primary.memberId,
    id: domain.id,
    name: domain.name,
    nextAction: domain.nextAction,
    ownerId: domain.ownerId,
    spaceId: domain.spaceId,
    status: domain.status,
    updatedAt: domain.updatedAt,
    version: domain.version,
    visibilityKind: "space",
    visibilityMemberIds: [],
    visibilitySubjectId: null,
  });
  await tx.insert(signalDrafts).values({
    candidateDomainId: draft.candidateDomainId,
    confidence: draft.confidence,
    createdAt: draft.createdAt,
    id: draft.id,
    kind: draft.kind,
    missingInfo: [...draft.missingInfo],
    promptVersion: draft.promptVersion,
    proposedConclusion: draft.proposedConclusion,
    redactedExcerpt: draft.redactedExcerpt,
    source: draft.source,
    sourceMessageId: draft.sourceMessageId,
    spaceId: draft.spaceId,
    speakerId: draft.speakerId,
    updatedAt: draft.updatedAt,
    version: draft.version,
  });
  await tx.insert(signalDraftEvidence).values({
    evidenceId: fixture.privateConversation.derivedDraft.evidenceIds[0],
    signalDraftId: draft.id,
    spaceId: fixture.space.id,
  });
  await tx.insert(domainEvidence).values({
    domainId: domain.id,
    evidenceId: domain.evidenceIds[0],
    spaceId: fixture.space.id,
  });
  await tx.insert(tasks).values({
    createdAt: task.createdAt,
    deadlineKeptBy: task.deadlineKeptBy,
    discoveredBy: task.discoveredBy,
    domainId: task.domainId,
    dueAt: task.dueAt,
    executedBy: task.executedBy,
    followedUpBy: task.followedUpBy,
    id: task.id,
    reviewState: task.reviewState,
    scheduledBy: task.scheduledBy,
    spaceId: task.spaceId,
    status: task.status,
    title: task.title,
    updatedAt: task.updatedAt,
    version: task.version,
    visibilityKind: "space",
    visibilityMemberIds: [],
    visibilitySubjectId: null,
  });
  await tx.insert(taskEvidence).values({
    evidenceId: task.evidenceIds[0],
    spaceId: fixture.space.id,
    taskId: task.id,
  });
  await tx.insert(reminders).values({
    createdAt: fixture.eventTimeline.createdAt,
    domainId: fixture.reminder.domainId,
    dueAt: fixture.reminder.scheduledFor,
    id: fixture.reminder.id,
    idempotencyKey: "mvp-core-reminder-0001",
    ownerMemberId: fixture.reminder.initialOwnerId,
    spaceId: fixture.space.id,
    status: fixture.reminder.status,
    taskId: task.id,
    updatedAt: fixture.eventTimeline.createdAt,
    version: 0,
  });
  const handoverSeed = {
    acceptedAt: null,
    createdAt: blocked.createdAt,
    declineReason: null,
    declinedBy: null,
    domainId: blocked.domainId,
    expiresAt: blocked.expiresAt,
    fromConfirmedAt: null,
    fromMemberId: blocked.fromMemberId,
    id: blocked.id,
    missingInfo: blocked.missingInfo.map((item) => ({ ...item })),
    packet: {
      constraints: [...blocked.packet.constraints],
      contacts: blocked.packet.contacts.map((contact) => ({ ...contact })),
      evidenceIds: [...blocked.packet.evidenceIds],
      history: [...blocked.packet.history],
      knownInformation: [...blocked.packet.knownInformation],
      nextAction: blocked.packet.nextAction,
      scope: blocked.packet.scope,
    },
    spaceId: blocked.spaceId,
    status: "blocked",
    terminalAt: null,
    toConfirmedAt: null,
    toMemberId: blocked.toMemberId,
    updatedAt: blocked.updatedAt,
    version: 1,
  } satisfies typeof handovers.$inferInsert;
  await tx.insert(handovers).values(handoverSeed);
};

export const resetMvpCoreDatabase = async (
  database: Database,
): Promise<void> => {
  await database.transaction(async (tx) => {
    await lockMvpCoreTransaction(tx);
    const spaceId = MVP_CORE_FIXTURE.space.id;
    // Restricting cross-entity references protect evidence and members from an
    // unsafe cascade. Reset only the isolated Fixture space, child-first.
    await tx.delete(auditLogs).where(eq(auditLogs.spaceId, spaceId));
    await tx
      .delete(idempotencyRecords)
      .where(eq(idempotencyRecords.spaceId, spaceId));
    await tx.delete(careEvents).where(eq(careEvents.spaceId, spaceId));
    await tx.delete(careRules).where(eq(careRules.spaceId, spaceId));
    await tx.delete(reminders).where(eq(reminders.spaceId, spaceId));
    await tx
      .delete(signalEvidence)
      .where(eq(signalEvidence.spaceId, spaceId));
    await tx.delete(taskEvidence).where(eq(taskEvidence.spaceId, spaceId));
    await tx
      .delete(domainEvidence)
      .where(eq(domainEvidence.spaceId, spaceId));
    await tx.delete(signals).where(eq(signals.spaceId, spaceId));
    await tx
      .delete(consentDecisions)
      .where(eq(consentDecisions.spaceId, spaceId));
    await tx
      .delete(signalDraftEvidence)
      .where(eq(signalDraftEvidence.spaceId, spaceId));
    await tx.delete(handovers).where(eq(handovers.spaceId, spaceId));
    await tx.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await tx.delete(signalDrafts).where(eq(signalDrafts.spaceId, spaceId));
    await tx.delete(domains).where(eq(domains.spaceId, spaceId));
    await tx.delete(evidence).where(eq(evidence.spaceId, spaceId));
    await tx.delete(messages).where(eq(messages.spaceId, spaceId));
    await tx
      .delete(conversationMembers)
      .where(eq(conversationMembers.spaceId, spaceId));
    await tx.delete(conversations).where(eq(conversations.spaceId, spaceId));
    // Deleting the space removes members through the space_id cascade. An
    // explicit member delete would trip spaces_created_by_fk (RESTRICT).
    await tx.delete(spaces).where(eq(spaces.id, spaceId));
    await seedMvpCore(tx);
  });
};

export const ensureMvpCoreDatabase = async (
  database: Database,
): Promise<void> => {
  await database.transaction(async (tx) => {
    await lockMvpCoreTransaction(tx);
    const [existing] = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, MVP_CORE_FIXTURE.space.id))
      .limit(1);
    if (existing === undefined) {
      await seedMvpCore(tx);
    }
  });
};

const requireOne = <Value>(
  values: readonly Value[],
  label: string,
): Value => {
  const value = values[0];
  if (value === undefined || values.length !== 1) {
    throw new Error(`The Local Fixture ${label} invariant is unavailable.`);
  }
  return value;
};

export const initialMvpCoreSnapshot = (): MvpCoreSnapshot =>
  MvpCoreSnapshotSchema.parse({
    consent: "pending",
    domainOwnerId: MVP_CORE_FIXTURE.responsibility.domain.ownerId,
    futureReminderCount: 1,
    handover: {
      fromConfirmed: false,
      status: "blocked",
      toConfirmed: false,
    },
    reminderOwnerId: MVP_CORE_FIXTURE.reminder.initialOwnerId,
    reportRows: 0,
    responsibilityOwners: MVP_CORE_FIXTURE.responsibility.stageOwners,
    revision: 0,
    scenarioId: MVP_CORE_FIXTURE.scenarioId,
    sharedRows: 0,
    sharedWriteCount: 0,
    writeCount: 0,
  });

export const readMvpCoreSnapshotFromTransaction = async (
  tx: DatabaseTransaction,
): Promise<MvpCoreSnapshot> => {
  const spaceId = MVP_CORE_FIXTURE.space.id;
  const consentRows = await tx
    .select()
    .from(consentDecisions)
    .where(eq(consentDecisions.spaceId, spaceId));
  const signalRows = await tx
    .select()
    .from(signals)
    .where(eq(signals.spaceId, spaceId));
  const taskRows = await tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.spaceId, spaceId),
        eq(tasks.id, MVP_CORE_FIXTURE.responsibility.task.id),
      ),
    );
  const domainRows = await tx
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.spaceId, spaceId),
        eq(domains.id, MVP_CORE_FIXTURE.responsibility.domain.id),
      ),
    );
  const handoverRows = await tx
    .select()
    .from(handovers)
    .where(
      and(
        eq(handovers.spaceId, spaceId),
        eq(handovers.id, MVP_CORE_FIXTURE.handover.blocked.id),
      ),
    );
  const reminderRows = await tx
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.spaceId, spaceId),
        eq(reminders.domainId, MVP_CORE_FIXTURE.responsibility.domain.id),
        eq(reminders.status, "active"),
      ),
    );
  const reportRows = await tx
    .select({ result: idempotencyRecords.result })
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.spaceId, spaceId),
        eq(idempotencyRecords.operation, FIXTURE_REPORT_OPERATION),
        eq(idempotencyRecords.idempotencyKey, FIXTURE_REPORT_KEY),
        eq(idempotencyRecords.state, "completed"),
      ),
    );

  const task = requireOne(taskRows, "task");
  const domain = requireOne(domainRows, "domain");
  const handover = requireOne(handoverRows, "handover");
  const reminder = requireOne(reminderRows, "active reminder");
  const consent = consentRows[0];
  if (consentRows.length > 1 || signalRows.length > 1) {
    throw new Error("The Local Fixture cardinality invariant is unavailable.");
  }

  const reportReceipt =
    reportRows[0] === undefined
      ? undefined
      : FixtureReportReceiptSchema.parse(reportRows[0].result);
  const consentState =
    consent === undefined
      ? "pending"
      : consent.outcome === "share"
        ? "shared"
        : "discarded";
  const handoverWrites = Math.max(0, handover.version - 1);
  const writeCount =
    (consent === undefined ? 0 : 1) +
    signalRows.length +
    (reportReceipt === undefined ? 0 : 1) +
    handoverWrites;

  return MvpCoreSnapshotSchema.parse({
    consent: consentState,
    domainOwnerId: domain.ownerId,
    futureReminderCount: 1,
    handover: {
      fromConfirmed: handover.fromConfirmedAt !== null,
      status: handover.status,
      toConfirmed: handover.toConfirmedAt !== null,
    },
    reminderOwnerId: reminder.ownerMemberId,
    reportRows: reportReceipt === undefined ? 0 : 5,
    responsibilityOwners: {
      deadlineKeptBy: task.deadlineKeptBy,
      discoveredBy: task.discoveredBy,
      executedBy: task.executedBy,
      followedUpBy: task.followedUpBy,
      scheduledBy: task.scheduledBy,
    },
    revision: writeCount,
    scenarioId: MVP_CORE_FIXTURE.scenarioId,
    sharedRows: signalRows.length,
    sharedWriteCount: signalRows.length,
    writeCount,
  });
};

export const readMvpCoreSnapshot = async (
  database: Database,
): Promise<MvpCoreSnapshot> =>
  database.transaction(
    (tx) => readMvpCoreSnapshotFromTransaction(tx),
    { isolationLevel: "repeatable read" },
  );

/**
 * Reads rejection state without bootstrapping the Fixture. A valid session may
 * already have progressed to rN, so returning an unconditional r0 snapshot
 * would make the accepted client regress even though the rejected command made
 * no write.
 */
export const readMvpCoreSnapshotIfPresent = async (
  database: Database,
): Promise<MvpCoreSnapshot> =>
  database.transaction(
    async (tx) => {
      const [fixtureSpace] = await tx
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.id, MVP_CORE_FIXTURE.space.id))
        .limit(1);
      return fixtureSpace === undefined
        ? initialMvpCoreSnapshot()
        : readMvpCoreSnapshotFromTransaction(tx);
    },
    { isolationLevel: "repeatable read" },
  );
