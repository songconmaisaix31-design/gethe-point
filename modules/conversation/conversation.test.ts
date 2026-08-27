import { describe, expect, it, vi } from "vitest";

import {
  type ActiveShareConsent,
  type Clock,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type LLMProvider,
  type LLMProviderResult,
  type Member,
  type MemberActor,
  type PrivateMessage,
  type SharedSignal,
  type SignalDraft,
  type Space,
} from "../../packages/contracts/src/index";
import { isConversationOperationError } from "./errors";
import type {
  AnalysisContext,
  ConfirmationContext,
  ConsentContext,
  ConversationReader,
  ConversationStore,
  ConversationTransaction,
  MessageCreationContext,
  PrivateEvidenceRecord,
} from "./ports";
import { createConversationService, type ConversationIdFactory } from "./service";
import {
  captureAnalysisExpectedState,
  captureConfirmationExpectedState,
  captureConsentExpectedState,
  captureMessageCreationExpectedState,
  expectedStateMatches,
} from "./state-expectations";

const id = (suffix: number): EntityId =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const IDS = Object.freeze({
  space: id(1),
  actor: id(2),
  other: id(3),
  conversation: id(4),
  message: id(5),
  evidence: id(6),
  draft: id(7),
  consent: id(8),
  signal: id(9),
  clientMessage: id(10),
  request: id(11),
  request2: id(12),
});

const CREATED_AT = "2026-08-28T00:00:00.000Z";
const NOW = "2026-08-28T01:00:00.000Z";
const EXPIRES_AT = "2026-08-29T01:00:00.000Z";
const PRIVATE_CONTENT = "Private family note alpha.";

const record = (recordId: EntityId) => ({
  id: recordId,
  spaceId: IDS.space,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  version: 0,
});

const createSpace = (): Space => ({
  ...record(IDS.space),
  name: "Fixture family",
  createdBy: IDS.actor,
  status: "active",
});

const createMember = (
  memberId: EntityId,
  role: Member["role"],
): Member => ({
  ...record(memberId),
  role,
  displayName: role,
  status: "active",
  joinedAt: CREATED_AT,
  analysisConsent: "enabled",
});

const createConversation = (): Conversation => ({
  ...record(IDS.conversation),
  type: "agent_dm",
  participantMemberIds: [IDS.actor, IDS.other],
});

const createMessage = (): PrivateMessage => ({
  ...record(IDS.message),
  conversationId: IDS.conversation,
  authorId: IDS.actor,
  clientMessageId: IDS.clientMessage,
  content: PRIVATE_CONTENT,
  occurredAt: CREATED_AT,
  visibility: { kind: "self", memberId: IDS.actor },
});

const createEvidence = (): PrivateEvidenceRecord => ({
  evidence: {
    ...record(IDS.evidence),
    sourceType: "agent_dm",
    speakerId: IDS.actor,
    occurredAt: CREATED_AT,
    rawRef: `message:${IDS.message}`,
    visibility: { kind: "self", memberId: IDS.actor },
    state: "available",
  },
  rawContent: PRIVATE_CONTENT,
  sourceMessageId: IDS.message,
});

const createDraft = (): SignalDraft => ({
  ...record(IDS.draft),
  speakerId: IDS.actor,
  sourceMessageId: IDS.message,
  evidenceIds: [IDS.evidence],
  kind: "potential_task",
  redactedExcerpt: "Potential responsibility topic: schedule coordination",
  proposedConclusion:
    "Review this possible responsibility action: review the next appointment",
  candidateDomainId: null,
  confidence: 0.8,
  missingInfo: ["appointment date"],
  promptVersion: "signal-v1",
  source: "validated_ai",
});

const createConsent = (): ActiveShareConsent => ({
  ...record(IDS.consent),
  signalDraftId: IDS.draft,
  speakerId: IDS.actor,
  decidedAt: NOW,
  recordState: "active",
  outcome: "share",
  visibility: { kind: "members", memberIds: [IDS.actor, IDS.other] },
  expiresAt: EXPIRES_AT,
  revokedAt: null,
});

