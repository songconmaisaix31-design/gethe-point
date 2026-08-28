import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, eq } from "drizzle-orm";

import {
  type Database,
  type DatabaseTransaction,
  consentDecisions,
  domainEvidence,
  domains,
  evidence,
  idempotencyRecords,
  members,
  signalDraftEvidence,
  signalDrafts,
  signalEvidence,
  signals,
  spaces,
  taskEvidence,
  tasks,
} from "../../../../../packages/db/src/index";
import { createCanonicalFixtureResponsibilityDraftPort } from "../../../../../modules/ai-domain/src/index";
import {
  createResponsibilityError,
  createResponsibilityService,
  ResponsibilityCreationCommandSchema,
  ResponsibilityCreationResultSchema,
  ResponsibilityReportSnapshotSchema,
  ResponsibilitySourceContextSchema,
  type ResponsibilityCreationCommand,
  type ResponsibilityCreationResult,
  type ResponsibilityPersistencePort,
  type ResponsibilityReportPort,
  type ResponsibilityReportSnapshot,
  type ResponsibilitySourceContext,
  type ResponsibilitySourcePort,
} from "../../../../../modules/responsibility/src/index";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import type { MvpCoreMemberActor } from "./contract-projections";
import {
  FIXTURE_REPORT_KEY,
  FIXTURE_REPORT_OPERATION,
  FIXTURE_RESPONSIBILITY_OPERATION,
  FixtureReportReceiptSchema,
  canonicalFixtureTimestamp,
  domainFromRow,
  lockMvpCoreTransaction,
  memberFromRow,
  spaceFromRow,
  taskFromRow,
  visibilityFromColumns,
} from "./persistence";

const responsibilityKey = (signalId: string): string =>
  `mvp-core-source-${signalId}`;

const hashValue = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sameValue = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(left, right);

const actorColumns = (actor: MvpCoreMemberActor) => ({
  actorKey: `member:${actor.memberId}`,
  actorKind: "member" as const,
  actorMemberId: actor.memberId,
  actorService: null,
});

const actorMatchesFixtureSession = (actor: MvpCoreMemberActor): boolean => {
  const expected = MVP_CORE_FIXTURE.actors[actor.role];
  return (
    actor.authentication === "fixture_demo" &&
    actor.memberId === expected.memberId &&
    actor.spaceId === expected.spaceId
  );
};

