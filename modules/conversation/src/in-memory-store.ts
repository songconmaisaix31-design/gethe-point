import {
  ConsentDecisionSchema,
  ConversationSchema,
  MemberSchema,
  PrivateMessageSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type Member,
  type PrivateMessage,
  type SharedSignal,
  type SignalDraft,
} from "../../../packages/contracts/src/index";
import {
  ConversationEvidenceViewSchema,
  type ConversationEvidenceView,
  type ConversationStore,
  type ConversationTransaction,
  type StoredSignalConfirmation,
} from "./store";

export interface InMemoryConversationSeed {
  readonly members?: readonly Member[];
  readonly conversations?: readonly Conversation[];
  readonly privateMessages?: readonly PrivateMessage[];
  readonly evidence?: readonly ConversationEvidenceView[];
  readonly signalDrafts?: readonly SignalDraft[];
  readonly consentDecisions?: readonly ConsentDecision[];
  readonly sharedSignals?: readonly SharedSignal[];
}

export interface InMemoryConversationSnapshot {
  readonly members: readonly Member[];
  readonly conversations: readonly Conversation[];
  readonly privateMessages: readonly PrivateMessage[];
  readonly evidence: readonly ConversationEvidenceView[];
  readonly signalDrafts: readonly SignalDraft[];
  readonly consentDecisions: readonly ConsentDecision[];
  readonly sharedSignals: readonly SharedSignal[];
  readonly signalConfirmationCount: number;
}

export interface InMemoryConversationStore extends ConversationStore {
  inspectForTest(): InMemoryConversationSnapshot;
}

interface MutableState {
  members: Map<string, Member>;
  conversations: Map<string, Conversation>;
  privateMessages: Map<string, PrivateMessage>;
  evidence: Map<string, ConversationEvidenceView>;
  signalDrafts: Map<string, SignalDraft>;
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
): string => `${spaceId}:ConfirmSignal:${actorId}:${idempotencyKey}`;

const cloneMap = <Value>(source: ReadonlyMap<string, Value>): Map<string, Value> =>
  new Map(
    [...source.entries()].map(([key, value]) => [key, structuredClone(value)]),
  );

const cloneState = (state: MutableState): MutableState => ({
  consentDecisions: cloneMap(state.consentDecisions),
  conversations: cloneMap(state.conversations),
  evidence: cloneMap(state.evidence),
  members: cloneMap(state.members),
  privateMessages: cloneMap(state.privateMessages),
  sharedSignals: cloneMap(state.sharedSignals),
  signalConfirmations: cloneMap(state.signalConfirmations),
  signalDrafts: cloneMap(state.signalDrafts),
});

const values = <Value>(map: ReadonlyMap<string, Value>): readonly Value[] =>
  [...map.values()].map((value) => structuredClone(value));

const insertUnique = <Value>(
  map: Map<string, Value>,
  key: string,
  value: Value,
): void => {
  if (map.has(key)) {
    throw new Error("The in-memory persistence key already exists.");
  }

  map.set(key, structuredClone(value));
};

