import {
  ConsentDecisionSchema,
  ConversationSchema,
  MemberSchema,
  PrivateMessageSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type Member,
  type PrivateMessage,
  type SharedSignal,
  type SignalDraft,
  type Space,
} from "../../../packages/contracts/src/index";
import {
  ConversationEvidenceViewSchema,
  DraftSourceSnapshotSchema,
  type ConversationEvidenceView,
  type ConversationStore,
  type ConversationTransaction,
  type StoredSignalConfirmation,
  type StoredSignalDraft,
} from "./store";

export interface InMemoryConversationSeed {
  readonly spaces?: readonly Space[];
  readonly members?: readonly Member[];
  readonly conversations?: readonly Conversation[];
  readonly privateMessages?: readonly PrivateMessage[];
  readonly evidence?: readonly ConversationEvidenceView[];
  readonly signalDrafts?: readonly StoredSignalDraft[];
  readonly consentDecisions?: readonly ConsentDecision[];
  readonly sharedSignals?: readonly SharedSignal[];
}

export interface InMemoryConversationSnapshot {
  readonly spaces: readonly Space[];
  readonly members: readonly Member[];
  readonly conversations: readonly Conversation[];
  readonly privateMessages: readonly PrivateMessage[];
  readonly evidence: readonly ConversationEvidenceView[];
  readonly signalDrafts: readonly SignalDraft[];
  readonly consentDecisions: readonly ConsentDecision[];
  readonly sharedSignals: readonly SharedSignal[];
  readonly signalConfirmationCount: number;
  readonly ordinaryTasks: readonly [];
  readonly reportFacts: readonly [];
}

export interface InMemoryConversationStore extends ConversationStore {
  inspectForTest(): InMemoryConversationSnapshot;
  replaceSpaceForTest(space: Space): Promise<void>;
  replaceMemberForTest(member: Member): Promise<void>;
  replaceConversationForTest(conversation: Conversation): Promise<void>;
  replacePrivateMessageForTest(message: PrivateMessage): Promise<void>;
  replaceEvidenceForTest(evidence: ConversationEvidenceView): Promise<void>;
  replaceSignalDraftForTest(draft: SignalDraft): Promise<void>;
  replaceConsentDecisionForTest(decision: ConsentDecision): Promise<void>;
}

interface MutableState {
  spaces: Map<string, Space>;
  members: Map<string, Member>;
  conversations: Map<string, Conversation>;
  privateMessages: Map<string, PrivateMessage>;
  evidence: Map<string, ConversationEvidenceView>;
  signalDrafts: Map<string, StoredSignalDraft>;
  consentDecisions: Map<string, ConsentDecision>;
  sharedSignals: Map<string, SharedSignal>;
  signalConfirmations: Map<string, StoredSignalConfirmation>;
}

const recordKey = (spaceId: EntityId, id: EntityId): string =>
  `${spaceId}:${id}`;

const confirmationKey = (
  spaceId: EntityId,
  actorId: EntityId,
  idempotencyKey: string,
): string => `${spaceId}:${actorId}:${idempotencyKey}`;

const clone = <Value>(value: Value): Value => structuredClone(value);

const cloneState = (state: MutableState): MutableState => ({
  spaces: clone(state.spaces),
  members: clone(state.members),
  conversations: clone(state.conversations),
  privateMessages: clone(state.privateMessages),
  evidence: clone(state.evidence),
  signalDrafts: clone(state.signalDrafts),
  consentDecisions: clone(state.consentDecisions),
  sharedSignals: clone(state.sharedSignals),
  signalConfirmations: clone(state.signalConfirmations),
});

const values = <Value>(map: Map<string, Value>): readonly Value[] =>
  [...map.values()].map((value) => clone(value));

const insertUnique = <Value>(
  map: Map<string, Value>,
  key: string,
  value: Value,
): void => {
  if (map.has(key)) {
    throw new Error("A unique conversation record already exists.");
  }

  map.set(key, clone(value));
};

const sortedMessages = (
  messages: readonly PrivateMessage[],
): readonly PrivateMessage[] =>
  [...messages].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );

const sortedSignals = (signals: readonly SharedSignal[]): readonly SharedSignal[] =>
  [...signals].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.id.localeCompare(right.id),
  );