const idsAreExact = (
  left: readonly string[],
  right: readonly string[],
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

const canonicalMemberFromRow = (
  row: typeof members.$inferSelect,
) => {
  const expected = MVP_CORE_FIXTURE.members.find(({ id }) => id === row.id);
  if (expected === undefined) {
    throw createResponsibilityError("not_found");
  }
  return {
    analysisConsent: row.analysisConsent,
    createdAt: canonicalFixtureTimestamp(row.createdAt, expected.createdAt),
    displayName: row.displayName,
    id: row.id,
    joinedAt: canonicalFixtureTimestamp(row.joinedAt, expected.joinedAt),
    role: row.role,
    spaceId: row.spaceId,
    status: row.status,
    updatedAt: canonicalFixtureTimestamp(row.updatedAt, expected.updatedAt),
    version: row.version,
  };
};

const canonicalContextFromRows = (
  actor: MvpCoreMemberActor,
  spaceRow: typeof spaces.$inferSelect,
  memberRows: readonly (typeof members.$inferSelect)[],
  draft: typeof signalDrafts.$inferSelect,
  consent: typeof consentDecisions.$inferSelect,
  signal: typeof signals.$inferSelect,
  sourceEvidence: typeof evidence.$inferSelect,
  draftEvidenceRows: readonly (typeof signalDraftEvidence.$inferSelect)[],
  signalEvidenceRows: readonly (typeof signalEvidence.$inferSelect)[],
): ResponsibilitySourceContext => {
  const expectedSpace = MVP_CORE_FIXTURE.space;
  const expectedDraft = MVP_CORE_FIXTURE.privateConversation.derivedDraft;
  const expectedConsent = MVP_CORE_FIXTURE.privateConversation.consentDecision;
  const expectedSignal = MVP_CORE_FIXTURE.privateConversation.consentedSignal;
  const expectedEvidence = expectedSignal.provenance[0];
  const draftEvidenceIds = draftEvidenceRows.map(({ evidenceId }) => evidenceId);
  const signalEvidenceIds = signalEvidenceRows.map(({ evidenceId }) => evidenceId);

  if (
    memberRows.length !== MVP_CORE_FIXTURE.members.length ||
    consent.recordState !== "active" ||
    consent.outcome !== "share" ||
    consent.visibilityKind === null ||
    consent.expiresAt !== null ||
    consent.revokedAt !== null ||
    signalEvidenceRows.some(
      ({ signalId, spaceId }) =>
        signalId !== signal.id || spaceId !== actor.spaceId,
    ) ||
    draftEvidenceRows.some(
      ({ signalDraftId, spaceId }) =>
        signalDraftId !== draft.id || spaceId !== actor.spaceId,
    ) ||
    !idsAreExact(draftEvidenceIds, signalEvidenceIds) ||
    !idsAreExact(signalEvidenceIds, [sourceEvidence.id]) ||
    sourceEvidence.sourceMessageId !== draft.sourceMessageId ||
    sourceEvidence.visibleToMemberId !== sourceEvidence.speakerId
  ) {
    throw createResponsibilityError("consent_invalid");
  }

  const persistedMembers = memberRows
    .map(canonicalMemberFromRow)
    .sort(({ id: left }, { id: right }) => left.localeCompare(right));
  const actorMember = persistedMembers.find(({ id }) => id === actor.memberId);
  const speaker = persistedMembers.find(({ id }) => id === draft.speakerId);
  if (actorMember === undefined || speaker === undefined) {
    throw createResponsibilityError("not_found");
  }

  const context = ResponsibilitySourceContextSchema.parse({
    actorMember,
    consent: {
      createdAt: canonicalFixtureTimestamp(
        consent.createdAt,
        expectedConsent.createdAt,
      ),
      decidedAt: canonicalFixtureTimestamp(
        consent.decidedAt,
        expectedConsent.decidedAt,
      ),
      expiresAt: null,
      id: consent.id,
      outcome: "share",
      recordState: "active",
      revokedAt: null,
      signalDraftId: consent.signalDraftId,
      spaceId: consent.spaceId,
      speakerId: consent.speakerId,
      updatedAt: canonicalFixtureTimestamp(
        consent.updatedAt,
        expectedConsent.updatedAt,
      ),
      version: consent.version,
      visibility: visibilityFromColumns(
        consent.visibilityKind,
        consent.visibilityMemberIds,
        consent.visibilitySubjectId,
      ),
    },
    draft: {
      candidateDomainId: draft.candidateDomainId,
      confidence: draft.confidence,
      createdAt: canonicalFixtureTimestamp(draft.createdAt, expectedDraft.createdAt),
      evidenceIds: draftEvidenceIds,
      id: draft.id,
      kind: draft.kind,
      missingInfo: draft.missingInfo,
      promptVersion: draft.promptVersion,
      proposedConclusion: draft.proposedConclusion,
      redactedExcerpt: draft.redactedExcerpt,
      source: draft.source,
      sourceMessageId: draft.sourceMessageId,
      spaceId: draft.spaceId,
      speakerId: draft.speakerId,
      updatedAt: canonicalFixtureTimestamp(draft.updatedAt, expectedDraft.updatedAt),
      version: draft.version,
    },
    evidence: [
      {
        createdAt: canonicalFixtureTimestamp(
          sourceEvidence.createdAt,
          MVP_CORE_FIXTURE.eventTimeline.createdAt,
        ),
        id: sourceEvidence.id,
        occurredAt: canonicalFixtureTimestamp(
          sourceEvidence.occurredAt,
          expectedEvidence.occurredAt,
        ),
        rawRef: sourceEvidence.rawRef,
        sourceType: sourceEvidence.sourceType,
        spaceId: sourceEvidence.spaceId,
        speakerId: sourceEvidence.speakerId,
        state: sourceEvidence.state,
        updatedAt: canonicalFixtureTimestamp(
          sourceEvidence.updatedAt,
          MVP_CORE_FIXTURE.eventTimeline.consentedAt,
        ),
        version: sourceEvidence.version,
        visibility: {
          kind: "self",
          memberId: sourceEvidence.visibleToMemberId,
        },
      },
    ],
    members: persistedMembers,
    signal: {
      conclusion: signal.conclusion,
      consentDecisionId: signal.consentDecisionId,
      createdAt: canonicalFixtureTimestamp(signal.createdAt, expectedSignal.createdAt),
      evidenceState:
        signal.evidenceState === "available" ? "available" : "evidence_missing",
      id: signal.id,
      provenance: [
        {
          evidenceId: sourceEvidence.id,
          occurredAt: canonicalFixtureTimestamp(
            sourceEvidence.occurredAt,
            expectedEvidence.occurredAt,
          ),
          sourceType: sourceEvidence.sourceType,
          speakerId: sourceEvidence.speakerId,
          state: sourceEvidence.state,
        },
      ],
      purpose: signal.purpose,
      redactedExcerpt: signal.redactedExcerpt,
      spaceId: signal.spaceId,
      speakerId: signal.speakerId,
      updatedAt: canonicalFixtureTimestamp(signal.updatedAt, expectedSignal.updatedAt),
      version: signal.version,
      visibility: visibilityFromColumns(
        signal.visibilityKind,
        signal.visibilityMemberIds,
        signal.visibilitySubjectId,
      ),
    },
    space: {
      createdAt: canonicalFixtureTimestamp(spaceRow.createdAt, expectedSpace.createdAt),
      createdBy: spaceRow.createdBy,
      id: spaceRow.id,
      name: spaceRow.name,
      spaceId: spaceRow.id,
      status: spaceRow.status,
      updatedAt: canonicalFixtureTimestamp(spaceRow.updatedAt, expectedSpace.updatedAt),
      version: spaceRow.version,
    },
    speaker,
  });

  const expectedMembers = [...MVP_CORE_FIXTURE.members].sort(
    ({ id: left }, { id: right }) => left.localeCompare(right),
  );
  if (
    !sameValue(context.space, expectedSpace) ||
    !sameValue(context.members, expectedMembers) ||
    !sameValue(context.draft, expectedDraft) ||
    !sameValue(context.consent, expectedConsent) ||
    !sameValue(context.signal, expectedSignal)
  ) {
    throw createResponsibilityError("consent_invalid");
  }

  return context;
};

const loadCanonicalSourceContext = async (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
  sourceSignalId: string,
): Promise<ResponsibilitySourceContext | null> => {
  if (
    !actorMatchesFixtureSession(actor) ||
    sourceSignalId !== MVP_CORE_FIXTURE.privateConversation.consentedSignal.id
  ) {
    return null;
  }

  const [spaceRow] = await tx
    .select()
    .from(spaces)
    .where(eq(spaces.id, actor.spaceId))
    .limit(1);
  const memberRows = await tx
    .select()
    .from(members)
    .where(eq(members.spaceId, actor.spaceId));
  const [signal] = await tx
    .select()
    .from(signals)
    .where(
      and(eq(signals.spaceId, actor.spaceId), eq(signals.id, sourceSignalId)),
    )
    .limit(1);
  if (spaceRow === undefined || signal === undefined) {
    return null;
  }

  const [consent] = await tx
    .select()
    .from(consentDecisions)
    .where(
      and(
        eq(consentDecisions.spaceId, actor.spaceId),
        eq(consentDecisions.id, signal.consentDecisionId),
      ),
    )
    .limit(1);
  if (consent === undefined) {
    return null;
  }
  const [draft] = await tx
    .select()
    .from(signalDrafts)
    .where(
      and(
        eq(signalDrafts.spaceId, actor.spaceId),
        eq(signalDrafts.id, consent.signalDraftId),
      ),
    )
    .limit(1);
  if (draft === undefined) {
    return null;
  }

  const draftEvidenceRows = await tx
    .select()
    .from(signalDraftEvidence)
    .where(
      and(
        eq(signalDraftEvidence.spaceId, actor.spaceId),
        eq(signalDraftEvidence.signalDraftId, draft.id),
      ),
    );
  const signalEvidenceRows = await tx
    .select()
    .from(signalEvidence)
    .where(
      and(
        eq(signalEvidence.spaceId, actor.spaceId),
        eq(signalEvidence.signalId, signal.id),
      ),
    );
  const evidenceId = signalEvidenceRows[0]?.evidenceId;
  if (signalEvidenceRows.length !== 1 || evidenceId === undefined) {
    return null;
  }
  const [sourceEvidence] = await tx
    .select()
    .from(evidence)
    .where(
      and(eq(evidence.spaceId, actor.spaceId), eq(evidence.id, evidenceId)),
    )
    .limit(1);
  if (sourceEvidence === undefined) {
    return null;
  }

  try {
    return canonicalContextFromRows(
      actor,
      spaceRow,
      memberRows,
      draft,
      consent,
      signal,
      sourceEvidence,
      draftEvidenceRows,
      signalEvidenceRows,
    );
  } catch {
    return null;
  }
};

const loadResponsibilityReceipt = async (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
  sourceSignalId: string,
) => {
  const [row] = await tx
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.spaceId, actor.spaceId),
        eq(idempotencyRecords.operation, FIXTURE_RESPONSIBILITY_OPERATION),
        eq(idempotencyRecords.actorKey, `member:${actor.memberId}`),
        eq(idempotencyRecords.idempotencyKey, responsibilityKey(sourceSignalId)),
      ),
    )
    .limit(1);
  return row;
};