const ACTOR: MemberActor = {
  kind: "member",
  memberId: IDS.actor,
  spaceId: IDS.space,
  role: "subject",
  authentication: "verified_session",
};

const OTHER_ACTOR: MemberActor = {
  kind: "member",
  memberId: IDS.other,
  spaceId: IDS.space,
  role: "partner",
  authentication: "verified_session",
};

const validProviderOutput = () => ({
  kind: "potential_task" as const,
  topic: "schedule coordination",
  suggestedAction: "review the next appointment",
  candidateDomainId: null,
  confidence: 0.8,
  missingInfo: ["appointment date"],
});

const completed = (output: unknown): LLMProviderResult => ({
  status: "completed",
  completion: {
    output,
    latencyMs: 3,
    usage: { inputTokens: 5, outputTokens: 4 },
  },
});

class SequentialIdFactory implements ConversationIdFactory {
  private nextSuffix = 100;

  next(): EntityId {
    const value = id(this.nextSuffix);
    this.nextSuffix += 1;
    return value;
  }
}

class FixtureClock implements Clock {
  readonly transactionStates: boolean[] = [];
  private readonly instants: readonly Date[];
  private index = 0;

  constructor(
    private readonly store: FixtureStore,
    instants: readonly string[] = [NOW],
  ) {
    this.instants = instants.map((instant) => new Date(instant));
  }

  now(): Date {
    this.transactionStates.push(this.store.transactionActive);
    const value = this.instants[Math.min(this.index, this.instants.length - 1)];
    this.index += 1;
    if (value === undefined) {
      throw new Error("Fixture clock is empty.");
    }
    return new Date(value);
  }
}

type Drift =
  | "actor_inactive"
  | "analysis_revoked"
  | "consent_revoked"
  | "draft_version"
  | "evidence_deleted"
  | "message_version"
  | "visibility_inactive";

class FixtureStore implements ConversationStore {
  space = createSpace();
  readonly members = new Map<EntityId, Member>([
    [IDS.actor, createMember(IDS.actor, "subject")],
    [IDS.other, createMember(IDS.other, "partner")],
  ]);
  conversation = createConversation();
  readonly messages = new Map<EntityId, PrivateMessage>([
    [IDS.message, createMessage()],
  ]);
  readonly evidence = new Map<EntityId, PrivateEvidenceRecord>([
    [IDS.evidence, createEvidence()],
  ]);
  readonly drafts = new Map<EntityId, SignalDraft>();
  readonly consents = new Map<EntityId, ConsentDecision>();
  readonly signals = new Map<EntityId, SharedSignal>();
  readonly replays = new Map<string, { requestHash: string; signal: SharedSignal }>();

  transactionActive = false;
  privateMessageWrites = 0;
  evidenceWrites = 0;
  draftWrites = 0;
  consentWrites = 0;
  signalWrites = 0;
  taskWrites = 0;
  reportFactWrites = 0;
  confirmationRecordWrites = 0;

  onReadConfirmation: (() => void) | undefined;
  beforeConfirmPersist: (() => void) | undefined;

  seedDraftAndConsent(): void {
    this.drafts.set(IDS.draft, createDraft());
    this.consents.set(IDS.consent, createConsent());
  }

  setPrivateContent(content: string): void {
    const message = this.messages.get(IDS.message);
    const evidence = this.evidence.get(IDS.evidence);
    if (message !== undefined) {
      this.messages.set(IDS.message, { ...message, content });
    }
    if (evidence !== undefined) {
      this.evidence.set(IDS.evidence, { ...evidence, rawContent: content });
    }
  }

