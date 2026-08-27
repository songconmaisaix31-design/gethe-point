import { createHash } from "node:crypto";

import {
  ActiveShareConsentSchema,
  ConversationSchema,
  DiscardedConsentSchema,
  EntityIdSchema,
  EvidenceProvenanceSchema,
  FIXTURE_ACTORS,
  FIXTURE_CONVERSATION,
  FIXTURE_EVIDENCE,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_TIMES,
  MemberSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  type ConfirmSignalRequest,
  type Conversation,
  type DecideConsentResult,
  type DecideConsentRequest,
  type EntityId,
  type Evidence,
  type GetVisibleSharedSignalsRequest,
  type Member,
  type MemberActor,
  type PrivateMessage,
  type SharedSignal,
  type SharedVisibility,
  type SignalDraft,
} from "../../../packages/contracts/src/index";
import {
  createSignalDraftService,
  type SafeWitnessLogEntry,
  type SignalDraftService,
  type SignalDraftStatePort,
  type WitnessLogger,
} from "../../ai-witness/src/index";
import {
  createConversationService,
  type ConversationLogger,
  type ConversationService,
  type ConversationStatePort,
  type PrivateMessageContext,
  type SafeConversationLogEntry,
} from "../../conversation/src/index";
import { createPrivateSharingError } from "./errors";
import {
  createPrivateSharingService,
  type PrivateSharingService,
  type PrivateSharingStatePort,
  type SafeSharingLogEntry,
  type SharingLogger,
} from "./sharing-service";

interface StoredEvidence {
  readonly evidence: Evidence;
  readonly sourceMessageId: EntityId;
}

interface StoredIdempotencyResult {
  readonly requestHash: string;
  readonly signal: SharedSignal;
}

export type SafeFixtureLogEntry =
  | SafeConversationLogEntry
  | SafeWitnessLogEntry
  | SafeSharingLogEntry;

export interface FixtureBoundarySnapshot {
  readonly consentDecisionCount: number;
  readonly privateMessageCount: number;
  readonly safeLogs: readonly SafeFixtureLogEntry[];
  readonly sharedSignalCount: number;
  readonly signalDraftCount: number;
}

export interface FixtureBoundaryControl {
  setMemberStatus(memberId: EntityId, status: "active" | "inactive"): void;
}

export interface FixturePrivateSharingBoundary {
  readonly conversation: ConversationService;
  readonly control: FixtureBoundaryControl;
  inspect(): FixtureBoundarySnapshot;
  readonly sharing: PrivateSharingService;
  readonly witness: SignalDraftService;
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const confirmationRequestHash = (request: ConfirmSignalRequest): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        consentDecisionId: request.consentDecisionId,
        expectedDraftVersion: request.expectedDraftVersion,
        signalDraftId: request.signalDraftId,
      }),
    )
    .digest("hex");

