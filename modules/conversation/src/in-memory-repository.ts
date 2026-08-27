import { z } from "zod";

import {
  ConsentDecisionSchema,
  ConversationSchema,
  EntityIdSchema,
  EvidenceSchema,
  MemberSchema,
  PrivateContentSchema,
  PrivateMessageSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  type ConsentDecision,
  type EntityId,
  type Member,
  type SharedVisibility,
} from "../../../packages/contracts/src/index";

import {
  conversationRepositoryError,
  type ConfirmationLookup,
  type ConfirmationState,
  type ConfirmationWriteInput,
  type ConfirmationWriteResult,
  type ConsentAuthorizationLookup,
  type ConsentAuthorizationState,
  type ConversationRepository,
  type ConversationTransaction,
  type DraftSourceLookup,
  type DraftSourceState,
  type MessageCreationLookup,
  type MessageCreationState,
  type PrivateConversationState,
  type PrivateEvidenceRecord,
  type PrivateEvidenceState,
  type SharedSignalListState,
} from "./persistence";

const PrivateEvidenceRecordSchema = z.strictObject({
  evidence: EvidenceSchema,
  sourceMessageId: EntityIdSchema.nullable(),
  rawContent: PrivateContentSchema,
});

const InMemorySeedSchema = z.strictObject({
  spaces: z.array(SpaceSchema),
  members: z.array(MemberSchema),
  conversations: z.array(ConversationSchema),
  messages: z.array(PrivateMessageSchema).default([]),
  evidence: z.array(PrivateEvidenceRecordSchema).default([]),
  signalDrafts: z.array(SignalDraftSchema).default([]),
  consentDecisions: z.array(ConsentDecisionSchema).default([]),
  sharedSignals: z.array(SharedSignalSchema).default([]),
});

export type InMemoryConversationSeed = z.input<typeof InMemorySeedSchema>;

interface ConfirmationIdempotencyRecord {
  readonly spaceId: EntityId;
  readonly actorMemberId: EntityId;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly signalId: EntityId;
}

interface MutableState {
  spaces: z.output<typeof InMemorySeedSchema>["spaces"];
  members: z.output<typeof InMemorySeedSchema>["members"];
  conversations: z.output<typeof InMemorySeedSchema>["conversations"];
  messages: z.output<typeof InMemorySeedSchema>["messages"];
  evidence: z.output<typeof InMemorySeedSchema>["evidence"];
  signalDrafts: z.output<typeof InMemorySeedSchema>["signalDrafts"];
  consentDecisions: z.output<typeof InMemorySeedSchema>["consentDecisions"];
  sharedSignals: z.output<typeof InMemorySeedSchema>["sharedSignals"];
  confirmationIdempotency: ConfirmationIdempotencyRecord[];
}

export interface InMemoryConversationSnapshot {
  readonly spaces: MutableState["spaces"];
  readonly members: MutableState["members"];
  readonly conversations: MutableState["conversations"];
  readonly messages: MutableState["messages"];
  readonly evidence: MutableState["evidence"];
  readonly signalDrafts: MutableState["signalDrafts"];
  readonly consentDecisions: MutableState["consentDecisions"];
  readonly sharedSignals: MutableState["sharedSignals"];
}

export interface InMemoryConversationRepository
  extends ConversationRepository {
  inspect(): Promise<InMemoryConversationSnapshot>;
}

const findSpace = (state: MutableState, spaceId: EntityId) =>
  state.spaces.find((space) => space.id === spaceId);

const findMember = (
  state: MutableState,
  spaceId: EntityId,
  memberId: EntityId,
) =>
  state.members.find(
    (member) => member.spaceId === spaceId && member.id === memberId,
  );

const visibilityMemberIds = (
  visibility: SharedVisibility | null,
): readonly EntityId[] => {
  if (visibility === null || visibility.kind === "space") {
    return [];
  }

  return visibility.kind === "care_related"
    ? [...new Set([visibility.subjectId, ...visibility.memberIds])]
    : [...new Set(visibility.memberIds)];
};