  applyDrift(drift: Drift): void {
    switch (drift) {
      case "actor_inactive": {
        const actor = this.members.get(IDS.actor);
        if (actor !== undefined) {
          this.members.set(IDS.actor, {
            ...actor,
            status: "inactive",
            version: actor.version + 1,
          });
        }
        return;
      }
      case "analysis_revoked": {
        const actor = this.members.get(IDS.actor);
        if (actor !== undefined) {
          this.members.set(IDS.actor, {
            ...actor,
            analysisConsent: "revoked",
            version: actor.version + 1,
          });
        }
        return;
      }
      case "consent_revoked": {
        const consent = this.consents.get(IDS.consent);
        if (consent?.outcome === "share" && consent.recordState === "active") {
          this.consents.set(IDS.consent, {
            ...consent,
            recordState: "revoked",
            revokedAt: NOW,
            version: consent.version + 1,
          });
        }
        return;
      }
      case "draft_version": {
        const draft = this.drafts.get(IDS.draft);
        if (draft !== undefined) {
          this.drafts.set(IDS.draft, { ...draft, version: draft.version + 1 });
        }
        return;
      }
      case "evidence_deleted": {
        const current = this.evidence.get(IDS.evidence);
        if (current !== undefined) {
          this.evidence.set(IDS.evidence, {
            ...current,
            evidence: {
              ...current.evidence,
              state: "deleted",
              version: current.evidence.version + 1,
            },
          });
        }
        return;
      }
      case "message_version": {
        const message = this.messages.get(IDS.message);
        if (message !== undefined) {
          this.messages.set(IDS.message, {
            ...message,
            version: message.version + 1,
          });
        }
        return;
      }
      case "visibility_inactive": {
        const member = this.members.get(IDS.other);
        if (member !== undefined) {
          this.members.set(IDS.other, {
            ...member,
            status: "inactive",
            version: member.version + 1,
          });
        }
      }
    }
  }

  private messageCreationContext(actorId: EntityId): MessageCreationContext | undefined {
    const actor = this.members.get(actorId);
    return actor === undefined
      ? undefined
      : { space: this.space, actor, conversation: this.conversation };
  }

  private analysisContext(input: {
    actorId: EntityId;
    privateMessageId: EntityId;
    evidenceIds: readonly EntityId[];
  }): AnalysisContext | undefined {
    const base = this.messageCreationContext(input.actorId);
    const message = this.messages.get(input.privateMessageId);
    if (base === undefined || message === undefined) {
      return undefined;
    }
    return {
      ...base,
      message,
      evidence: input.evidenceIds.flatMap((evidenceId) => {
        const found = this.evidence.get(evidenceId);
        return found === undefined ? [] : [found];
      }),
    };
  }

  private consentContext(input: {
    actorId: EntityId;
    signalDraftId: EntityId;
    visibilityMemberIds: readonly EntityId[];
  }): ConsentContext | undefined {
    const actor = this.members.get(input.actorId);
    const draft = this.drafts.get(input.signalDraftId);
    if (actor === undefined || draft === undefined) {
      return undefined;
    }
    return {
      space: this.space,
      actor,
      draft,
      evidence: draft.evidenceIds.flatMap((evidenceId) => {
        const found = this.evidence.get(evidenceId);
        return found === undefined ? [] : [found];
      }),
      visibilityMembers: input.visibilityMemberIds.flatMap((memberId) => {
        const found = this.members.get(memberId);
        return found === undefined ? [] : [found];
      }),
    };
  }

  private confirmationContext(input: {
    actorId: EntityId;
    signalDraftId: EntityId;
    consentDecisionId: EntityId;
  }): ConfirmationContext | undefined {
    const consent = this.consents.get(input.consentDecisionId);
    const visibility = consent?.visibility ?? null;
    const visibilityIds =
      visibility === null
        ? []
        : visibility.kind === "space"
          ? []
          : visibility.kind === "members"
            ? visibility.memberIds
            : [visibility.subjectId, ...visibility.memberIds];
    const context = this.consentContext({
      actorId: input.actorId,
      signalDraftId: input.signalDraftId,
      visibilityMemberIds: visibilityIds,
    });
    return context === undefined ? undefined : { ...context, consent };
  }

