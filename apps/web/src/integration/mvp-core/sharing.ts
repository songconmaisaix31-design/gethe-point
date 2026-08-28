import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  type Database,
  consentDecisions,
  conversationMembers,
  conversations,
  evidence,
  idempotencyRecords,
  members,
  messages,
  signalEvidence,
  signalDraftEvidence,
  signalDrafts,
  signals,
} from "../../../../../packages/db/src/index";
import {
  createPrivateSharingError,
  type PrivateSharingStatePort,
} from "../../../../../modules/boundary/src/index";
import type { ConversationStatePort } from "../../../../../modules/conversation/src/index";
import { MVP_CORE_FIXTURE } from "../../../../../fixtures/mvp-core";
import {
  MvpCoreSharedSignalSchema,
  type MvpCoreConfirmSignalRequest,
  type MvpCoreConsentDecision,
  type MvpCoreDecideConsentRequest,
  type MvpCoreMemberActor,
  type MvpCorePrivateMessageContext,
  type MvpCoreSharedSignal,
  type MvpCoreSharedVisibility,
} from "./contract-projections";
import {
  canonicalFixtureTimestamp,
  lockMvpCoreTransaction,
  toTimestamp,
  visibilityFromColumns,
} from "./persistence";
import { createCanonicalResponsibilityLink } from "./responsibility";

const ConfirmSignalReceiptSchema = z.strictObject({
  signal: MvpCoreSharedSignalSchema,
});

const hashRequest = (request: MvpCoreConfirmSignalRequest): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        consentDecisionId: request.consentDecisionId,
        expectedDraftVersion: request.expectedDraftVersion,
        signalDraftId: request.signalDraftId,
      }),
    )
    .digest("hex");

const actorMatchesCanonicalSession = (actor: MvpCoreMemberActor): boolean => {
  const expected = MVP_CORE_FIXTURE.actors[actor.role];
  return (
    actor.authentication === "fixture_demo" &&
    actor.memberId === expected.memberId &&
    actor.spaceId === expected.spaceId
  );
};

const memberForActor = async (
  database: Database,
  actor: MvpCoreMemberActor,
) => {
  if (!actorMatchesCanonicalSession(actor)) {
    return undefined;
  }
  return database.transaction(async (tx) => {
    const [member] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.spaceId, actor.spaceId),
          eq(members.id, actor.memberId),
          eq(members.role, actor.role),
        ),
      )
      .limit(1);
    return member;
  });
};

const privateContextFromRows = (
  message: typeof messages.$inferSelect,
  sourceEvidence: typeof evidence.$inferSelect,
): MvpCorePrivateMessageContext => ({
  evidence: {
    createdAt: toTimestamp(sourceEvidence.createdAt),
    id: sourceEvidence.id,
    occurredAt: toTimestamp(sourceEvidence.occurredAt),
    rawRef: sourceEvidence.rawRef,
    sourceType: sourceEvidence.sourceType,
    spaceId: sourceEvidence.spaceId,
    speakerId: sourceEvidence.speakerId,
    state: sourceEvidence.state,
    updatedAt: toTimestamp(sourceEvidence.updatedAt),
    version: sourceEvidence.version,
    visibility: {
      kind: "self",
      memberId: sourceEvidence.visibleToMemberId,
    },
  },
  message: {
    authorId: message.authorId,
    clientMessageId: message.clientMessageId,
    content: message.content,
    conversationId: message.conversationId,
    createdAt: toTimestamp(message.createdAt),
    id: message.id,
    occurredAt: toTimestamp(message.occurredAt),
    spaceId: message.spaceId,
    updatedAt: toTimestamp(message.updatedAt),
    version: message.version,
    visibility: { kind: "self", memberId: message.visibleToMemberId },
  },
});

