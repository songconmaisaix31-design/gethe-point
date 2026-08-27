import type {
  ActiveShareConsent,
  ConsentDecision,
  Conversation,
  EntityId,
  Evidence,
  Member,
  PageInfo,
  PrivateMessage,
  SharedSignal,
  SharedVisibility,
  SignalDraft,
  Space,
} from "../../packages/contracts/src/index";

export interface PrivateEvidenceRecord {
  readonly evidence: Evidence;
  readonly rawContent: string;
  readonly sourceMessageId: EntityId | null;
}

export interface MessageCreationContext {
  readonly space: Space;
  readonly actor: Member;
  readonly conversation: Conversation;
}

export interface AnalysisContext extends MessageCreationContext {
  readonly message: PrivateMessage;
  readonly evidence: readonly PrivateEvidenceRecord[];
}

export interface ConsentContext {
  readonly space: Space;
  readonly actor: Member;
  readonly draft: SignalDraft;
  readonly evidence: readonly PrivateEvidenceRecord[];
  readonly visibilityMembers: readonly Member[];
}

export interface ConfirmationContext extends ConsentContext {
  readonly consent: ConsentDecision | undefined;
}

export interface PrivateConversationReadContext {
  readonly space: Space;
  readonly actor: Member;
  readonly conversation: Conversation;
  readonly messages: readonly PrivateMessage[];
  readonly page: PageInfo;
}

export interface RawEvidenceReadContext {
  readonly space: Space;
  readonly actor: Member;
  readonly evidence: PrivateEvidenceRecord;
}

export interface VisibleSignalsReadContext {
  readonly space: Space;
  readonly actor: Member;
  readonly signals: readonly SharedSignal[];
  readonly page: PageInfo;
}

export interface RecordExpectation {
  readonly id: EntityId;
  readonly version: number;
}

export interface SpaceExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly status: Space["status"];
}

export interface MemberExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly status: Member["status"];
  readonly role: Member["role"];
  readonly analysisConsent: Member["analysisConsent"];
}

export interface ConversationExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly type: Conversation["type"];
  readonly participantMemberIds: readonly EntityId[];
}

export interface MessageExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly conversationId: EntityId;
  readonly authorId: EntityId;
  readonly visibleToMemberId: EntityId;
  readonly contentDigest: string;
}

export interface EvidenceExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly speakerId: EntityId;
  readonly visibleToMemberId: EntityId;
  readonly sourceMessageId: EntityId | null;
  readonly state: Evidence["state"];
  readonly rawContentDigest: string;
}

export interface DraftExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly speakerId: EntityId;
  readonly sourceMessageId: EntityId;
  readonly evidenceIds: readonly EntityId[];
  readonly kind: SignalDraft["kind"];
  readonly contentDigest: string;
}

export interface ConsentExpectation extends RecordExpectation {
  readonly spaceId: EntityId;
  readonly signalDraftId: EntityId;
  readonly speakerId: EntityId;
  readonly recordState: ConsentDecision["recordState"];
  readonly outcome: ConsentDecision["outcome"];
  readonly visibility: SharedVisibility | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface MessageCreationExpectedState {
  readonly space: SpaceExpectation;
  readonly actor: MemberExpectation;
  readonly conversation: ConversationExpectation;
}

export interface AnalysisExpectedState extends MessageCreationExpectedState {
  readonly message: MessageExpectation;
  readonly evidence: readonly EvidenceExpectation[];
}

export interface ConsentExpectedState {
  readonly space: SpaceExpectation;
  readonly actor: MemberExpectation;
  readonly draft: DraftExpectation;
  readonly evidence: readonly EvidenceExpectation[];
  readonly visibilityMembers: readonly MemberExpectation[];
}

export interface ConfirmationExpectedState extends ConsentExpectedState {
  readonly consent: ConsentExpectation;
}

export type PersistenceOutcome = "inserted" | "conflict" | "stale";

export interface ConfirmationReplay {
  readonly requestHash: string;
  readonly signal: SharedSignal;
}

export interface ConversationReader {
  loadAnalysisContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly privateMessageId: EntityId;
    readonly evidenceIds: readonly EntityId[];
  }): Promise<AnalysisContext | undefined>;

  loadPrivateConversation(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly conversationId: EntityId;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<PrivateConversationReadContext | undefined>;

  loadRawEvidence(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly evidenceId: EntityId;
  }): Promise<RawEvidenceReadContext | undefined>;

  loadVisibleSignals(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<VisibleSignalsReadContext | undefined>;
}

export interface ConversationTransaction {
  lockMessageCreationContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly conversationId: EntityId;
  }): Promise<MessageCreationContext | undefined>;

  persistPrivateMessage(input: {
    readonly message: PrivateMessage;
    readonly evidence: PrivateEvidenceRecord;
    readonly expected: MessageCreationExpectedState;
  }): Promise<PersistenceOutcome>;

  lockAnalysisContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly privateMessageId: EntityId;
    readonly evidenceIds: readonly EntityId[];
  }): Promise<AnalysisContext | undefined>;

  persistSignalDraft(input: {
    readonly draft: SignalDraft;
    readonly expected: AnalysisExpectedState;
  }): Promise<PersistenceOutcome>;

  lockConsentContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly signalDraftId: EntityId;
    readonly visibilityMemberIds: readonly EntityId[];
  }): Promise<ConsentContext | undefined>;

  persistConsentDecision(input: {
    readonly decision: ConsentDecision;
    readonly expected: ConsentExpectedState;
  }): Promise<PersistenceOutcome>;

  findConfirmationReplay(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly idempotencyKey: string;
  }): Promise<ConfirmationReplay | undefined>;

  lockConfirmationContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly signalDraftId: EntityId;
    readonly consentDecisionId: EntityId;
  }): Promise<ConfirmationContext | undefined>;

  readConfirmationContext(input: {
    readonly spaceId: EntityId;
    readonly actorId: EntityId;
    readonly signalDraftId: EntityId;
    readonly consentDecisionId: EntityId;
  }): Promise<ConfirmationContext | undefined>;

  persistConfirmedSignal(input: {
    readonly signal: SharedSignal;
    readonly consent: ActiveShareConsent;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly expected: ConfirmationExpectedState;
  }): Promise<PersistenceOutcome>;
}

export interface ConversationStore {
  read<Result>(
    work: (reader: ConversationReader) => Promise<Result>,
  ): Promise<Result>;

  transaction<Result>(
    work: (transaction: ConversationTransaction) => Promise<Result>,
  ): Promise<Result>;
}