  private reader(): ConversationReader {
    return {
      loadAnalysisContext: (input) => Promise.resolve(this.analysisContext(input)),
      loadPrivateConversation: (input) => {
        const actor = this.members.get(input.actorId);
        return Promise.resolve(
          actor === undefined
            ? undefined
            : {
                space: this.space,
                actor,
                conversation: this.conversation,
                messages: [...this.messages.values()],
                page: { nextCursor: null, hasMore: false },
              },
        );
      },
      loadRawEvidence: (input) => {
        const actor = this.members.get(input.actorId);
        const evidence = this.evidence.get(input.evidenceId);
        return Promise.resolve(
          actor === undefined || evidence === undefined
            ? undefined
            : { space: this.space, actor, evidence },
        );
      },
      loadVisibleSignals: (input) => {
        const actor = this.members.get(input.actorId);
        return Promise.resolve(
          actor === undefined
            ? undefined
            : {
                space: this.space,
                actor,
                signals: [...this.signals.values()],
                page: { nextCursor: null, hasMore: false },
              },
        );
      },
    };
  }

  private transactionPort(): ConversationTransaction {
    return {
      lockMessageCreationContext: (input) =>
        Promise.resolve(this.messageCreationContext(input.actorId)),
      persistPrivateMessage: (input) => {
        const current = this.messageCreationContext(input.message.authorId);
        if (
          current === undefined ||
          !expectedStateMatches(
            captureMessageCreationExpectedState(current),
            input.expected,
          )
        ) {
          return Promise.resolve("stale");
        }
        if (
          [...this.messages.values()].some(
            (message) =>
              message.conversationId === input.message.conversationId &&
              message.clientMessageId === input.message.clientMessageId,
          )
        ) {
          return Promise.resolve("conflict");
        }
        this.messages.set(input.message.id, input.message);
        this.evidence.set(input.evidence.evidence.id, input.evidence);
        this.privateMessageWrites += 1;
        this.evidenceWrites += 1;
        return Promise.resolve("inserted");
      },
      lockAnalysisContext: (input) =>
        Promise.resolve(this.analysisContext(input)),
      persistSignalDraft: (input) => {
        const current = this.analysisContext({
          actorId: input.draft.speakerId,
          privateMessageId: input.draft.sourceMessageId,
          evidenceIds: input.draft.evidenceIds,
        });
        if (
          current === undefined ||
          !expectedStateMatches(captureAnalysisExpectedState(current), input.expected)
        ) {
          return Promise.resolve("stale");
        }
        this.drafts.set(input.draft.id, input.draft);
        this.draftWrites += 1;
        return Promise.resolve("inserted");
      },
      lockConsentContext: (input) =>
        Promise.resolve(this.consentContext(input)),
      persistConsentDecision: (input) => {
        const visibility = input.decision.visibility;
        const visibilityIds =
          visibility === null
            ? []
            : visibility.kind === "space"
              ? []
              : visibility.kind === "members"
                ? visibility.memberIds
                : [visibility.subjectId, ...visibility.memberIds];
        const current = this.consentContext({
          actorId: input.decision.speakerId,
          signalDraftId: input.decision.signalDraftId,
          visibilityMemberIds: visibilityIds,
        });
        if (
          current === undefined ||
          !expectedStateMatches(captureConsentExpectedState(current), input.expected)
        ) {
          return Promise.resolve("stale");
        }
        if (
          [...this.consents.values()].some(
            (consent) => consent.signalDraftId === input.decision.signalDraftId,
          )
        ) {
          return Promise.resolve("conflict");
        }
        this.consents.set(input.decision.id, input.decision);
        this.consentWrites += 1;
        return Promise.resolve("inserted");
      },
      findConfirmationReplay: (input) =>
        Promise.resolve(
          this.replays.get(`${input.actorId}:${input.idempotencyKey}`),
        ),
      lockConfirmationContext: (input) =>
        Promise.resolve(this.confirmationContext(input)),
      readConfirmationContext: (input) => {
        this.onReadConfirmation?.();
        this.onReadConfirmation = undefined;
        return Promise.resolve(this.confirmationContext(input));
      },
      persistConfirmedSignal: (input) => {
        this.beforeConfirmPersist?.();
        this.beforeConfirmPersist = undefined;
        const current = this.confirmationContext({
          actorId: input.signal.speakerId,
          signalDraftId: input.consent.signalDraftId,
          consentDecisionId: input.consent.id,
        });
        const currentExpected =
          current === undefined
            ? undefined
            : captureConfirmationExpectedState(current);
        if (
          currentExpected === undefined ||
          !expectedStateMatches(currentExpected, input.expected)
        ) {
          return Promise.resolve("stale");
        }
        if (
          [...this.signals.values()].some(
            (signal) => signal.consentDecisionId === input.consent.id,
          )
        ) {
          return Promise.resolve("conflict");
        }
        this.signals.set(input.signal.id, input.signal);
        this.replays.set(
          `${input.signal.speakerId}:${input.idempotencyKey}`,
          { requestHash: input.requestHash, signal: input.signal },
        );
        this.signalWrites += 1;
        this.confirmationRecordWrites += 1;
        return Promise.resolve("inserted");
      },
    };
  }