const createTransaction = (state: MutableState): ConversationTransaction => ({
  findSpace: (spaceId) => Promise.resolve(clone(state.spaces.get(spaceId))),
  findMember: (spaceId, memberId) =>
    Promise.resolve(clone(state.members.get(recordKey(spaceId, memberId)))),
  findConversation: (spaceId, conversationId) =>
    Promise.resolve(
      clone(state.conversations.get(recordKey(spaceId, conversationId))),
    ),
  findPrivateMessage: (spaceId, messageId) =>
    Promise.resolve(
      clone(state.privateMessages.get(recordKey(spaceId, messageId))),
    ),
  findPrivateMessageByClientId: (
    spaceId,
    conversationId,
    clientMessageId,
  ) =>
    Promise.resolve(
      clone(
        [...state.privateMessages.values()].find(
          (message) =>
            message.spaceId === spaceId &&
            message.conversationId === conversationId &&
            message.clientMessageId === clientMessageId,
        ),
      ),
    ),
  listPrivateMessages: (spaceId, conversationId) =>
    Promise.resolve(
      clone(
        sortedMessages(
          [...state.privateMessages.values()].filter(
            (message) =>
              message.spaceId === spaceId &&
              message.conversationId === conversationId,
          ),
        ),
      ),
    ),
  findEvidence: (spaceId, evidenceId) =>
    Promise.resolve(clone(state.evidence.get(recordKey(spaceId, evidenceId)))),
  findStoredSignalDraft: (spaceId, signalDraftId) =>
    Promise.resolve(
      clone(state.signalDrafts.get(recordKey(spaceId, signalDraftId))),
    ),
  findConsentDecision: (spaceId, consentDecisionId) =>
    Promise.resolve(
      clone(state.consentDecisions.get(recordKey(spaceId, consentDecisionId))),
    ),
  findConsentDecisionForDraft: (spaceId, signalDraftId) =>
    Promise.resolve(
      clone(
        [...state.consentDecisions.values()].find(
          (decision) =>
            decision.spaceId === spaceId &&
            decision.signalDraftId === signalDraftId,
        ),
      ),
    ),
  findSignalForConsent: (spaceId, consentDecisionId) =>
    Promise.resolve(
      clone(
        [...state.sharedSignals.values()].find(
          (signal) =>
            signal.spaceId === spaceId &&
            signal.consentDecisionId === consentDecisionId,
        ),
      ),
    ),
  listSharedSignals: (spaceId) =>
    Promise.resolve(
      clone(
        sortedSignals(
          [...state.sharedSignals.values()].filter(
            (signal) => signal.spaceId === spaceId,
          ),
        ),
      ),
    ),
  findSignalConfirmation: (spaceId, actorId, idempotencyKey) =>
    Promise.resolve(
      clone(
        state.signalConfirmations.get(
          confirmationKey(spaceId, actorId, idempotencyKey),
        ),
      ),
    ),
  insertPrivateMessage: (message) => {
    insertUnique(
      state.privateMessages,
      recordKey(message.spaceId, message.id),
      message,
    );
    return Promise.resolve();
  },
  insertSignalDraft: (draft, sourceSnapshot) => {
    insertUnique(
      state.signalDrafts,
      recordKey(draft.spaceId, draft.id),
      Object.freeze({ draft, sourceSnapshot }),
    );
    return Promise.resolve();
  },
  insertConsentDecision: (decision) => {
    insertUnique(
      state.consentDecisions,
      recordKey(decision.spaceId, decision.id),
      decision,
    );
    return Promise.resolve();
  },
  insertSharedSignal: (signal) => {
    insertUnique(
      state.sharedSignals,
      recordKey(signal.spaceId, signal.id),
      signal,
    );
    return Promise.resolve();
  },
  saveSignalConfirmation: (
    spaceId,
    actorId,
    idempotencyKey,
    confirmation,
  ) => {
    insertUnique(
      state.signalConfirmations,
      confirmationKey(spaceId, actorId, idempotencyKey),
      confirmation,
    );
    return Promise.resolve();
  },
});

const seededMap = <
  Value extends { readonly id: EntityId; readonly spaceId: EntityId },
>(source: readonly Value[]): Map<string, Value> =>
  new Map(
    source.map((value) => [recordKey(value.spaceId, value.id), clone(value)]),
  );

const seededSpaceMap = (source: readonly Space[]): Map<string, Space> =>
  new Map(source.map((space) => [space.id, clone(space)]));

const seededEvidenceMap = (
  source: readonly ConversationEvidenceView[],
): Map<string, ConversationEvidenceView> =>
  new Map(
    source.map((value) => [
      recordKey(value.evidence.spaceId, value.evidence.id),
      clone(value),
    ]),
  );

const seededSignalDraftMap = (
  source: readonly StoredSignalDraft[],
): Map<string, StoredSignalDraft> =>
  new Map(
    source.map((value) => [
      recordKey(value.draft.spaceId, value.draft.id),
      clone(value),
    ]),
  );

