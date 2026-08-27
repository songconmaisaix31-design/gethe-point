import { z } from "zod";

import {
  EvidenceSchema,
  EntityIdSchema,
  PrivateContentSchema,
  type ConfirmSignalResult,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type Member,
  type PrivateMessage,
  type RequestHash,
  type SharedSignal,
  type SignalDraft,
} from "../../../packages/contracts/src/index";

export const ConversationEvidenceViewSchema = z.strictObject({
  evidence: EvidenceSchema,
  rawContent: PrivateContentSchema,
  sourceMessageId: EntityIdSchema.nullable(),
});
export type ConversationEvidenceView = z.infer<
  typeof ConversationEvidenceViewSchema
>;

export interface StoredSignalConfirmation {
  readonly requestHash: RequestHash;
  readonly result: ConfirmSignalResult;
}

export interface ConversationTransaction {
  findMember(spaceId: EntityId, memberId: EntityId): Promise<Member | undefined>;
  findConversation(
    spaceId: EntityId,
    conversationId: EntityId,
  ): Promise<Conversation | undefined>;
  findPrivateMessage(
    spaceId: EntityId,
    messageId: EntityId,
  ): Promise<PrivateMessage | undefined>;
  findPrivateMessageByClientId(
    spaceId: EntityId,
    conversationId: EntityId,
    clientMessageId: EntityId,
  ): Promise<PrivateMessage | undefined>;
  findEvidence(
    spaceId: EntityId,
    evidenceId: EntityId,
  ): Promise<ConversationEvidenceView | undefined>;
  findSignalDraft(
    spaceId: EntityId,
    signalDraftId: EntityId,
  ): Promise<SignalDraft | undefined>;
  findConsentDecision(
    spaceId: EntityId,
    consentDecisionId: EntityId,
  ): Promise<ConsentDecision | undefined>;
  findConsentDecisionForDraft(
    spaceId: EntityId,
    signalDraftId: EntityId,
  ): Promise<ConsentDecision | undefined>;
  findSignalForConsent(
    spaceId: EntityId,
    consentDecisionId: EntityId,
  ): Promise<SharedSignal | undefined>;
  findSignalConfirmation(
    spaceId: EntityId,
    actorId: EntityId,
    idempotencyKey: string,
  ): Promise<StoredSignalConfirmation | undefined>;
  insertPrivateMessage(message: PrivateMessage): Promise<void>;
  insertSignalDraft(draft: SignalDraft): Promise<void>;
  insertConsentDecision(decision: ConsentDecision): Promise<void>;
  insertSharedSignal(signal: SharedSignal): Promise<void>;
  saveSignalConfirmation(
    spaceId: EntityId,
    actorId: EntityId,
    idempotencyKey: string,
    confirmation: StoredSignalConfirmation,
  ): Promise<void>;
}

export interface ConversationStore {
  transaction<Result>(
    work: (transaction: ConversationTransaction) => Promise<Result>,
  ): Promise<Result>;
}