const responsibilityRowsMatch = async (
  tx: DatabaseTransaction,
  command: ResponsibilityCreationCommand,
): Promise<boolean> => {
  const [domain] = await tx
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.spaceId, command.actor.spaceId),
        eq(domains.id, command.domain.id),
      ),
    )
    .limit(1);
  const [task] = await tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.spaceId, command.actor.spaceId),
        eq(tasks.id, command.task.id),
      ),
    )
    .limit(1);
  const domainEvidenceRows = await tx
    .select({ evidenceId: domainEvidence.evidenceId })
    .from(domainEvidence)
    .where(
      and(
        eq(domainEvidence.spaceId, command.actor.spaceId),
        eq(domainEvidence.domainId, command.domain.id),
      ),
    );
  const taskEvidenceRows = await tx
    .select({ evidenceId: taskEvidence.evidenceId })
    .from(taskEvidence)
    .where(
      and(
        eq(taskEvidence.spaceId, command.actor.spaceId),
        eq(taskEvidence.taskId, command.task.id),
      ),
    );

  if (domain === undefined || task === undefined) {
    return false;
  }

  try {
    const persistedDomain = {
      ...domainFromRow(
        domain,
        domainEvidenceRows.map(({ evidenceId }) => evidenceId),
      ),
      createdAt: canonicalFixtureTimestamp(
        domain.createdAt,
        command.domain.createdAt,
      ),
      updatedAt: canonicalFixtureTimestamp(
        domain.updatedAt,
        command.domain.updatedAt,
      ),
    };
    const persistedTask = {
      ...taskFromRow(
        task,
        taskEvidenceRows.map(({ evidenceId }) => evidenceId),
      ),
      createdAt: canonicalFixtureTimestamp(task.createdAt, command.task.createdAt),
      dueAt:
        task.dueAt === null || command.task.dueAt === null
          ? task.dueAt
          : canonicalFixtureTimestamp(task.dueAt, command.task.dueAt),
      updatedAt: canonicalFixtureTimestamp(task.updatedAt, command.task.updatedAt),
    };
    return (
      idsAreExact(persistedDomain.evidenceIds, command.domain.evidenceIds) &&
      idsAreExact(persistedTask.evidenceIds, command.task.evidenceIds) &&
      sameValue(persistedDomain, command.domain) &&
      sameValue(persistedTask, command.task)
    );
  } catch {
    return false;
  }
};