export const createDatabaseConversationStatePort = (
  database: Database,
): ConversationStatePort => ({
  createPrivateMessage: () => Promise.resolve({ status: "denied" }),

  getConversation: async (actor, conversationId) => {
    if (!actorMatchesCanonicalSession(actor)) {
      return null;
    }
    return database.transaction(async (tx) => {
      const [conversation] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.spaceId, actor.spaceId),
            eq(conversations.id, conversationId),
          ),
        )
        .limit(1);
      const participantRows = await tx
        .select({ memberId: conversationMembers.memberId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.spaceId, actor.spaceId),
            eq(conversationMembers.conversationId, conversationId),
          ),
        );
      if (
        conversation === undefined ||
        participantRows.length !== 1 ||
        participantRows[0]?.memberId !== actor.memberId
      ) {
        return null;
      }
      return {
        createdAt: toTimestamp(conversation.createdAt),
        id: conversation.id,
        participantMemberIds: participantRows.map(({ memberId }) => memberId),
        spaceId: conversation.spaceId,
        type: conversation.type,
        updatedAt: toTimestamp(conversation.updatedAt),
        version: conversation.version,
      };
    });
  },

  getMember: async (actor) => {
    const member = await memberForActor(database, actor);
    return member === undefined
      ? null
      : {
          analysisConsent: member.analysisConsent,
          createdAt: toTimestamp(member.createdAt),
          displayName: member.displayName,
          id: member.id,
          joinedAt: toTimestamp(member.joinedAt),
          role: member.role,
          spaceId: member.spaceId,
          status: member.status,
          updatedAt: toTimestamp(member.updatedAt),
          version: member.version,
        };
  },

  getPrivateMessage: async (actor, privateMessageId) => {
    if (!actorMatchesCanonicalSession(actor)) {
      return null;
    }
    return database.transaction(async (tx) => {
      const [message] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.spaceId, actor.spaceId),
            eq(messages.id, privateMessageId),
            eq(messages.authorId, actor.memberId),
            eq(messages.visibleToMemberId, actor.memberId),
          ),
        )
        .limit(1);
      if (message === undefined) {
        return null;
      }
      const [sourceEvidence] = await tx
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.spaceId, actor.spaceId),
            eq(evidence.sourceMessageId, message.id),
            eq(evidence.speakerId, actor.memberId),
            eq(evidence.visibleToMemberId, actor.memberId),
          ),
        )
        .limit(1);
      return sourceEvidence === undefined
        ? null
        : privateContextFromRows(message, sourceEvidence);
    });
  },

  listPrivateMessages: async (actor, conversationId) => {
    if (!actorMatchesCanonicalSession(actor)) {
      return null;
    }
    return database.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.spaceId, actor.spaceId),
            eq(messages.conversationId, conversationId),
            eq(messages.authorId, actor.memberId),
            eq(messages.visibleToMemberId, actor.memberId),
          ),
        );
      return rows.map((row) =>
        privateContextFromRows(row, {
          createdAt: row.createdAt,
          id: MVP_CORE_FIXTURE.privateConversation.derivedDraft.evidenceIds[0],
          occurredAt: row.occurredAt,
          rawRef: "device://fixture/evidence-1",
          sourceMessageId: row.id,
          sourceType: "agent_dm",
          spaceId: row.spaceId,
          speakerId: row.authorId,
          state: "available",
          updatedAt: row.updatedAt,
          version: 0,
          visibleToMemberId: row.visibleToMemberId,
        }).message,
      );
    });
  },
});

const visibilityColumns = (visibility: MvpCoreSharedVisibility) => {
  if (visibility.kind === "space") {
    return {
      visibilityKind: "space" as const,
      visibilityMemberIds: [] as string[],
      visibilitySubjectId: null,
    };
  }
  if (visibility.kind === "members") {
    return {
      visibilityKind: "members" as const,
      visibilityMemberIds: [...visibility.memberIds],
      visibilitySubjectId: null,
    };
  }
  return {
    visibilityKind: "care_related" as const,
    visibilityMemberIds: [...visibility.memberIds],
    visibilitySubjectId: visibility.subjectId,
  };
};

