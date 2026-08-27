import { z } from "zod";

import {
  EvidenceSchema,
  EntityIdSchema,
  PrivateContentSchema,
  RecordVersionSchema,
  type ConfirmSignalResult,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type Member,
  type PrivateMessage,
  type RequestHash,
  type SharedSignal,
  type SignalDraft,
  type Space,
} from "../../../packages/contracts/src/index";

export const ConversationEvidenceViewSchema = z.strictObject({
  evidence: EvidenceSchema,
  rawContent: PrivateContentSchema,
  sourceMessageId: EntityIdSchema.nullable(),
});
export type ConversationEvidenceView = z.infer<
  typeof ConversationEvidenceViewSchema
>;

export const DraftSourceSnapshotSchema = z.strictObject({
  spaceVersion: RecordVersionSchema,
  memberVersion: RecordVersionSchema,
  conversationId: EntityIdSchema,
  conversationVersion: RecordVersionSchema,
  messageId: EntityIdSchema,
  messageVersion: RecordVersionSchema,
  evidence: z
    .array(
      z.strictObject({
        id: EntityIdSchema,
        version: RecordVersionSchema,
      }),
    )
    .min(1)
    .max(10),
});
export type DraftSourceSnapshot = z.infer<typeof DraftSourceSnapshotSchema>;

export interface StoredSignalDraft {
  readonly draft: SignalDraft;
  readonly sourceSnapshot: DraftSourceSnapshot;
}

export interface StoredSignalConfirmation {
  readonly requestHash: RequestHash;
  readonly result: ConfirmSignalResult;
}

export interface ConversationTransaction {
  findSpace(spaceId: EntityId): Promise<Space | undefined>;
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
  listPrivateMessages(
    spaceId: EntityId,
    conversationId: EntityId,
  ): Promise<readonly PrivateMessage[]>;
  findEvidence(
    spaceId: EntityId,
    evidenceId: EntityId,
  ): Promise<ConversationEvidenceView | undefined>;
  findStoredSignalDraft(
    spaceId: EntityId,
    signalDraftId: EntityId,
  ): Promise<StoredSignalDraft | undefined>;
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
  listSharedSignals(spaceId: EntityId): Promise<readonly SharedSignal[]>;
  findSignalConfirmation(
    spaceId: EntityId,
    actorId: EntityId,
    idempotencyKey: string,
  ): Promise<StoredSignalConfirmation | undefined>;
  insertPrivateMessage(message: PrivateMessage): Promise<void>;
  insertSignalDraft(
    draft: SignalDraft,
    sourceSnapshot: DraftSourceSnapshot,
  ): Promise<void>;
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