const responsibilityLinksRemainValid = async (
  tx: DatabaseTransaction,
  result: ResponsibilityCreationResult,
): Promise<boolean> => {
  const spaceId = result.domain.spaceId;
  const [domain] = await tx
    .select({ id: domains.id, spaceId: domains.spaceId })
    .from(domains)
    .where(and(eq(domains.spaceId, spaceId), eq(domains.id, result.domain.id)))
    .limit(1);
  const [task] = await tx
    .select({
      domainId: tasks.domainId,
      id: tasks.id,
      spaceId: tasks.spaceId,
    })
    .from(tasks)
    .where(and(eq(tasks.spaceId, spaceId), eq(tasks.id, result.task.id)))
    .limit(1);
  const domainEvidenceRows = await tx
    .select({ evidenceId: domainEvidence.evidenceId })
    .from(domainEvidence)
    .where(
      and(
        eq(domainEvidence.spaceId, spaceId),
        eq(domainEvidence.domainId, result.domain.id),
      ),
    );
  const taskEvidenceRows = await tx
    .select({ evidenceId: taskEvidence.evidenceId })
    .from(taskEvidence)
    .where(
      and(
        eq(taskEvidence.spaceId, spaceId),
        eq(taskEvidence.taskId, result.task.id),
      ),
    );

  return (
    domain?.spaceId === spaceId &&
    task?.spaceId === spaceId &&
    task.domainId === domain.id &&
    idsAreExact(
      domainEvidenceRows.map(({ evidenceId }) => evidenceId),
      result.domain.evidenceIds,
    ) &&
    idsAreExact(
      taskEvidenceRows.map(({ evidenceId }) => evidenceId),
      result.task.evidenceIds,
    )
  );
};