const consentFromRow = (
  row: typeof consentDecisions.$inferSelect,
): MvpCoreConsentDecision => {
  if (
    row.outcome === "share" &&
    row.recordState === "active" &&
    row.visibilityKind !== null &&
    row.revokedAt === null
  ) {
    return {
        createdAt: toTimestamp(row.createdAt),
        decidedAt: toTimestamp(row.decidedAt),
        expiresAt: row.expiresAt === null ? null : toTimestamp(row.expiresAt),
        id: row.id,
        outcome: "share",
        recordState: "active",
        revokedAt: null,
        signalDraftId: row.signalDraftId,
        spaceId: row.spaceId,
        speakerId: row.speakerId,
        updatedAt: toTimestamp(row.updatedAt),
        version: row.version,
        visibility: visibilityFromColumns(
          row.visibilityKind,
          row.visibilityMemberIds,
          row.visibilitySubjectId,
        ),
      };
  }
  if (
    row.outcome === "discard" &&
    row.recordState === "discarded" &&
    row.expiresAt === null &&
    row.revokedAt === null
  ) {
    return {
        createdAt: toTimestamp(row.createdAt),
        decidedAt: toTimestamp(row.decidedAt),
        expiresAt: null,
        id: row.id,
        outcome: "discard",
        recordState: row.recordState,
        revokedAt: null,
        signalDraftId: row.signalDraftId,
        spaceId: row.spaceId,
        speakerId: row.speakerId,
        updatedAt: toTimestamp(row.updatedAt),
        version: row.version,
        visibility: null,
      };
  }
  throw createPrivateSharingError("consent_invalid");
};