export const createFixturePrivateSharingBoundary =
  (): FixturePrivateSharingBoundary => {
    const members = new Map<EntityId, Member>([
      [FIXTURE_IDS.primary, MemberSchema.parse(FIXTURE_MEMBERS.primary)],
      [FIXTURE_IDS.partner, MemberSchema.parse(FIXTURE_MEMBERS.partner)],
      [FIXTURE_IDS.subject, MemberSchema.parse(FIXTURE_MEMBERS.subject)],
    ]);
    const conversations = new Map<EntityId, Conversation>([
      [
        FIXTURE_IDS.conversation,
        ConversationSchema.parse(FIXTURE_CONVERSATION),
      ],
    ]);
    const messages = new Map<EntityId, PrivateMessage>();
    const messageIdByClientKey = new Map<string, EntityId>();
    const evidence = new Map<EntityId, StoredEvidence>();
    const evidenceIdByMessage = new Map<EntityId, EntityId>();
    const drafts = new Map<EntityId, SignalDraft>();
    const draftIdByMessage = new Map<EntityId, EntityId>();
    const consents = new Map<
      EntityId,
      DecideConsentResult["decision"]
    >();
    const consentIdByDraft = new Map<EntityId, EntityId>();
    const signals = new Map<EntityId, SharedSignal>();
    const signalIdByConsent = new Map<EntityId, EntityId>();
    const idempotency = new Map<string, StoredIdempotencyResult>();
    const safeLogs: SafeFixtureLogEntry[] = [];

    const memberForActor = (actor: MemberActor): Member | null => {
      const member = members.get(actor.memberId);

      if (member?.spaceId !== actor.spaceId) {
        return null;
      }

      if (
        member.role !== actor.role ||
        actor.authentication !== "fixture_demo"
      ) {
        return null;
      }

      return member;
    };

    const activeMemberForActor = (actor: MemberActor): Member | null => {
      const member = memberForActor(actor);
      return member?.status === "active" ? member : null;
    };

    const ownedMessageContext = (
      actor: MemberActor,
      privateMessageId: EntityId,
    ): PrivateMessageContext | null => {
      if (memberForActor(actor) === null) {
        return null;
      }

      const message = messages.get(privateMessageId);
      const evidenceId = evidenceIdByMessage.get(privateMessageId);
      const storedEvidence =
        evidenceId === undefined ? undefined : evidence.get(evidenceId);

      if (
        message === undefined ||
        storedEvidence === undefined ||
        message.spaceId !== actor.spaceId ||
        message.authorId !== actor.memberId ||
        message.visibility.memberId !== actor.memberId ||
        storedEvidence.sourceMessageId !== message.id ||
        storedEvidence.evidence.spaceId !== actor.spaceId ||
        storedEvidence.evidence.speakerId !== actor.memberId ||
        storedEvidence.evidence.visibility.memberId !== actor.memberId
      ) {
        return null;
      }

      return clone({ evidence: storedEvidence.evidence, message });
    };

    const isOwnedAvailableEvidence = (
      actor: MemberActor,
      sourceMessageId: EntityId,
      item: StoredEvidence | undefined,
    ): item is StoredEvidence =>
      item?.sourceMessageId === sourceMessageId &&
      item.evidence.spaceId === actor.spaceId &&
      item.evidence.speakerId === actor.memberId &&
      item.evidence.state === "available" &&
      item.evidence.visibility.memberId === actor.memberId;

    const recordLog = (entry: SafeFixtureLogEntry): void => {
      safeLogs.push(clone(entry));
    };
    const conversationLogger: ConversationLogger = { write: recordLog };
    const witnessLogger: WitnessLogger = { write: recordLog };
    const sharingLogger: SharingLogger = { write: recordLog };

    const conversationState: ConversationStatePort = {
      createPrivateMessage(actor, context) {
        const member = activeMemberForActor(actor);
        const conversation = conversations.get(context.message.conversationId);

        if (
          member === null ||
          conversation?.spaceId !== actor.spaceId ||
          conversation.type !== "agent_dm" ||
          conversation.participantMemberIds.length !== 1 ||
          conversation.participantMemberIds[0] !== actor.memberId ||
          context.message.spaceId !== actor.spaceId ||
          context.message.authorId !== actor.memberId ||
          context.message.visibility.memberId !== actor.memberId ||
          context.evidence.spaceId !== actor.spaceId ||
          context.evidence.speakerId !== actor.memberId ||
          context.evidence.sourceType !== "agent_dm" ||
          context.evidence.visibility.memberId !== actor.memberId
        ) {
          return { status: "denied" };
        }

        const clientKey = [
          actor.spaceId,
          actor.memberId,
          context.message.clientMessageId,
        ].join(":");
        const existingMessageId = messageIdByClientKey.get(clientKey);

        if (existingMessageId !== undefined) {
          const existing = ownedMessageContext(actor, existingMessageId);

          return existing !== null && sameValue(existing, context)
            ? { context: existing, status: "replay" }
            : { status: "conflict" };
        }

        if (
          messages.has(context.message.id) ||
          evidence.has(context.evidence.id)
        ) {
          return { status: "conflict" };
        }

        messages.set(context.message.id, clone(context.message));
        evidence.set(context.evidence.id, {
          evidence: clone(context.evidence),
          sourceMessageId: context.message.id,
        });
        evidenceIdByMessage.set(context.message.id, context.evidence.id);
        messageIdByClientKey.set(clientKey, context.message.id);

        return { context: clone(context), status: "created" };
      },

      getConversation(actor, conversationId) {
        if (memberForActor(actor) === null) {
          return null;
        }

        const conversation = conversations.get(conversationId);

        if (
          conversation?.spaceId !== actor.spaceId ||
          !conversation.participantMemberIds.includes(actor.memberId)
        ) {
          return null;
        }

        return clone(conversation);
      },

      getMember(actor) {
        const member = memberForActor(actor);
        return member === null ? null : clone(member);
      },

      getPrivateMessage(actor, privateMessageId) {
        return ownedMessageContext(actor, privateMessageId);
      },

      listPrivateMessages(actor, conversationId) {
        const conversation = conversations.get(conversationId);

        if (
          memberForActor(actor) === null ||
          conversation?.spaceId !== actor.spaceId ||
          !conversation.participantMemberIds.includes(actor.memberId)
        ) {
          return null;
        }

        return [...messages.values()]
          .filter(
            (message) =>
              message.conversationId === conversationId &&
              message.authorId === actor.memberId &&
              message.visibility.memberId === actor.memberId,
          )
          .sort((left, right) =>
            left.occurredAt === right.occurredAt
              ? left.id.localeCompare(right.id)
              : left.occurredAt.localeCompare(right.occurredAt),
          )
          .map(clone);
      },
    };

    const signalDraftState: SignalDraftStatePort = {
      getDraftSource(actor, privateMessageId, requestedEvidenceIds) {
        if (activeMemberForActor(actor) === null) {
          return null;
        }

        const context = ownedMessageContext(actor, privateMessageId);

        if (context === null) {
          return null;
        }

        const requestedEvidence = requestedEvidenceIds.map((evidenceId) =>
          evidence.get(evidenceId),
        );
        const availableEvidence = requestedEvidence.filter(
          (item): item is StoredEvidence =>
            isOwnedAvailableEvidence(actor, privateMessageId, item),
        );

        if (
          new Set(requestedEvidenceIds).size !== requestedEvidenceIds.length ||
          availableEvidence.length !== requestedEvidence.length
        ) {
          return null;
        }

        return {
          evidence: availableEvidence.map((item) => clone(item.evidence)),
          message: clone(context.message),
        };
      },

      saveSignalDraft(actor, draftInput) {
        if (activeMemberForActor(actor) === null) {
          return { status: "denied" };
        }

        const draft = SignalDraftSchema.parse(draftInput);
        const source = ownedMessageContext(actor, draft.sourceMessageId);
        const sourceEvidence = draft.evidenceIds.map((evidenceId) =>
          evidence.get(evidenceId),
        );

        if (
          source === null ||
          draft.spaceId !== actor.spaceId ||
          draft.speakerId !== actor.memberId ||
          sourceEvidence.some(
            (item) =>
              !isOwnedAvailableEvidence(actor, draft.sourceMessageId, item),
          )
        ) {
          return { status: "denied" };
        }

        const existingId = draftIdByMessage.get(draft.sourceMessageId);
        const existing =
          existingId === undefined ? undefined : drafts.get(existingId);

        if (existing !== undefined) {
          return sameValue(existing, draft)
            ? { draft: clone(existing), status: "replay" }
            : { status: "conflict" };
        }

        if (drafts.has(draft.id)) {
          return { status: "conflict" };
        }

        drafts.set(draft.id, clone(draft));
        draftIdByMessage.set(draft.sourceMessageId, draft.id);
        return { draft: clone(draft), status: "created" };
      },
    };

    const visibilityIsAllowed = (
      actor: MemberActor,
      visibility: SharedVisibility,
    ): boolean => {
      if (visibility.kind === "space") {
        return true;
      }

      const uniqueMemberIds = new Set(visibility.memberIds);
      const membersAreActive =
        uniqueMemberIds.size === visibility.memberIds.length &&
        visibility.memberIds.every((memberId) => {
          const member = members.get(memberId);
          return member?.spaceId === actor.spaceId && member.status === "active";
        });

      if (visibility.kind === "members") {
        return membersAreActive;
      }

      return (
        membersAreActive &&
        actor.role === "subject" &&
        visibility.subjectId === actor.memberId &&
        visibility.memberIds.includes(actor.memberId)
      );
    };

    const signalIsVisibleTo = (
      actor: MemberActor,
      signal: SharedSignal,
    ): boolean => {
      if (signal.spaceId !== actor.spaceId) {
        return false;
      }

      switch (signal.visibility.kind) {
        case "space":
          return true;
        case "members":
        case "care_related":
          return signal.visibility.memberIds.includes(actor.memberId);
      }
    };

    const sharingState: PrivateSharingStatePort = {
      decideConsent(actor, request: DecideConsentRequest) {
        const member = memberForActor(actor);

        if (member === null) {
          throw createPrivateSharingError("not_found");
        }

        if (member.status !== "active") {
          throw createPrivateSharingError("forbidden");
        }

        const draft = drafts.get(request.signalDraftId);

        if (
          draft?.spaceId !== actor.spaceId ||
          draft.speakerId !== actor.memberId
        ) {
          throw createPrivateSharingError("not_found");
        }

        if (
          request.decision === "share" &&
          (!visibilityIsAllowed(actor, request.visibility) ||
            (request.expiresAt !== null &&
              Date.parse(request.expiresAt) <= Date.parse(request.decidedAt)))
        ) {
          throw createPrivateSharingError("consent_invalid");
        }

        const candidate =
          request.decision === "share"
            ? ActiveShareConsentSchema.parse({
                createdAt: draft.createdAt,
                decidedAt: request.decidedAt,
                expiresAt: request.expiresAt,
                id: FIXTURE_IDS.consent,
                outcome: "share",
                recordState: "active",
                revokedAt: null,
                signalDraftId: draft.id,
                spaceId: actor.spaceId,
                speakerId: actor.memberId,
                updatedAt: request.decidedAt,
                version: 0,
                visibility: request.visibility,
              })
            : DiscardedConsentSchema.parse({
                createdAt: draft.createdAt,
                decidedAt: request.decidedAt,
                expiresAt: null,
                id: FIXTURE_IDS.consent,
                outcome: "discard",
                recordState: "discarded",
                revokedAt: null,
                signalDraftId: draft.id,
                spaceId: actor.spaceId,
                speakerId: actor.memberId,
                updatedAt: request.decidedAt,
                version: 0,
                visibility: null,
              });
        const existingConsentId = consentIdByDraft.get(draft.id);
        const existing =
          existingConsentId === undefined
            ? undefined
            : consents.get(existingConsentId);

        if (existing !== undefined) {
          if (sameValue(existing, candidate)) {
            return clone(existing);
          }

          throw createPrivateSharingError("conflict");
        }

        if (consents.has(candidate.id)) {
          throw createPrivateSharingError("conflict");
        }

        consents.set(candidate.id, clone(candidate));
        consentIdByDraft.set(draft.id, candidate.id);
        return clone(candidate);
      },

      confirmSignal(actor, request: ConfirmSignalRequest) {
        const member = memberForActor(actor);

        if (member === null) {
          throw createPrivateSharingError("not_found");
        }

        if (member.status !== "active") {
          throw createPrivateSharingError("forbidden");
        }

        const idempotencyScope = [
          actor.spaceId,
          actor.memberId,
          "ConfirmSignal",
          request.idempotencyKey,
        ].join(":");
        const requestHash = confirmationRequestHash(request);
        const replay = idempotency.get(idempotencyScope);

        if (replay !== undefined) {
          if (replay.requestHash !== requestHash) {
            throw createPrivateSharingError("idempotency_conflict");
          }

          return clone(replay.signal);
        }

        const draft = drafts.get(request.signalDraftId);

        if (
          draft?.spaceId !== actor.spaceId ||
          draft.speakerId !== actor.memberId
        ) {
          throw createPrivateSharingError("not_found");
        }

        if (draft.version !== request.expectedDraftVersion) {
          throw createPrivateSharingError("stale_version");
        }

        const consent = consents.get(request.consentDecisionId);

        if (consent === undefined) {
          throw createPrivateSharingError("consent_required");
        }

        if (
          consent.spaceId !== actor.spaceId ||
          consent.signalDraftId !== draft.id ||
          consent.speakerId !== actor.memberId
        ) {
          throw createPrivateSharingError("consent_invalid");
        }

        if (
          consent.recordState !== "active" ||
          (consent.expiresAt !== null &&
            Date.parse(consent.expiresAt) <=
              Date.parse(FIXTURE_TIMES.confirmedFrom))
        ) {
          throw createPrivateSharingError("consent_invalid");
        }

        if (!visibilityIsAllowed(actor, consent.visibility)) {
          throw createPrivateSharingError("visibility_denied");
        }

        const source = ownedMessageContext(actor, draft.sourceMessageId);
        const sourceEvidence = draft.evidenceIds.map((evidenceId) =>
          evidence.get(evidenceId),
        );
        const availableSourceEvidence = sourceEvidence.filter(
          (item): item is StoredEvidence =>
            isOwnedAvailableEvidence(actor, draft.sourceMessageId, item),
        );

        if (
          source?.message.spaceId !== actor.spaceId ||
          source.message.authorId !== actor.memberId ||
          availableSourceEvidence.length !== sourceEvidence.length
        ) {
          throw createPrivateSharingError("consent_invalid");
        }

        const existingSignalId = signalIdByConsent.get(consent.id);
        const existingSignal =
          existingSignalId === undefined
            ? undefined
            : signals.get(existingSignalId);

        if (existingSignal !== undefined) {
          idempotency.set(idempotencyScope, {
            requestHash,
            signal: clone(existingSignal),
          });
          return clone(existingSignal);
        }

        const provenance = availableSourceEvidence.map((available) => {
          return EvidenceProvenanceSchema.parse({
            evidenceId: available.evidence.id,
            occurredAt: available.evidence.occurredAt,
            sourceType: available.evidence.sourceType,
            speakerId: available.evidence.speakerId,
            state: available.evidence.state,
          });
        });
        const signal = SharedSignalSchema.parse({
          conclusion: draft.proposedConclusion,
          consentDecisionId: consent.id,
          createdAt: draft.createdAt,
          evidenceState: "available",
          id: FIXTURE_IDS.signal,
          provenance,
          purpose: "care_information",
          redactedExcerpt: draft.redactedExcerpt,
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          updatedAt: FIXTURE_TIMES.updated,
          version: 0,
          visibility: consent.visibility,
        });

        if (signals.has(signal.id)) {
          throw createPrivateSharingError("conflict");
        }

        signals.set(signal.id, clone(signal));
        signalIdByConsent.set(consent.id, signal.id);
        idempotency.set(idempotencyScope, {
          requestHash,
          signal: clone(signal),
        });

        return clone(signal);
      },

      listVisibleSharedSignals(
        actor,
        request: GetVisibleSharedSignalsRequest,
      ) {
        if (
          activeMemberForActor(actor) === null ||
          request.spaceId !== actor.spaceId
        ) {
          return null;
        }

        return [...signals.values()]
          .filter((signal) => signalIsVisibleTo(actor, signal))
          .sort((left, right) =>
            left.createdAt === right.createdAt
              ? left.id.localeCompare(right.id)
              : left.createdAt.localeCompare(right.createdAt),
          )
          .map(clone);
      },
    };

    const conversation = createConversationService({
      evidenceIdGenerator: () => FIXTURE_IDS.evidence,
      logger: conversationLogger,
      messageIdGenerator: () => FIXTURE_IDS.message,
      rawReferenceFor: () => FIXTURE_EVIDENCE.rawRef,
      recordedAt: () => FIXTURE_TIMES.updated,
      state: conversationState,
    });
    const witness = createSignalDraftService({
      createdAt: () => FIXTURE_TIMES.updated,
      draftIdGenerator: () => FIXTURE_IDS.signalDraft,
      logger: witnessLogger,
      state: signalDraftState,
    });
    const sharing = createPrivateSharingService({
      logger: sharingLogger,
      state: sharingState,
    });
    const control: FixtureBoundaryControl = Object.freeze({
      setMemberStatus(
        memberId: EntityId,
        status: "active" | "inactive",
      ) {
        const parsedMemberId = EntityIdSchema.parse(memberId);
        const member = members.get(parsedMemberId);

        if (member === undefined) {
          throw createPrivateSharingError("not_found");
        }

        members.set(
          parsedMemberId,
          MemberSchema.parse({
            ...member,
            status,
            updatedAt: FIXTURE_TIMES.confirmedFrom,
            version: member.version + 1,
          }),
        );
      },
    });

    return Object.freeze({
      conversation,
      control,
      inspect: (): FixtureBoundarySnapshot => ({
        consentDecisionCount: consents.size,
        privateMessageCount: messages.size,
        safeLogs: safeLogs.map(clone),
        sharedSignalCount: signals.size,
        signalDraftCount: drafts.size,
      }),
      sharing,
      witness,
    });
  };

export const FIXTURE_PRIVATE_SHARING_ACTORS = FIXTURE_ACTORS;