const createResponsibilityPersistencePort = (
  tx: DatabaseTransaction,
): ResponsibilityPersistencePort => ({
  create: async (commandInput) => {
    const command = ResponsibilityCreationCommandSchema.parse(commandInput);
    const requestHash = hashValue(command);
    const existing = await loadResponsibilityReceipt(
      tx,
      command.actor,
      command.sourceSignalId,
    );

    if (existing !== undefined && existing.requestHash !== requestHash) {
      throw createResponsibilityError("idempotency_conflict");
    }
    if (existing?.state === "completed") {
      const stored = ResponsibilityCreationResultSchema.parse(existing.result);
      if (
        !(await responsibilityLinksRemainValid(tx, stored)) ||
        stored.sourceSignalId !== command.sourceSignalId ||
        !sameValue(stored.domain, command.domain) ||
        !sameValue(stored.task, command.task)
      ) {
        throw createResponsibilityError("conflict");
      }
      return ResponsibilityCreationResultSchema.parse({
        ...stored,
        status: "replayed",
      });
    }
    const receiptId = existing?.id ?? randomUUID();
    if (existing === undefined) {
      await tx.insert(idempotencyRecords).values({
        ...actorColumns(command.actor),
        claimedAt: command.domain.createdAt,
        completedAt: null,
        id: receiptId,
        idempotencyKey: responsibilityKey(command.sourceSignalId),
        operation: FIXTURE_RESPONSIBILITY_OPERATION,
        requestHash,
        result: null,
        spaceId: command.actor.spaceId,
        state: "claimed",
      });
    }

    if (!(await responsibilityRowsMatch(tx, command))) {
      throw createResponsibilityError("stale_version");
    }

    const result = ResponsibilityCreationResultSchema.parse({
      domain: command.domain,
      sourceSignalId: command.sourceSignalId,
      status: "created",
      task: command.task,
    });
    const completed = await tx
      .update(idempotencyRecords)
      .set({
        completedAt: command.domain.updatedAt,
        result,
        state: "completed",
      })
      .where(
        and(
          eq(idempotencyRecords.id, receiptId),
          eq(idempotencyRecords.spaceId, command.actor.spaceId),
          eq(idempotencyRecords.requestHash, requestHash),
          eq(idempotencyRecords.state, "claimed"),
        ),
      )
      .returning({ id: idempotencyRecords.id });
    if (completed.length !== 1) {
      throw createResponsibilityError("conflict");
    }
    return result;
  },
});