const sameVisibility = (
  left: MvpCoreSharedVisibility,
  right: MvpCoreSharedVisibility,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameValue = (left: unknown, right: unknown): boolean =>
  isDeepStrictEqual(left, right);

const canonicalSignal = MVP_CORE_FIXTURE.privateConversation.consentedSignal;

const sourceMessageIsCanonical = (
  row: typeof messages.$inferSelect,
): boolean => {
  const expected = MVP_CORE_FIXTURE.privateConversation.message;
  return (
    row.id === expected.id &&
    row.spaceId === expected.spaceId &&
    row.conversationId === expected.conversationId &&
    row.authorId === expected.authorId &&
    row.clientMessageId === expected.clientMessageId &&
    row.content === expected.content &&
    row.visibleToMemberId === expected.visibility.memberId &&
    row.version === expected.version &&
    Date.parse(row.createdAt) === Date.parse(expected.createdAt) &&
    Date.parse(row.updatedAt) === Date.parse(expected.updatedAt) &&
    Date.parse(row.occurredAt) === Date.parse(expected.occurredAt)
  );
};

const signalFromPersistedRows = (
  row: typeof signals.$inferSelect,
  sourceEvidence: typeof evidence.$inferSelect,
  links: readonly (typeof signalEvidence.$inferSelect)[],
): MvpCoreSharedSignal => {
  if (
    links.length !== 1 ||
    links[0]?.spaceId !== row.spaceId ||
    links[0].signalId !== row.id ||
    links[0].evidenceId !== sourceEvidence.id
  ) {
    throw createPrivateSharingError("consent_invalid");
  }

  return MvpCoreSharedSignalSchema.parse({
    conclusion: row.conclusion,
    consentDecisionId: row.consentDecisionId,
    createdAt: canonicalFixtureTimestamp(row.createdAt, canonicalSignal.createdAt),
    evidenceState: row.evidenceState,
    id: row.id,
    provenance: [
      {
        evidenceId: sourceEvidence.id,
        occurredAt: canonicalFixtureTimestamp(
          sourceEvidence.occurredAt,
          canonicalSignal.provenance[0].occurredAt,
        ),
        sourceType: sourceEvidence.sourceType,
        speakerId: sourceEvidence.speakerId,
        state: sourceEvidence.state,
      },
    ],
    purpose: row.purpose,
    redactedExcerpt: row.redactedExcerpt,
    spaceId: row.spaceId,
    speakerId: row.speakerId,
    updatedAt: canonicalFixtureTimestamp(row.updatedAt, canonicalSignal.updatedAt),
    version: row.version,
    visibility: visibilityFromColumns(
      row.visibilityKind,
      row.visibilityMemberIds,
      row.visibilitySubjectId,
    ),
  });
};

const signalFromSourceRows = (
  draft: typeof signalDrafts.$inferSelect,
  consent: typeof consentDecisions.$inferSelect,
  sourceEvidence: typeof evidence.$inferSelect,
): MvpCoreSharedSignal => {
  const persistedConsent = consentFromRow(consent);
  if (persistedConsent.outcome !== "share") {
    throw createPrivateSharingError("consent_required");
  }

  return MvpCoreSharedSignalSchema.parse({
    conclusion: draft.proposedConclusion,
    consentDecisionId: consent.id,
    createdAt: canonicalFixtureTimestamp(draft.createdAt, canonicalSignal.createdAt),
    evidenceState: sourceEvidence.state === "available" ? "available" : "evidence_missing",
    id: canonicalSignal.id,
    provenance: [
      {
        evidenceId: sourceEvidence.id,
        occurredAt: canonicalFixtureTimestamp(
          sourceEvidence.occurredAt,
          canonicalSignal.provenance[0].occurredAt,
        ),
        sourceType: sourceEvidence.sourceType,
        speakerId: sourceEvidence.speakerId,
        state: sourceEvidence.state,
      },
    ],
    purpose: "care_information",
    redactedExcerpt: draft.redactedExcerpt,
    spaceId: draft.spaceId,
    speakerId: draft.speakerId,
    updatedAt: canonicalFixtureTimestamp(consent.updatedAt, canonicalSignal.updatedAt),
    version: 0,
    visibility: persistedConsent.visibility,
  });
};

const decideConsent = async (
  database: Database,
  actor: MvpCoreMemberActor,
  request: MvpCoreDecideConsentRequest,
) =>
  database.transaction(async (tx) => {
    await lockMvpCoreTransaction(tx);
    if (!actorMatchesCanonicalSession(actor) || actor.role !== "subject") {
      throw createPrivateSharingError("not_found");
    }
    const [member] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.spaceId, actor.spaceId),
          eq(members.id, actor.memberId),
        ),
      )
      .limit(1);
    const [draft] = await tx
      .select()
      .from(signalDrafts)
      .where(
        and(
          eq(signalDrafts.spaceId, actor.spaceId),
          eq(signalDrafts.id, request.signalDraftId),
          eq(signalDrafts.speakerId, actor.memberId),
        ),
      )
      .limit(1);
    if (member?.status !== "active") {
      throw createPrivateSharingError("forbidden");
    }
    if (draft === undefined) {
      throw createPrivateSharingError("not_found");
    }

    const [existing] = await tx
      .select()
      .from(consentDecisions)
      .where(
        and(
          eq(consentDecisions.spaceId, actor.spaceId),
          eq(consentDecisions.signalDraftId, request.signalDraftId),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      const persisted = consentFromRow(existing);
      const sameDecision =
        persisted.outcome === request.decision &&
        (persisted.outcome === "discard" ||
          (request.decision === "share" &&
            sameVisibility(persisted.visibility, request.visibility)));
      if (!sameDecision) {
        throw createPrivateSharingError("conflict");
      }
      return persisted;
    }

    const id = MVP_CORE_FIXTURE.privateConversation.consentDecision.id;
    if (request.decision === "share") {
      const visibility = visibilityColumns(request.visibility);
      await tx.insert(consentDecisions).values({
        ...visibility,
        createdAt: draft.createdAt,
        decidedAt: request.decidedAt,
        expiresAt: request.expiresAt,
        id,
        outcome: "share",
        recordState: "active",
        revokedAt: null,
        signalDraftId: draft.id,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: request.decidedAt,
        version: 0,
      });
    } else {
      await tx.insert(consentDecisions).values({
        createdAt: draft.createdAt,
        decidedAt: request.decidedAt,
        expiresAt: null,
        id,
        outcome: "discard",
        recordState: "discarded",
        revokedAt: null,
        signalDraftId: draft.id,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: request.decidedAt,
        version: 0,
        visibilityKind: null,
        visibilityMemberIds: [],
        visibilitySubjectId: null,
      });
    }

    const [persisted] = await tx
      .select()
      .from(consentDecisions)
      .where(eq(consentDecisions.id, id))
      .limit(1);
    if (persisted === undefined) {
      throw createPrivateSharingError("internal_failure");
    }
    return consentFromRow(persisted);
  });