const loadVisibilityMembers = (
  state: MutableState,
  spaceId: EntityId,
  visibility: SharedVisibility | null,
): readonly Member[] =>
  visibilityMemberIds(visibility)
    .map((memberId) => findMember(state, spaceId, memberId))
    .filter((member): member is Member => member !== undefined);

const loadMessageCreationState = (
  state: MutableState,
  lookup: MessageCreationLookup,
): MessageCreationState | undefined => {
  const space = findSpace(state, lookup.spaceId);
  const actorMember = findMember(
    state,
    lookup.spaceId,
    lookup.actorMemberId,
  );
  const conversation = state.conversations.find(
    (candidate) =>
      candidate.spaceId === lookup.spaceId &&
      candidate.id === lookup.conversationId,
  );

  return space === undefined || actorMember === undefined || conversation === undefined
    ? undefined
    : { actorMember, conversation, space };
};

const loadDraftSource = (
  state: MutableState,
  lookup: DraftSourceLookup,
): DraftSourceState | undefined => {
  const message = state.messages.find(
    (candidate) =>
      candidate.spaceId === lookup.spaceId &&
      candidate.id === lookup.privateMessageId,
  );
  const creationState =
    message === undefined
      ? undefined
      : loadMessageCreationState(state, {
          actorMemberId: lookup.actorMemberId,
          conversationId: lookup.conversationId ?? message.conversationId,
          spaceId: lookup.spaceId,
        });
  const evidence = lookup.evidenceIds.map((evidenceId) =>
    state.evidence.find(
      (record) =>
        record.evidence.spaceId === lookup.spaceId &&
        record.evidence.id === evidenceId,
    ),
  );

  if (
    creationState === undefined ||
    message === undefined ||
    evidence.some((record) => record === undefined)
  ) {
    return undefined;
  }

  return {
    ...creationState,
    evidence: evidence.filter(
      (record): record is PrivateEvidenceRecord => record !== undefined,
    ),
    message,
  };
};

const loadConsentAuthorizationState = (
  state: MutableState,
  lookup: ConsentAuthorizationLookup,
): ConsentAuthorizationState | undefined => {
  const space = findSpace(state, lookup.spaceId);
  const actorMember = findMember(
    state,
    lookup.spaceId,
    lookup.actorMemberId,
  );
  const draft = state.signalDrafts.find(
    (candidate) =>
      candidate.spaceId === lookup.spaceId &&
      candidate.id === lookup.signalDraftId,
  );
  if (space === undefined || actorMember === undefined || draft === undefined) {
    return undefined;
  }

  const evidence = draft.evidenceIds.map((evidenceId) =>
    state.evidence.find(
      (record) =>
        record.evidence.spaceId === lookup.spaceId &&
        record.evidence.id === evidenceId,
    ),
  );
  if (evidence.some((record) => record === undefined)) {
    return undefined;
  }

  return {
    actorMember,
    draft,
    evidence: evidence.filter(
      (record): record is PrivateEvidenceRecord => record !== undefined,
    ),
    existingDecision: state.consentDecisions.find(
      (decision) =>
        decision.spaceId === lookup.spaceId &&
        decision.signalDraftId === lookup.signalDraftId,
    ),
    space,
    visibilityMembers: loadVisibilityMembers(
      state,
      lookup.spaceId,
      lookup.visibility,
    ),
  };
};