const createTransaction = (state: MutableState): ConversationTransaction => ({
  findConsentDecision: (spaceId, consentDecisionId) =>
    Promise.resolve(
      structuredClone(
        state.consentDecisions.get(recordKey(spaceId, consentDecisionId)),
      ),
    ),
  findConsentDecisionForDraft: (spaceId, signalDraftId) =>
    Promise.resolve(
      structuredClone(
        [...state.consentDecisions.values()].find(
          (decision) =>
            decision.spaceId === spaceId &&
            decision.signalDraftId === signalDraftId,
        ),
      ),
    ),
  findConversation: (spaceId, conversationId) =>
    Promise.resolve(
      structuredClone(state.conversations.get(recordKey(spaceId, conversationId))),
    ),
  findEvidence: (spaceId, evidenceId) =>
    Promise.resolve(
      structuredClone(state.evidence.get(recordKey(spaceId, evidenceId))),
    ),
  findMember: (spaceId, memberId) =>
    Promise.resolve(
      structuredClone(state.members.get(recordKey(spaceId, memberId))),
    ),
  findPrivateMessage: (spaceId, messageId) =>
    Promise.resolve(
      structuredClone(state.privateMessages.get(recordKey(spaceId, messageId))),
    ),
  findPrivateMessageByClientId: (spaceId, conversationId, clientMessageId) =>
    Promise.resolve(
      structuredClone(
        [...state.privateMessages.values()].find(
          (message) =>
            message.spaceId === spaceId &&
            message.conversationId === conversationId &&
            message.clientMessageId === clientMessageId,
        ),
      ),
    ),
  findSignalConfirmation: (spaceId, actorId, idempotencyKey) =>
    Promise.resolve(
      structuredClone(
        state.signalConfirmations.get(
          confirmationKey(spaceId, actorId, idempotencyKey),
        ),
      ),
    ),
  findSignalDraft: (spaceId, signalDraftId) =>
    Promise.resolve(
      structuredClone(state.signalDrafts.get(recordKey(spaceId, signalDraftId))),
    ),
  findSignalForConsent: (spaceId, consentDecisionId) =>
    Promise.resolve(
      structuredClone(
        [...state.sharedSignals.values()].find(
          (signal) =>
            signal.spaceId === spaceId &&
            signal.consentDecisionId === consentDecisionId,
        ),
      ),
    ),
  insertConsentDecision: (decision) => {
    insertUnique(
      state.consentDecisions,
      recordKey(decision.spaceId, decision.id),
      decision,
    );
    return Promise.resolve();
  },
  insertPrivateMessage: (message) => {
    insertUnique(
      state.privateMessages,
      recordKey(message.spaceId, message.id),
      message,
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
  insertSignalDraft: (draft) => {
    insertUnique(
      state.signalDrafts,
      recordKey(draft.spaceId, draft.id),
      draft,
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

const seededMap = <Value extends { readonly id: EntityId; readonly spaceId: EntityId }>(
  source: readonly Value[],
): Map<string, Value> =>
  new Map(
    source.map((value) => [recordKey(value.spaceId, value.id), structuredClone(value)]),
  );

const seededEvidenceMap = (
  source: readonly ConversationEvidenceView[],
): Map<string, ConversationEvidenceView> =>
  new Map(
    source.map((value) => [
      recordKey(value.evidence.spaceId, value.evidence.id),
      structuredClone(value),
    ]),
  );

export const createInMemoryConversationStore = (
  seed: Readonly<InMemoryConversationSeed> = {},
): InMemoryConversationStore => {
  let state: MutableState = {
    consentDecisions: seededMap(
      (seed.consentDecisions ?? []).map((value) => ConsentDecisionSchema.parse(value)),
    ),
    conversations: seededMap(
      (seed.conversations ?? []).map((value) => ConversationSchema.parse(value)),
    ),
    evidence: seededEvidenceMap(
      (seed.evidence ?? []).map((value) =>
        ConversationEvidenceViewSchema.parse(value),
      ),
    ),
    members: seededMap(
      (seed.members ?? []).map((value) => MemberSchema.parse(value)),
    ),
    privateMessages: seededMap(
      (seed.privateMessages ?? []).map((value) => PrivateMessageSchema.parse(value)),
    ),
    sharedSignals: seededMap(
      (seed.sharedSignals ?? []).map((value) => SharedSignalSchema.parse(value)),
    ),
    signalConfirmations: new Map(),
    signalDrafts: seededMap(
      (seed.signalDrafts ?? []).map((value) => SignalDraftSchema.parse(value)),
    ),
  };
  let transactionQueue: Promise<void> = Promise.resolve();

  return Object.freeze({
    inspectForTest: (): InMemoryConversationSnapshot => ({
      consentDecisions: values(state.consentDecisions),
      conversations: values(state.conversations),
      evidence: values(state.evidence),
      members: values(state.members),
      privateMessages: values(state.privateMessages),
      sharedSignals: values(state.sharedSignals),
      signalConfirmationCount: state.signalConfirmations.size,
      signalDrafts: values(state.signalDrafts),
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