const confirmSignal = async (
  database: Database,
  actor: MvpCoreMemberActor,
  request: MvpCoreConfirmSignalRequest,
): Promise<MvpCoreSharedSignal> =>
  database.transaction(async (tx) => {
    await lockMvpCoreTransaction(tx);
    if (!actorMatchesCanonicalSession(actor) || actor.role !== "subject") {
      throw createPrivateSharingError("not_found");
    }

    const requestHash = hashRequest(request);
    const actorKey = `member:${actor.memberId}`;
    const [member] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.spaceId, actor.spaceId),
          eq(members.id, actor.memberId),
          eq(members.role, actor.role),
        ),
      )
      .limit(1);
    if (member?.status !== "active" || member.analysisConsent !== "enabled") {
      throw createPrivateSharingError("forbidden");
    }

    const [receipt] = await tx
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.spaceId, actor.spaceId),
          eq(idempotencyRecords.operation, "ConfirmSignal"),
          eq(idempotencyRecords.actorKey, actorKey),
          eq(idempotencyRecords.idempotencyKey, request.idempotencyKey),
        ),
      )
      .limit(1);
    if (receipt !== undefined) {
      if (
        receipt.requestHash !== requestHash ||
        receipt.state !== "completed" ||
        receipt.result === null
      ) {
        throw createPrivateSharingError("idempotency_conflict");
      }
    }

    const [draft] = await tx
      .select()
      .from(signalDrafts)
      .where(
        and(
          eq(signalDrafts.spaceId, actor.spaceId),
          eq(signalDrafts.id, request.signalDraftId),
          eq(signalDrafts.speakerId, actor.memberId),
        ),
      )
      .limit(1);
    if (draft === undefined) {
      throw createPrivateSharingError("not_found");
    }
    if (draft.version !== request.expectedDraftVersion) {
      throw createPrivateSharingError("stale_version");
    }
    const [consent] = await tx
      .select()
      .from(consentDecisions)
      .where(
        and(
          eq(consentDecisions.spaceId, actor.spaceId),
          eq(consentDecisions.id, request.consentDecisionId),
        ),
      )
      .limit(1);
    if (consent?.outcome !== "share") {
      throw createPrivateSharingError("consent_required");
    }
    if (
      consent.recordState !== "active" ||
      consent.signalDraftId !== draft.id ||
      consent.speakerId !== actor.memberId ||
      consent.visibilityKind === null ||
      consent.revokedAt !== null ||
      (consent.expiresAt !== null &&
        Date.parse(consent.expiresAt) <= Date.parse(canonicalSignal.updatedAt))
    ) {
      throw createPrivateSharingError("consent_invalid");
    }
    const [sourceMessage] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.spaceId, actor.spaceId),
          eq(messages.id, draft.sourceMessageId),
          eq(messages.authorId, actor.memberId),
          eq(messages.visibleToMemberId, actor.memberId),
        ),
      )
      .limit(1);
    const draftEvidenceRows = await tx
      .select()
      .from(signalDraftEvidence)
      .where(
        and(
          eq(signalDraftEvidence.spaceId, actor.spaceId),
          eq(signalDraftEvidence.signalDraftId, draft.id),
        ),
      );
    const draftEvidence = draftEvidenceRows[0];
    if (sourceMessage === undefined || draftEvidenceRows.length !== 1 || draftEvidence === undefined) {
      throw createPrivateSharingError("consent_invalid");
    }
    const [sourceEvidence] = await tx
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.spaceId, actor.spaceId),
          eq(evidence.id, draftEvidence.evidenceId),
          eq(evidence.speakerId, actor.memberId),
          eq(evidence.sourceMessageId, draft.sourceMessageId),
          eq(evidence.visibleToMemberId, actor.memberId),
        ),
      )
      .limit(1);
    if (
      sourceEvidence?.state !== "available" ||
      !sourceMessageIsCanonical(sourceMessage)
    ) {
      throw createPrivateSharingError("consent_invalid");
    }

    const signal = signalFromSourceRows(draft, consent, sourceEvidence);
    if (!sameValue(signal, canonicalSignal)) {
      throw createPrivateSharingError("consent_invalid");
    }
    const visibility = visibilityColumns(signal.visibility);
    const [existingSignal] = await tx
      .select()
      .from(signals)
      .where(
        and(eq(signals.spaceId, actor.spaceId), eq(signals.id, signal.id)),
      )
      .limit(1);
    const existingLinks = await tx
      .select()
      .from(signalEvidence)
      .where(
        and(
          eq(signalEvidence.spaceId, actor.spaceId),
          eq(signalEvidence.signalId, signal.id),
        ),
      );
    if (existingSignal === undefined) {
      if (existingLinks.length !== 0 || receipt !== undefined) {
        throw createPrivateSharingError("conflict");
      }
      await tx.insert(signals).values({
        ...visibility,
        conclusion: signal.conclusion,
        consentDecisionId: signal.consentDecisionId,
        createdAt: signal.createdAt,
        evidenceState: "available",
        id: signal.id,
        purpose: signal.purpose,
        redactedExcerpt: signal.redactedExcerpt,
        spaceId: signal.spaceId,
        speakerId: signal.speakerId,
        updatedAt: signal.updatedAt,
        version: signal.version,
      });
      await tx.insert(signalEvidence).values({
        evidenceId: sourceEvidence.id,
        signalId: signal.id,
        spaceId: actor.spaceId,
      });
    } else {
      const persistedSignal = signalFromPersistedRows(
        existingSignal,
        sourceEvidence,
        existingLinks,
      );
      if (!sameValue(persistedSignal, signal)) {
        throw createPrivateSharingError("conflict");
      }
    }

    await createCanonicalResponsibilityLink(tx, actor);
    const result = ConfirmSignalReceiptSchema.parse({ signal });
    if (receipt === undefined) {
      await tx.insert(idempotencyRecords).values({
        actorKey,
        actorKind: "member",
        actorMemberId: actor.memberId,
        actorService: null,
        claimedAt: signal.createdAt,
        completedAt: signal.updatedAt,
        id: randomUUID(),
        idempotencyKey: request.idempotencyKey,
        operation: "ConfirmSignal",
        requestHash,
        result,
        spaceId: actor.spaceId,
        state: "completed",
      });
    } else if (!sameValue(ConfirmSignalReceiptSchema.parse(receipt.result), result)) {
      throw createPrivateSharingError("idempotency_conflict");
    }
    return signal;
  });