  async read<Result>(
    work: (reader: ConversationReader) => Promise<Result>,
  ): Promise<Result> {
    return work(this.reader());
  }

  async transaction<Result>(
    work: (transaction: ConversationTransaction) => Promise<Result>,
  ): Promise<Result> {
    this.transactionActive = true;
    try {
      return await work(this.transactionPort());
    } finally {
      this.transactionActive = false;
    }
  }
}

const createHarness = (
  store = new FixtureStore(),
  providerImplementation: LLMProvider["complete"] = () =>
    Promise.resolve(completed(validProviderOutput())),
  clock = new FixtureClock(store),
) => {
  let providerCalls = 0;
  const provider: LLMProvider = {
    complete: (request, signal) => {
      providerCalls += 1;
      return providerImplementation(request, signal);
    },
  };
  const service = createConversationService({
    store,
    provider,
    clock,
    idFactory: new SequentialIdFactory(),
    providerTimeoutMs: 5,
  });
  return { service, store, clock, providerCalls: () => providerCalls };
};

const draftRequest = () => ({
  requestId: IDS.request,
  privateMessageId: IDS.message,
  evidenceIds: [IDS.evidence],
  purpose: "signal_draft" as const,
  promptVersion: "signal-v1",
});

const confirmationRequest = (overrides: Partial<{ expectedDraftVersion: number }> = {}) => ({
  requestId: IDS.request2,
  idempotencyKey: "confirm-signal-0001",
  signalDraftId: IDS.draft,
  consentDecisionId: IDS.consent,
  expectedDraftVersion: overrides.expectedDraftVersion ?? 0,
});

const expectConversationError = async (
  promise: Promise<unknown>,
  code?: string,
): Promise<void> => {
  try {
    await promise;
    throw new Error("Expected a conversation error.");
  } catch (error) {
    expect(isConversationOperationError(error)).toBe(true);
    if (isConversationOperationError(error) && code !== undefined) {
      expect(error.code).toBe(code);
    }
  }
};