const loadConfirmationState = (
  state: MutableState,
  lookup: ConfirmationLookup,
): ConfirmationState | undefined => {
  const consent = state.consentDecisions.find(
    (candidate) =>
      candidate.spaceId === lookup.spaceId &&
      candidate.id === lookup.consentDecisionId,
  );
  if (consent === undefined) {
    return undefined;
  }

  const authorization = loadConsentAuthorizationState(state, {
    actorMemberId: lookup.actorMemberId,
    signalDraftId: lookup.signalDraftId,
    spaceId: lookup.spaceId,
    visibility: consent.visibility,
  });
  if (authorization === undefined) {
    return undefined;
  }

  const sourceMessage = state.messages.find(
    (message) =>
      message.spaceId === lookup.spaceId &&
      message.id === authorization.draft.sourceMessageId,
  );
  const conversation =
    sourceMessage === undefined
      ? undefined
      : state.conversations.find(
          (candidate) =>
            candidate.spaceId === lookup.spaceId &&
            candidate.id === sourceMessage.conversationId,
        );

  return sourceMessage === undefined || conversation === undefined
    ? undefined
    : { ...authorization, consent, conversation, sourceMessage };
};

const createTransaction = (state: MutableState): ConversationTransaction => ({
  insertConsentDecision: (decision: ConsentDecision): Promise<void> => {
    if (
      state.consentDecisions.some(
        (existing) =>
          existing.id === decision.id ||
          (existing.spaceId === decision.spaceId &&
            existing.signalDraftId === decision.signalDraftId),
      )
    ) {
      throw conversationRepositoryError("conflict");
    }
    state.consentDecisions.push(structuredClone(decision));
    return Promise.resolve();
  },
  insertPrivateMessage: (message): Promise<void> => {
    if (
      state.messages.some(
        (existing) =>
          existing.id === message.id ||
          (existing.spaceId === message.spaceId &&
            existing.conversationId === message.conversationId &&
            existing.clientMessageId === message.clientMessageId),
      )
    ) {
      throw conversationRepositoryError("conflict");
    }
    state.messages.push(structuredClone(message));
    return Promise.resolve();
  },
  insertPrivateEvidence: (record): Promise<void> => {
    if (
      state.evidence.some(
        (existing) => existing.evidence.id === record.evidence.id,
      )
    ) {
      throw conversationRepositoryError("conflict");
    }
    state.evidence.push(structuredClone(record));
    return Promise.resolve();
  },
  insertSharedSignal: (
    input: ConfirmationWriteInput,
  ): Promise<ConfirmationWriteResult> => {
    const existingClaim = state.confirmationIdempotency.find(
      (claim) =>
        claim.spaceId === input.signal.spaceId &&
        claim.actorMemberId === input.actorMemberId &&
        claim.idempotencyKey === input.idempotencyKey,
    );
    if (existingClaim !== undefined) {
      if (existingClaim.requestHash !== input.requestHash) {
        return Promise.resolve({ status: "conflict" });
      }
      const signal = state.sharedSignals.find(
        (candidate) => candidate.id === existingClaim.signalId,
      );
      if (signal === undefined) {
        throw conversationRepositoryError("internal_failure");
      }
      return Promise.resolve({
        signal: structuredClone(signal),
        status: "replayed",
      });
    }

    if (
      state.sharedSignals.some(
        (existing) =>
          existing.id === input.signal.id ||
          (existing.spaceId === input.signal.spaceId &&
            existing.consentDecisionId === input.signal.consentDecisionId),
      )
    ) {
      throw conversationRepositoryError("conflict");
    }

    state.sharedSignals.push(structuredClone(input.signal));
    state.confirmationIdempotency.push({
      actorMemberId: input.actorMemberId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      signalId: input.signal.id,
      spaceId: input.signal.spaceId,
    });
    return Promise.resolve({
      signal: structuredClone(input.signal),
      status: "inserted",
    });
  },
  insertSignalDraft: (draft): Promise<void> => {
    if (state.signalDrafts.some((existing) => existing.id === draft.id)) {
      throw conversationRepositoryError("conflict");
    }
    state.signalDrafts.push(structuredClone(draft));
    return Promise.resolve();
  },
  loadConfirmationState: (lookup) =>
    Promise.resolve(structuredClone(loadConfirmationState(state, lookup))),
  loadConsentAuthorizationState: (lookup) =>
    Promise.resolve(
      structuredClone(loadConsentAuthorizationState(state, lookup)),
    ),
  loadDraftSource: (lookup) =>
    Promise.resolve(structuredClone(loadDraftSource(state, lookup))),
  loadMessageCreationState: (lookup) =>
    Promise.resolve(structuredClone(loadMessageCreationState(state, lookup))),
  lockConfirmationState: (): Promise<void> => {
    // The repository serializes and snapshots the entire transaction. A
    // PostgreSQL adapter must replace this with the row-lock contract above.
    return Promise.resolve();
  },
});