export const createDatabasePrivateSharingStatePort = (
  database: Database,
): PrivateSharingStatePort => ({
  confirmSignal: (actor, request) => confirmSignal(database, actor, request),
  decideConsent: (actor, request) => decideConsent(database, actor, request),
  listVisibleSharedSignals: async (actor, request) => {
    if (
      !actorMatchesCanonicalSession(actor) ||
      request.spaceId !== actor.spaceId
    ) {
      return null;
    }
    return database.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(members)
        .where(
          and(
            eq(members.spaceId, actor.spaceId),
            eq(members.id, actor.memberId),
            eq(members.role, actor.role),
          ),
        )
        .limit(1);
      if (member?.status !== "active") {
        return null;
      }
      const [signal] = await tx
        .select()
        .from(signals)
        .where(
          and(
            eq(signals.spaceId, actor.spaceId),
            eq(
              signals.id,
              MVP_CORE_FIXTURE.privateConversation.consentedSignal.id,
            ),
          ),
        )
        .limit(1);
      if (signal === undefined) {
        return [];
      }
      const links = await tx
        .select()
        .from(signalEvidence)
        .where(
          and(
            eq(signalEvidence.spaceId, actor.spaceId),
            eq(signalEvidence.signalId, signal.id),
          ),
        );
      const evidenceId = links[0]?.evidenceId;
      if (links.length !== 1 || evidenceId === undefined) {
        throw createPrivateSharingError("consent_invalid");
      }
      const [sourceEvidence] = await tx
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.spaceId, actor.spaceId),
            eq(evidence.id, evidenceId),
          ),
        )
        .limit(1);
      if (sourceEvidence === undefined) {
        throw createPrivateSharingError("consent_invalid");
      }
      const visibility = visibilityFromColumns(
        signal.visibilityKind,
        signal.visibilityMemberIds,
        signal.visibilitySubjectId,
      );
      if (
        visibility.kind !== "space" &&
        !visibility.memberIds.includes(actor.memberId)
      ) {
        return [];
      }
      return [signalFromPersistedRows(signal, sourceEvidence, links)];
    });
  },
});