describe("CreateSignalDraft authorization and risk routing", () => {
  it.each([
    "actor_inactive",
    "analysis_revoked",
    "evidence_deleted",
  ] as const)("fails %s before provider invocation", async (drift) => {
    const store = new FixtureStore();
    store.applyDrift(drift);
    const harness = createHarness(store);

    await expectConversationError(
      harness.service.createSignalDraft(ACTOR, draftRequest()),
    );
    expect(harness.providerCalls()).toBe(0);
    expect(store.draftWrites).toBe(0);
    expect(store.signalWrites).toBe(0);
  });

  it("fails missing, mismatched, cross-space, and non-private source state before provider", async () => {
    const stores = [
      (() => {
        const store = new FixtureStore();
        store.evidence.delete(IDS.evidence);
        return store;
      })(),
      (() => {
        const store = new FixtureStore();
        const evidence = store.evidence.get(IDS.evidence);
        if (evidence !== undefined) {
          store.evidence.set(IDS.evidence, {
            ...evidence,
            evidence: { ...evidence.evidence, speakerId: IDS.other },
          });
        }
        return store;
      })(),
      (() => {
        const store = new FixtureStore();
        const message = store.messages.get(IDS.message);
        if (message !== undefined) {
          store.messages.set(IDS.message, { ...message, spaceId: id(999) });
        }
        return store;
      })(),
      (() => {
        const store = new FixtureStore();
        store.conversation = { ...store.conversation, type: "family_group" };
        return store;
      })(),
    ];

    for (const store of stores) {
      const harness = createHarness(store);
      await expectConversationError(
        harness.service.createSignalDraft(ACTOR, draftRequest()),
      );
      expect(harness.providerCalls()).toBe(0);
      expect(store.draftWrites).toBe(0);
    }
  });

  it.each([
    "I might kill myself tonight.",
    "My partner hit me at home.",
    "I have chest pain and cannot breathe.",
  ])("bypasses the provider and creates only a private high-risk draft: %s", async (content) => {
    const store = new FixtureStore();
    store.setPrivateContent(content);
    const harness = createHarness(store);

    const result = await harness.service.createSignalDraft(ACTOR, draftRequest());

    expect(result).toMatchObject({
      status: "draft_created",
      draft: { kind: "high_risk", source: "fixture" },
      metadata: { providerOutcome: "fixture", contentLogged: false },
    });
    expect(harness.providerCalls()).toBe(0);
    expect(store.draftWrites).toBe(1);
    expect(store.signalWrites).toBe(0);
    expect(store.taskWrites).toBe(0);
    expect(store.reportFactWrites).toBe(0);
  });

  it.each([
    "actor_inactive",
    "analysis_revoked",
    "evidence_deleted",
    "message_version",
  ] as const)("writes no draft when %s changes during provider execution", async (drift) => {
    const store = new FixtureStore();
    const harness = createHarness(store, () => {
      store.applyDrift(drift);
      return Promise.resolve(completed(validProviderOutput()));
    });

    await expectConversationError(
      harness.service.createSignalDraft(ACTOR, draftRequest()),
    );
    expect(harness.providerCalls()).toBe(1);
    expect(store.draftWrites).toBe(0);
    expect(store.signalWrites).toBe(0);
  });

  it("returns needs_human_review after invalid output without mutation", async () => {
    const harness = createHarness(
      new FixtureStore(),
      () => Promise.resolve(completed({ kind: "potential_task" })),
    );

    const result = await harness.service.createSignalDraft(ACTOR, draftRequest());

    expect(result).toMatchObject({
      status: "needs_human_review",
      reason: "provider_invalid_output",
      attempts: 2,
      consequentialMutationAllowed: false,
    });
    expect(harness.providerCalls()).toBe(2);
    expect(harness.store.draftWrites).toBe(0);
    expect(harness.store.signalWrites).toBe(0);
  });

  it("keeps synchronous, asynchronous, and timeout failures mutation-free", async () => {
    const scenarios: readonly {
      readonly implementation: LLMProvider["complete"];
      readonly reason: "provider_timeout" | "provider_unavailable";
    }[] = [
      {
        implementation: () => {
          throw new Error(PRIVATE_CONTENT);
        },
        reason: "provider_unavailable",
      },
      {
        implementation: () => Promise.reject(new Error(PRIVATE_CONTENT)),
        reason: "provider_unavailable",
      },
      {
        implementation: () => new Promise<LLMProviderResult>(() => undefined),
        reason: "provider_timeout",
      },
    ];

    for (const scenario of scenarios) {
      const harness = createHarness(new FixtureStore(), scenario.implementation);
      const result = await harness.service.createSignalDraft(ACTOR, draftRequest());

      expect(result).toMatchObject({
        status: "needs_human_review",
        reason: scenario.reason,
        attempts: 2,
        consequentialMutationAllowed: false,
      });
      expect(harness.providerCalls()).toBe(2);
      expect(harness.store.draftWrites).toBe(0);
      expect(harness.store.signalWrites).toBe(0);
    }
  });
});