export const createInMemoryConversationStore = (
  seed: Readonly<InMemoryConversationSeed> = {},
): InMemoryConversationStore => {
  let state: MutableState = {
    spaces: seededSpaceMap(
      (seed.spaces ?? []).map((value) => SpaceSchema.parse(value)),
    ),
    members: seededMap(
      (seed.members ?? []).map((value) => MemberSchema.parse(value)),
    ),
    conversations: seededMap(
      (seed.conversations ?? []).map((value) => ConversationSchema.parse(value)),
    ),
    privateMessages: seededMap(
      (seed.privateMessages ?? []).map((value) =>
        PrivateMessageSchema.parse(value),
      ),
    ),
    evidence: seededEvidenceMap(
      (seed.evidence ?? []).map((value) =>
        ConversationEvidenceViewSchema.parse(value),
      ),
    ),
    signalDrafts: seededSignalDraftMap(
      (seed.signalDrafts ?? []).map((value) => ({
        draft: SignalDraftSchema.parse(value.draft),
        sourceSnapshot: DraftSourceSnapshotSchema.parse(value.sourceSnapshot),
      })),
    ),
    consentDecisions: seededMap(
      (seed.consentDecisions ?? []).map((value) =>
        ConsentDecisionSchema.parse(value),
      ),
    ),
    sharedSignals: seededMap(
      (seed.sharedSignals ?? []).map((value) => SharedSignalSchema.parse(value)),
    ),
    signalConfirmations: new Map(),
  };
  let transactionQueue: Promise<void> = Promise.resolve();

  const mutate = (work: (workingState: MutableState) => void): Promise<void> => {
    const run = transactionQueue.then(() => {
      const workingState = cloneState(state);
      work(workingState);
      state = workingState;
    });
    transactionQueue = run.catch(() => undefined);
    return run;
  };

  return Object.freeze({
    inspectForTest: (): InMemoryConversationSnapshot => ({
      spaces: values(state.spaces),
      members: values(state.members),
      conversations: values(state.conversations),
      privateMessages: values(state.privateMessages),
      evidence: values(state.evidence),
      signalDrafts: values(state.signalDrafts).map(({ draft }) => draft),
      consentDecisions: values(state.consentDecisions),
      sharedSignals: values(state.sharedSignals),
      signalConfirmationCount: state.signalConfirmations.size,
      ordinaryTasks: [],
      reportFacts: [],
    }),
    replaceSpaceForTest: (space: Space) =>
      mutate((workingState) => {
        const parsed = SpaceSchema.parse(space);
        workingState.spaces.set(parsed.id, clone(parsed));
      }),
    replaceMemberForTest: (member: Member) =>
      mutate((workingState) => {
        const parsed = MemberSchema.parse(member);
        workingState.members.set(
          recordKey(parsed.spaceId, parsed.id),
          clone(parsed),
        );
      }),
    replaceConversationForTest: (conversation: Conversation) =>
      mutate((workingState) => {
        const parsed = ConversationSchema.parse(conversation);
        workingState.conversations.set(
          recordKey(parsed.spaceId, parsed.id),
          clone(parsed),
        );
      }),
    replacePrivateMessageForTest: (message: PrivateMessage) =>
      mutate((workingState) => {
        const parsed = PrivateMessageSchema.parse(message);
        workingState.privateMessages.set(
          recordKey(parsed.spaceId, parsed.id),
          clone(parsed),
        );
      }),
    replaceEvidenceForTest: (evidence: ConversationEvidenceView) =>
      mutate((workingState) => {
        const parsed = ConversationEvidenceViewSchema.parse(evidence);
        workingState.evidence.set(
          recordKey(parsed.evidence.spaceId, parsed.evidence.id),
          clone(parsed),
        );
      }),
    replaceSignalDraftForTest: (draft: SignalDraft) =>
      mutate((workingState) => {
        const parsed = SignalDraftSchema.parse(draft);
        const key = recordKey(parsed.spaceId, parsed.id);
        const existing = workingState.signalDrafts.get(key);

        if (existing === undefined) {
          throw new Error("The signal draft does not exist.");
        }

        workingState.signalDrafts.set(key, {
          draft: clone(parsed),
          sourceSnapshot: existing.sourceSnapshot,
        });
      }),
    replaceConsentDecisionForTest: (decision: ConsentDecision) =>
      mutate((workingState) => {
        const parsed = ConsentDecisionSchema.parse(decision);
        workingState.consentDecisions.set(
          recordKey(parsed.spaceId, parsed.id),
          clone(parsed),
        );
      }),
    transaction: <Result>(
      work: (transaction: ConversationTransaction) => Promise<Result>,
    ): Promise<Result> => {
      const run = transactionQueue.then(async () => {
        const workingState = cloneState(state);
        const result = await work(createTransaction(workingState));
        state = workingState;
        return result;
      });

      transactionQueue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  });
};