const createSourcePort = (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
): ResponsibilitySourcePort => ({
  load: ({ actorId, sourceSignalId, spaceId }) =>
    actorId === actor.memberId && spaceId === actor.spaceId
      ? loadCanonicalSourceContext(tx, actor, sourceSignalId)
      : Promise.resolve(null),
});

const completedResponsibilityResult = async (
  tx: DatabaseTransaction,
): Promise<ResponsibilityCreationResult> => {
  const subject = MVP_CORE_FIXTURE.actors.subject;
  const sourceSignalId = MVP_CORE_FIXTURE.privateConversation.consentedSignal.id;
  const receipt = await loadResponsibilityReceipt(tx, subject, sourceSignalId);
  if (receipt?.state !== "completed") {
    throw createResponsibilityError("not_found");
  }
  const result = ResponsibilityCreationResultSchema.parse(receipt.result);
  if (result.sourceSignalId !== sourceSignalId) {
    throw createResponsibilityError("conflict");
  }
  return result;
};

const loadReportSnapshot = async (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
): Promise<ResponsibilityReportSnapshot> => {
  if (!actorMatchesFixtureSession(actor)) {
    throw createResponsibilityError("not_found");
  }
  const link = await completedResponsibilityResult(tx);
  const [space] = await tx
    .select()
    .from(spaces)
    .where(eq(spaces.id, actor.spaceId))
    .limit(1);
  const memberRows = await tx
    .select()
    .from(members)
    .where(eq(members.spaceId, actor.spaceId));
  const [domain] = await tx
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.spaceId, actor.spaceId),
        eq(domains.id, link.domain.id),
      ),
    )
    .limit(1);
  const [task] = await tx
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.spaceId, actor.spaceId), eq(tasks.id, link.task.id)),
    )
    .limit(1);
  const domainEvidenceRows = await tx
    .select({ evidenceId: domainEvidence.evidenceId })
    .from(domainEvidence)
    .where(
      and(
        eq(domainEvidence.spaceId, actor.spaceId),
        eq(domainEvidence.domainId, link.domain.id),
      ),
    );
  const taskEvidenceRows = await tx
    .select({ evidenceId: taskEvidence.evidenceId })
    .from(taskEvidence)
    .where(
      and(
        eq(taskEvidence.spaceId, actor.spaceId),
        eq(taskEvidence.taskId, link.task.id),
      ),
    );
  const source = await loadCanonicalSourceContext(
    tx,
    actor,
    link.sourceSignalId,
  );
  const actorMember = memberRows.find(({ id }) => id === actor.memberId);
  if (
    space === undefined ||
    domain === undefined ||
    task === undefined ||
    actorMember?.status !== "active" ||
    source === null
  ) {
    throw createResponsibilityError("not_found");
  }

  return ResponsibilityReportSnapshotSchema.parse({
    actorMember: memberFromRow(actorMember),
    domains: [
      domainFromRow(
        domain,
        domainEvidenceRows.map(({ evidenceId }) => evidenceId),
      ),
    ],
    members: memberRows.map(memberFromRow),
    sources: [source],
    space: spaceFromRow(space),
    tasks: [
      {
        sourceSignalId: link.sourceSignalId,
        task: taskFromRow(
          task,
          taskEvidenceRows.map(({ evidenceId }) => evidenceId),
        ),
      },
    ],
  });
};