describe("private message isolation", () => {
  it("creates only self-visible message/evidence and returns nothing cross-role", async () => {
    const harness = createHarness();
    const result = await harness.service.createPrivateMessage(ACTOR, {
      requestId: IDS.request,
      conversationId: IDS.conversation,
      clientMessageId: id(20),
      content: "A second private note.",
      occurredAt: NOW,
    });
    const newEvidence = [...harness.store.evidence.values()].find(
      (recordValue) => recordValue.sourceMessageId === result.message.id,
    );

    expect(result.message.visibility).toEqual({
      kind: "self",
      memberId: IDS.actor,
    });
    expect(harness.store.privateMessageWrites).toBe(1);
    expect(harness.store.evidenceWrites).toBe(1);
    expect(harness.store.signalWrites).toBe(0);
    expect(harness.store.taskWrites).toBe(0);
    expect(harness.store.reportFactWrites).toBe(0);
    expect(harness.store.confirmationRecordWrites).toBe(0);

    const otherConversation = await harness.service.getPrivateConversation(
      OTHER_ACTOR,
      {
        requestId: IDS.request2,
        conversationId: IDS.conversation,
        page: { cursor: null, limit: 100 },
      },
    );
    expect(otherConversation.conversation.messages).toEqual([]);

    expect(newEvidence).toBeDefined();
    if (newEvidence !== undefined) {
      await expectConversationError(
        harness.service.getRawEvidence(OTHER_ACTOR, {
          requestId: IDS.request2,
          evidenceId: newEvidence.evidence.id,
        }),
        "not_found",
      );
    }
  });

  it("does not expose a guessed pre-existing raw-evidence identifier", async () => {
    const harness = createHarness();

    await expectConversationError(
      harness.service.getRawEvidence(OTHER_ACTOR, {
        requestId: IDS.request2,
        evidenceId: IDS.evidence,
      }),
      "not_found",
    );
  });
});

