import type {
  ConsentDecision,
  Conversation,
  EntityId,
  Evidence,
  IdempotencyKey,
  Member,
  PrivateMessage,
  SharedSignal,
  SharedVisibility,
  SignalDraft,
  Space,
} from "../../../packages/contracts/src/index";

export interface PrivateEvidenceRecord {
  readonly evidence: Evidence;
  readonly sourceMessageId: EntityId | null;
  readonly rawContent: string;
}

export interface MessageCreationState {
  readonly space: Space;
  readonly actorMember: Member;
  readonly conversation: Conversation;
}

export interface DraftSourceState extends MessageCreationState {
  readonly message: PrivateMessage;
  readonly evidence: readonly PrivateEvidenceRecord[];
}

export interface ConsentAuthorizationState {
  readonly space: Space;
  readonly actorMember: Member;
  readonly draft: SignalDraft;
  readonly evidence: readonly PrivateEvidenceRecord[];
  readonly visibilityMembers: readonly Member[];
  readonly existingDecision: ConsentDecision | undefined;
}

export interface ConfirmationState extends ConsentAuthorizationState {
  readonly conversation: Conversation;
  readonly sourceMessage: PrivateMessage;
  readonly consent: ConsentDecision;
}

export interface PrivateConversationState extends MessageCreationState {
  readonly messages: readonly PrivateMessage[];
}

export interface PrivateEvidenceState {
  readonly space: Space;
  readonly actorMember: Member;
  readonly record: PrivateEvidenceRecord;
}

export interface SharedSignalListState {
  readonly space: Space;
  readonly actorMember: Member;
  readonly signals: readonly SharedSignal[];
}

export interface MessageCreationLookup {
  readonly spaceId: EntityId;
  readonly actorMemberId: EntityId;
  readonly conversationId: EntityId;
}

export interface DraftSourceLookup {
  readonly spaceId: EntityId;
  readonly actorMemberId: EntityId;
  readonly conversationId?: EntityId;
  readonly privateMessageId: EntityId;
  readonly evidenceIds: readonly EntityId[];
}

export interface ConsentAuthorizationLookup {
  readonly spaceId: EntityId;
  readonly actorMemberId: EntityId;
  readonly signalDraftId: EntityId;
  readonly visibility: SharedVisibility | null;
}

export interface ConfirmationLookup {
  readonly spaceId: EntityId;
  readonly actorMemberId: EntityId;
  readonly signalDraftId: EntityId;
  readonly consentDecisionId: EntityId;
}

export interface ConfirmationWriteInput {
  readonly signal: SharedSignal;
  readonly signalDraftId: EntityId;
  readonly actorMemberId: EntityId;
  readonly idempotencyKey: IdempotencyKey;
  readonly requestHash: string;
}

export type ConfirmationWriteResult =
  | Readonly<{ status: "inserted"; signal: SharedSignal }>
  | Readonly<{ status: "replayed"; signal: SharedSignal }>
  | Readonly<{ status: "conflict" }>;

export interface ConversationTransaction {
  loadMessageCreationState(
    lookup: MessageCreationLookup,
  ): Promise<MessageCreationState | undefined>;
  loadDraftSource(
    lookup: DraftSourceLookup,
  ): Promise<DraftSourceState | undefined>;
  loadConsentAuthorizationState(
    lookup: ConsentAuthorizationLookup,
  ): Promise<ConsentAuthorizationState | undefined>;

  /**
   * Takes write-intent locks for the actor, space, draft, consent, source
   * message/conversation, all draft evidence, and all visibility members.
   * Implementations must discover dependent IDs inside the same transaction.
   */
  lockConfirmationState(lookup: ConfirmationLookup): Promise<void>;
  loadConfirmationState(
    lookup: ConfirmationLookup,
  ): Promise<ConfirmationState | undefined>;

  insertPrivateMessage(message: PrivateMessage): Promise<void>;
  insertPrivateEvidence(record: PrivateEvidenceRecord): Promise<void>;
  insertSignalDraft(draft: SignalDraft): Promise<void>;
  insertConsentDecision(decision: ConsentDecision): Promise<void>;
  insertSharedSignal(
    input: ConfirmationWriteInput,
  ): Promise<ConfirmationWriteResult>;
}

export interface ConversationRepository {
  transaction<Result>(
    work: (transaction: ConversationTransaction) => Promise<Result>,
  ): Promise<Result>;
  loadDraftSource(
    lookup: DraftSourceLookup,
  ): Promise<DraftSourceState | undefined>;
  loadPrivateConversationState(
    lookup: MessageCreationLookup,
  ): Promise<PrivateConversationState | undefined>;
  loadPrivateEvidenceState(
    spaceId: EntityId,
    actorMemberId: EntityId,
    evidenceId: EntityId,
  ): Promise<PrivateEvidenceState | undefined>;
  loadSharedSignalListState(
    spaceId: EntityId,
    actorMemberId: EntityId,
  ): Promise<SharedSignalListState | undefined>;
}

export type ConversationRepositoryErrorCode =
  | "conflict"
  | "internal_failure";

export interface ConversationRepositoryError extends Error {
  readonly code: ConversationRepositoryErrorCode;
  readonly name: "ConversationRepositoryError";
}

const REPOSITORY_ERROR_MESSAGES: Readonly<
  Record<ConversationRepositoryErrorCode, string>
> = {
  conflict: "The conversation persistence write conflicts with current state.",
  internal_failure: "The conversation persistence operation failed.",
};

export const conversationRepositoryError = (
  code: ConversationRepositoryErrorCode,
): ConversationRepositoryError =>
  Object.assign(new Error(REPOSITORY_ERROR_MESSAGES[code]), {
    code,
    name: "ConversationRepositoryError" as const,
  });

export const isConversationRepositoryError = (
  error: unknown,
): error is ConversationRepositoryError =>
  error instanceof Error && error.name === "ConversationRepositoryError";