const parseSeed = (seed: InMemoryConversationSeed): MutableState => {
  const parsed = InMemorySeedSchema.safeParse(seed);
  if (!parsed.success) {
    throw conversationRepositoryError("internal_failure");
  }

  return {
    ...structuredClone(parsed.data),
    confirmationIdempotency: [],
  };
};

/** Fixture-grade serialized, copy-on-write repository. */
export const createInMemoryConversationRepository = (
  seed: InMemoryConversationSeed,
): InMemoryConversationRepository => {
  let state = parseSeed(seed);
  let transactionTail = Promise.resolve();

  const waitForWrites = async (): Promise<void> => transactionTail;

  const repository: InMemoryConversationRepository = {
    inspect: async () => {
      await waitForWrites();
      return structuredClone({
        consentDecisions: state.consentDecisions,
        conversations: state.conversations,
        evidence: state.evidence,
        members: state.members,
        messages: state.messages,
        sharedSignals: state.sharedSignals,
        signalDrafts: state.signalDrafts,
        spaces: state.spaces,
      });
    },
    loadDraftSource: async (lookup) => {
      await waitForWrites();
      return structuredClone(loadDraftSource(state, lookup));
    },
    loadPrivateConversationState: async (
      lookup: MessageCreationLookup,
    ): Promise<PrivateConversationState | undefined> => {
      await waitForWrites();
      const creationState = loadMessageCreationState(state, lookup);
      return creationState === undefined
        ? undefined
        : structuredClone({
            ...creationState,
            messages: state.messages.filter(
              (message) =>
                message.spaceId === lookup.spaceId &&
                message.conversationId === lookup.conversationId,
            ),
          });
    },
    loadPrivateEvidenceState: async (
      spaceId,
      actorMemberId,
      evidenceId,
    ): Promise<PrivateEvidenceState | undefined> => {
      await waitForWrites();
      const space = findSpace(state, spaceId);
      const actorMember = findMember(state, spaceId, actorMemberId);
      const record = state.evidence.find(
        (candidate) =>
          candidate.evidence.spaceId === spaceId &&
          candidate.evidence.id === evidenceId,
      );
      return space === undefined || actorMember === undefined || record === undefined
        ? undefined
        : structuredClone({ actorMember, record, space });
    },
    loadSharedSignalListState: async (
      spaceId,
      actorMemberId,
    ): Promise<SharedSignalListState | undefined> => {
      await waitForWrites();
      const space = findSpace(state, spaceId);
      const actorMember = findMember(state, spaceId, actorMemberId);
      return space === undefined || actorMember === undefined
        ? undefined
        : structuredClone({
            actorMember,
            signals: state.sharedSignals.filter(
              (signal) => signal.spaceId === spaceId,
            ),
            space,
          });
    },
    transaction: async <Result>(
      work: (transaction: ConversationTransaction) => Promise<Result>,
    ): Promise<Result> => {
      const previous = transactionTail;
      let release: (() => void) | undefined;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      const workingState = structuredClone(state);
      try {
        const result = await work(createTransaction(workingState));
        state = workingState;
        return result;
      } finally {
        release?.();
      }
    },
  };

  return Object.freeze(repository);
};