const createReportPort = (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
): ResponsibilityReportPort => ({
  load: ({ actor: requestedActor, request }) =>
    requestedActor.memberId === actor.memberId &&
    requestedActor.role === actor.role &&
    request.spaceId === actor.spaceId
      ? loadReportSnapshot(tx, actor)
      : Promise.reject(createResponsibilityError("not_found")),
});

const createService = (tx: DatabaseTransaction, actor: MvpCoreMemberActor) =>
  createResponsibilityService({
    clock: {
      now: () => new Date(MVP_CORE_FIXTURE.responsibility.report.generatedAt),
    },
    drafts: createCanonicalFixtureResponsibilityDraftPort(),
    persistence: createResponsibilityPersistencePort(tx),
    reports: createReportPort(tx, actor),
    sources: createSourcePort(tx, actor),
  });

export const createCanonicalResponsibilityLink = async (
  tx: DatabaseTransaction,
  actor: MvpCoreMemberActor,
): Promise<ResponsibilityCreationResult> =>
  createService(tx, actor).createFromSharedSignal(actor, {
    requestId: MVP_CORE_FIXTURE.ids.request,
    sourceSignalId: MVP_CORE_FIXTURE.privateConversation.consentedSignal.id,
  });

export const generateCanonicalResponsibilityReport = async (
  database: Database,
  actor: MvpCoreMemberActor,
) =>
  database.transaction(
    async (tx) => {
      await lockMvpCoreTransaction(tx);
      if (!actorMatchesFixtureSession(actor)) {
        throw createResponsibilityError("not_found");
      }

      const marker = FixtureReportReceiptSchema.parse({
        generated: true,
        sourceSignalId:
          MVP_CORE_FIXTURE.privateConversation.consentedSignal.id,
      });
      const markerHash = hashValue(marker);
      const actorKey = `member:${actor.memberId}`;
      const [existing] = await tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.spaceId, actor.spaceId),
            eq(idempotencyRecords.operation, FIXTURE_REPORT_OPERATION),
            eq(idempotencyRecords.actorKey, actorKey),
            eq(idempotencyRecords.idempotencyKey, FIXTURE_REPORT_KEY),
          ),
        )
        .limit(1);
      if (
        existing !== undefined &&
        (existing.state !== "completed" ||
          existing.requestHash !== markerHash ||
          !sameValue(FixtureReportReceiptSchema.parse(existing.result), marker))
      ) {
        throw createResponsibilityError("idempotency_conflict");
      }

      const result = await createService(tx, actor).getResponsibilityReport(
        actor,
        {
          period: MVP_CORE_FIXTURE.responsibility.report.period,
          requestId: MVP_CORE_FIXTURE.ids.request,
          spaceId: actor.spaceId,
        },
      );
      if (existing === undefined) {
        await tx.insert(idempotencyRecords).values({
          ...actorColumns(actor),
          claimedAt: result.report.generatedAt,
          completedAt: result.report.generatedAt,
          id: randomUUID(),
          idempotencyKey: FIXTURE_REPORT_KEY,
          operation: FIXTURE_REPORT_OPERATION,
          requestHash: markerHash,
          result: marker,
          spaceId: actor.spaceId,
          state: "completed",
        });
      }
      return result.report;
    },
    { isolationLevel: "repeatable read" },
  );