describe("per-signal consent and transaction-safe confirmation", () => {
  it("completes the explicit flow, rereads in one transaction, and replays once", async () => {
    const harness = createHarness();
    const draftResult = await harness.service.createSignalDraft(ACTOR, draftRequest());
    expect(draftResult.status).toBe("draft_created");
    if (draftResult.status !== "draft_created") {
      return;
    }

    const consentResult = await harness.service.decideConsent(ACTOR, {
      requestId: IDS.request2,
      signalDraftId: draftResult.draft.id,
      decision: "share",
      visibility: { kind: "members", memberIds: [IDS.actor, IDS.other] },
      decidedAt: NOW,
      expiresAt: EXPIRES_AT,
    });
    const request = {
      requestId: id(30),
      idempotencyKey: "confirm-signal-0030",
      signalDraftId: draftResult.draft.id,
      consentDecisionId: consentResult.decision.id,
      expectedDraftVersion: draftResult.draft.version,
    };

    const confirmed = await harness.service.confirmSignal(ACTOR, request);
    const replayed = await harness.service.confirmSignal(ACTOR, request);

    expect(confirmed.signal.id).toBe(replayed.signal.id);
    expect(confirmed.signal.provenance).toEqual([
      expect.objectContaining({ evidenceId: IDS.evidence, speakerId: IDS.actor }),
    ]);
    expect(JSON.stringify(confirmed.signal)).not.toContain(PRIVATE_CONTENT);
    expect(harness.store.signalWrites).toBe(1);
    expect(harness.store.confirmationRecordWrites).toBe(1);
    expect(harness.clock.transactionStates.every(Boolean)).toBe(true);
  });

  it("rejects wrong-speaker consent and high-risk sharing", async () => {
    const store = new FixtureStore();
    store.seedDraftAndConsent();
    const harness = createHarness(store);

    await expectConversationError(
      harness.service.confirmSignal(OTHER_ACTOR, confirmationRequest()),
      "not_found",
    );

    store.drafts.set(IDS.draft, { ...createDraft(), kind: "high_risk" });
    await expectConversationError(
      harness.service.confirmSignal(ACTOR, confirmationRequest()),
      "consent_invalid",
    );
    expect(store.signalWrites).toBe(0);
  });

  it.each([
    "actor_inactive",
    "analysis_revoked",
    "consent_revoked",
    "draft_version",
    "evidence_deleted",
    "visibility_inactive",
  ] as const)("writes no signal when %s drifts before the transaction reread", async (drift) => {
    const store = new FixtureStore();
    store.seedDraftAndConsent();
    store.onReadConfirmation = () => {
      store.applyDrift(drift);
    };
    const harness = createHarness(store);

    await expectConversationError(
      harness.service.confirmSignal(ACTOR, confirmationRequest()),
    );
    expect(store.signalWrites).toBe(0);
    expect(store.confirmationRecordWrites).toBe(0);
  });

  it.each([
    "actor_inactive",
    "analysis_revoked",
    "consent_revoked",
    "draft_version",
    "evidence_deleted",
    "visibility_inactive",
  ] as const)("conditional persistence blocks %s after reread", async (drift) => {
    const store = new FixtureStore();
    store.seedDraftAndConsent();
    store.beforeConfirmPersist = () => {
      store.applyDrift(drift);
    };
    const harness = createHarness(store);

    await expectConversationError(
      harness.service.confirmSignal(ACTOR, confirmationRequest()),
      "stale_version",
    );
    expect(store.signalWrites).toBe(0);
    expect(store.confirmationRecordWrites).toBe(0);
  });

  it("checks expiry again immediately before persistence", async () => {
    const store = new FixtureStore();
    store.seedDraftAndConsent();
    const consent = store.consents.get(IDS.consent);
    if (consent?.recordState === "active") {
      store.consents.set(IDS.consent, {
        ...consent,
        expiresAt: "2026-08-28T01:00:01.000Z",
      });
    }
    const clock = new FixtureClock(store, [
      "2026-08-28T01:00:00.000Z",
      "2026-08-28T01:00:02.000Z",
    ]);
    const harness = createHarness(store, undefined, clock);

    await expectConversationError(
      harness.service.confirmSignal(ACTOR, confirmationRequest()),
      "consent_invalid",
    );
    expect(store.signalWrites).toBe(0);
    expect(clock.transactionStates).toEqual([true, true]);
  });

  it("disclosure-checks the final shared signal before persistence", async () => {
    const store = new FixtureStore();
    store.seedDraftAndConsent();
    store.setPrivateContent("Straße family detail");
    store.drafts.set(IDS.draft, {
      ...createDraft(),
      redactedExcerpt: "STRASSE family detail",
    });
    const harness = createHarness(store);

    await expectConversationError(
      harness.service.confirmSignal(ACTOR, confirmationRequest()),
      "consent_invalid",
    );
    expect(store.signalWrites).toBe(0);
  });
});

describe("content-free failure surfaces", () => {
  it("does not log or return provider exception content", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = createHarness(new FixtureStore(), () => {
      throw new Error(PRIVATE_CONTENT);
    });

    const result = await harness.service.createSignalDraft(ACTOR, draftRequest());

    expect(result).toMatchObject({
      status: "needs_human_review",
      reason: "provider_unavailable",
      metadata: { contentLogged: false },
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_CONTENT);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
