import { describe, expect, it } from "vitest";

import {
  ConsentDecisionSchema,
  ConversationSchema,
  EvidenceSchema,
  FIXTURE_ACTORS,
  FIXTURE_CONVERSATION,
  FIXTURE_EVIDENCE,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_SPACE,
  FIXTURE_TIMES,
  MemberSchema,
  PrivateMessageSchema,
  SpaceSchema,
  type Clock,
  type LLMProvider,
  type LLMProviderResult,
  type MemberActor,
} from "../../../packages/contracts/src/index";
import {
  ValidatedSignalDraftCandidateSchema,
  createSignalDraftGenerator,
  renderProviderSignalDraft,
  type SignalDraftGenerator,
  type ValidatedSignalDraftCandidate,
} from "../../ai-witness/src/index";
import type {
  SafeLogger,
  SafeOperationLog,
} from "../../boundary/src/index";
import {
  createConversationHandlers,
  createInMemoryConversationStore,
  createSequenceEntityIdGenerator,
  type ConversationHandlers,
  type InMemoryConversationStore,
} from "../src/index";

const FIXED_CLOCK: Clock = Object.freeze({
  now: () => new Date(FIXTURE_TIMES.confirmedFrom),
});

const generatedId = (value: number): string =>
  `90000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const generatedIds = (): readonly string[] =>
  Array.from({ length: 50 }, (_, index) => generatedId(index + 1));

const draftRequest = Object.freeze({
  evidenceIds: [FIXTURE_IDS.evidence],
  privateMessageId: FIXTURE_IDS.message,
  promptVersion: "signal-draft-v2",
  purpose: "signal_draft",
  requestId: FIXTURE_IDS.request,
});

const validGeneration = (): ValidatedSignalDraftCandidate => {
  const candidate = renderProviderSignalDraft(
    {
      confidence: 0.9,
      intent: "coordinate_schedule",
      missingInfoCodes: ["responsible_member", "target_time"],
    },
    ["unrelated private input"],
  );

  if (candidate === undefined) {
    throw new Error("The application template fixture must be valid.");
  }

  return ValidatedSignalDraftCandidateSchema.parse({
    candidate,
    metadata: {
      attempts: 1,
      contentLogged: false,
      inputTokens: 1,
      latencyMs: 0,
      outputTokens: 1,
      promptVersion: draftRequest.promptVersion,
      providerOutcome: "validated",
      purpose: "signal_draft",
      requestId: draftRequest.requestId,
    },
    source: "validated_ai",
    status: "validated",
  });
};

interface HarnessOptions {
  readonly clock?: Clock;
  readonly content?: string;
  readonly logger?: SafeLogger;
  readonly signalDraftGenerator?: SignalDraftGenerator;
}

const createHarness = (
  options: Readonly<HarnessOptions> = {},
): Readonly<{
  handlers: ConversationHandlers;
  store: InMemoryConversationStore;
}> => {
  const content = options.content ?? FIXTURE_PRIVATE_MESSAGE.content;
  const space = SpaceSchema.parse(FIXTURE_SPACE);
  const members = [
    MemberSchema.parse(FIXTURE_MEMBERS.primary),
    MemberSchema.parse(FIXTURE_MEMBERS.partner),
    MemberSchema.parse(FIXTURE_MEMBERS.subject),
  ];
  const conversation = ConversationSchema.parse({
    ...FIXTURE_CONVERSATION,
    participantMemberIds: [...FIXTURE_CONVERSATION.participantMemberIds],
  });
  const message = PrivateMessageSchema.parse({
    ...FIXTURE_PRIVATE_MESSAGE,
    content,
  });
  const evidence = {
    evidence: EvidenceSchema.parse(FIXTURE_EVIDENCE),
    rawContent: content,
    sourceMessageId: message.id,
  };
  const store = createInMemoryConversationStore({
    conversations: [conversation],
    evidence: [evidence],
    members,
    privateMessages: [message],
    spaces: [space],
  });
  const handlerOptions = {
    clock: options.clock ?? FIXED_CLOCK,
    ids: createSequenceEntityIdGenerator(generatedIds()),
    store,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.signalDraftGenerator === undefined
      ? {}
      : { signalDraftGenerator: options.signalDraftGenerator }),
  };

  return {
    handlers: createConversationHandlers(handlerOptions),
    store,
  };
};

const createDraft = async (handlers: ConversationHandlers) => {
  const response = await handlers.CreateSignalDraft(
    FIXTURE_ACTORS.subject,
    draftRequest,
  );

  expect(response.ok).toBe(true);

  if (!response.ok || response.result.status !== "draft_created") {
    throw new Error("Expected a created signal draft.");
  }

  return response.result.draft;
};

const decideShare = async (
  handlers: ConversationHandlers,
  signalDraftId: string,
) => {
  const response = await handlers.DecideConsent(FIXTURE_ACTORS.subject, {
    decidedAt: FIXTURE_TIMES.updated,
    decision: "share",
    expiresAt: FIXTURE_TIMES.expires,
    requestId: FIXTURE_IDS.request,
    signalDraftId,
    visibility: {
      kind: "members",
      memberIds: [FIXTURE_IDS.subject, FIXTURE_IDS.primary],
    },
  });

  expect(response.ok).toBe(true);

  if (!response.ok) {
    throw new Error("Expected an active share decision.");
  }

  return response.result.decision;
};

const confirm = (
  handlers: ConversationHandlers,
  draftId: string,
  draftVersion: number,
  decisionId: string,
) =>
  handlers.ConfirmSignal(FIXTURE_ACTORS.subject, {
    consentDecisionId: decisionId,
    expectedDraftVersion: draftVersion,
    idempotencyKey: "confirm_signal_repair_0001",
    requestId: FIXTURE_IDS.request,
    signalDraftId: draftId,
  });

const createDeferred = (): Readonly<{
  promise: Promise<void>;
  resolve(): void;
}> => {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (resolver === undefined) {
        throw new Error("The deferred operation is not initialized.");
      }

      resolver();
    },
  };
};

describe("conversation authorization and privacy", () => {
  it("creates a self-only message with no derived or cross-role state", async () => {
    const store = createInMemoryConversationStore({
      conversations: [
        ConversationSchema.parse({
          ...FIXTURE_CONVERSATION,
          participantMemberIds: [...FIXTURE_CONVERSATION.participantMemberIds],
        }),
      ],
      members: [
        MemberSchema.parse(FIXTURE_MEMBERS.primary),
        MemberSchema.parse(FIXTURE_MEMBERS.partner),
        MemberSchema.parse(FIXTURE_MEMBERS.subject),
      ],
      spaces: [SpaceSchema.parse(FIXTURE_SPACE)],
    });
    const handlers = createConversationHandlers({
      clock: FIXED_CLOCK,
      ids: createSequenceEntityIdGenerator(generatedIds()),
      store,
    });

    const created = await handlers.CreatePrivateMessage(FIXTURE_ACTORS.subject, {
      clientMessageId: FIXTURE_IDS.clientMessage,
      content: "只保存在我的私聊里。",
      conversationId: FIXTURE_IDS.conversation,
      occurredAt: FIXTURE_TIMES.created,
      requestId: FIXTURE_IDS.request,
    });

    expect(created.ok).toBe(true);
    const snapshot = store.inspectForTest();
    expect(snapshot.privateMessages).toHaveLength(1);
    expect(snapshot.privateMessages[0]?.visibility).toEqual({
      kind: "self",
      memberId: FIXTURE_IDS.subject,
    });
    expect(snapshot.signalDrafts).toHaveLength(0);
    expect(snapshot.consentDecisions).toHaveLength(0);
    expect(snapshot.sharedSignals).toHaveLength(0);
    expect(snapshot.ordinaryTasks).toHaveLength(0);
    expect(snapshot.reportFacts).toHaveLength(0);

    const guessedConversation = await handlers.GetPrivateConversation(
      FIXTURE_ACTORS.partner,
      {
        conversationId: FIXTURE_IDS.conversation,
        page: { cursor: null, limit: 20 },
        requestId: FIXTURE_IDS.request,
      },
    );
    expect(guessedConversation).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });

    const visibleSignals = await handlers.GetVisibleSharedSignals(
      FIXTURE_ACTORS.primary,
      {
        page: { cursor: null, limit: 20 },
        requestId: FIXTURE_IDS.request,
        spaceId: FIXTURE_IDS.space,
      },
    );
    expect(visibleSignals).toMatchObject({
      ok: true,
      result: { signals: [] },
    });
  });

  it("keeps raw evidence self-only when another role guesses its identifier", async () => {
    const { handlers } = createHarness({ content: "private raw evidence" });

    const self = await handlers.GetRawEvidence(FIXTURE_ACTORS.subject, {
      evidenceId: FIXTURE_IDS.evidence,
      requestId: FIXTURE_IDS.request,
    });
    expect(self).toMatchObject({
      ok: true,
      result: { evidence: { rawContent: "private raw evidence" } },
    });

    for (const actor of [FIXTURE_ACTORS.primary, FIXTURE_ACTORS.partner]) {
      const guessed = await handlers.GetRawEvidence(actor, {
        evidenceId: FIXTURE_IDS.evidence,
        requestId: FIXTURE_IDS.request,
      });
      expect(guessed).toMatchObject({
        error: { code: "not_found" },
        ok: false,
      });
      expect(JSON.stringify(guessed)).not.toContain("private raw evidence");
    }
  });

  it.each([
    "我现在想伤害自己。",
    "我的伴侣昨晚打我，还不让我离开。",
    "我突然胸痛而且喘不上气。",
  ])("bypasses the provider for frozen high-risk content: %s", async (content) => {
    let providerCalls = 0;
    const signalDraftGenerator: SignalDraftGenerator = {
      generate: () => {
        providerCalls += 1;
        return Promise.resolve(validGeneration());
      },
    };
    const { handlers, store } = createHarness({
      content,
      signalDraftGenerator,
    });

    const draft = await createDraft(handlers);

    expect(providerCalls).toBe(0);
    expect(draft.kind).toBe("high_risk");
    expect(draft.source).toBe("human");
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
    expect(store.inspectForTest().ordinaryTasks).toHaveLength(0);
  });
});

describe("pre-provider authorization", () => {
  type Arrange = (
    store: InMemoryConversationStore,
  ) => Promise<Readonly<{ actor?: MemberActor; request?: unknown }> | undefined>;

  const cases: readonly [string, Arrange][] = [
    [
      "inactive actor",
      async (store) => {
        await store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.subject,
            status: "inactive",
            version: FIXTURE_MEMBERS.subject.version + 1,
          }),
        );
        return undefined;
      },
    ],
    [
      "persisted role mismatch",
      () =>
        Promise.resolve({
          actor: { ...FIXTURE_ACTORS.subject, role: "primary" },
        }),
    ],
    [
      "inactive space",
      async (store) => {
        await store.replaceSpaceForTest(
          SpaceSchema.parse({
            ...FIXTURE_SPACE,
            status: "deleting",
            version: FIXTURE_SPACE.version + 1,
          }),
        );
        return undefined;
      },
    ],
    [
      "revoked analysis consent",
      async (store) => {
        await store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.subject,
            analysisConsent: "revoked",
            version: FIXTURE_MEMBERS.subject.version + 1,
          }),
        );
        return undefined;
      },
    ],
    [
      "cross-space actor",
      () =>
        Promise.resolve({
          actor: {
            ...FIXTURE_ACTORS.subject,
            spaceId: "10000000-0000-4000-8000-000000000001",
          },
        }),
    ],
    [
      "missing source message",
      () =>
        Promise.resolve({
          request: {
            ...draftRequest,
            privateMessageId: "10000000-0000-4000-8000-000000000002",
          },
        }),
    ],
    [
      "mismatched evidence source",
      async (store) => {
        await store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse(FIXTURE_EVIDENCE),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: "10000000-0000-4000-8000-000000000003",
        });
        return undefined;
      },
    ],
    [
      "wrong evidence speaker",
      async (store) => {
        await store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse({
            ...FIXTURE_EVIDENCE,
            speakerId: FIXTURE_IDS.partner,
            visibility: { kind: "self", memberId: FIXTURE_IDS.partner },
          }),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: FIXTURE_IDS.message,
        });
        return undefined;
      },
    ],
    [
      "deleted evidence",
      async (store) => {
        await store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse({
            ...FIXTURE_EVIDENCE,
            state: "deleted",
            version: FIXTURE_EVIDENCE.version + 1,
          }),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: FIXTURE_IDS.message,
        });
        return undefined;
      },
    ],
    [
      "duplicate evidence identifiers",
      () =>
        Promise.resolve({
          request: {
            ...draftRequest,
            evidenceIds: [FIXTURE_IDS.evidence, FIXTURE_IDS.evidence],
          },
        }),
    ],
  ];

  it.each(cases)("fails %s before invoking the provider", async (_name, arrange) => {
    let providerCalls = 0;
    const { handlers, store } = createHarness({
      signalDraftGenerator: {
        generate: () => {
          providerCalls += 1;
          return Promise.resolve(validGeneration());
        },
      },
    });
    const arranged = await arrange(store);
    const actor = arranged?.actor ?? FIXTURE_ACTORS.subject;
    const request = arranged?.request ?? draftRequest;

    const response = await handlers.CreateSignalDraft(actor, request);

    expect(response.ok).toBe(false);
    expect(providerCalls).toBe(0);
    expect(store.inspectForTest().signalDrafts).toHaveLength(0);
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
  });
});

describe("provider-time drift", () => {
  type Drift = (store: InMemoryConversationStore) => Promise<void>;

  const driftCases: readonly [string, Drift][] = [
    [
      "actor deactivation",
      (store) =>
        store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.subject,
            status: "inactive",
            version: FIXTURE_MEMBERS.subject.version + 1,
          }),
        ),
    ],
    [
      "analysis consent revocation",
      (store) =>
        store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.subject,
            analysisConsent: "revoked",
            version: FIXTURE_MEMBERS.subject.version + 1,
          }),
        ),
    ],
    [
      "evidence invalidation",
      (store) =>
        store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse({
            ...FIXTURE_EVIDENCE,
            state: "deleted",
            version: FIXTURE_EVIDENCE.version + 1,
          }),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: FIXTURE_IDS.message,
        }),
    ],
    [
      "evidence visibility drift",
      (store) =>
        store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse({
            ...FIXTURE_EVIDENCE,
            version: FIXTURE_EVIDENCE.version + 1,
            visibility: { kind: "self", memberId: FIXTURE_IDS.primary },
          }),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: FIXTURE_IDS.message,
        }),
    ],
    [
      "message version drift",
      (store) =>
        store.replacePrivateMessageForTest(
          PrivateMessageSchema.parse({
            ...FIXTURE_PRIVATE_MESSAGE,
            updatedAt: FIXTURE_TIMES.confirmedFrom,
            version: FIXTURE_PRIVATE_MESSAGE.version + 1,
          }),
        ),
    ],
  ];

  it.each(driftCases)("rejects %s with zero writes", async (_name, drift) => {
    let providerCalls = 0;
    const storeReference: { current?: InMemoryConversationStore } = {};
    const generator: SignalDraftGenerator = {
      generate: async () => {
        providerCalls += 1;
        const currentStore = storeReference.current;

        if (currentStore === undefined) {
          throw new Error("The test store is not initialized.");
        }

        await drift(currentStore);
        return validGeneration();
      },
    };
    const harness = createHarness({ signalDraftGenerator: generator });
    const store = harness.store;
    storeReference.current = store;

    const response = await harness.handlers.CreateSignalDraft(
      FIXTURE_ACTORS.subject,
      draftRequest,
    );

    expect(response.ok).toBe(false);
    expect(providerCalls).toBe(1);
    expect(store.inspectForTest().signalDrafts).toHaveLength(0);
    expect(store.inspectForTest().consentDecisions).toHaveLength(0);
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
  });
});

describe("consent and transactional confirmation", () => {
  it("requires one immutable decision from the same speaker", async () => {
    const { handlers, store } = createHarness();
    const draft = await createDraft(handlers);

    const wrongSpeaker = await handlers.DecideConsent(FIXTURE_ACTORS.partner, {
      decidedAt: FIXTURE_TIMES.updated,
      decision: "share",
      expiresAt: FIXTURE_TIMES.expires,
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
      visibility: { kind: "space" },
    });
    expect(wrongSpeaker).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });

    const missing = await confirm(
      handlers,
      draft.id,
      draft.version,
      FIXTURE_IDS.consent,
    );
    expect(missing).toMatchObject({
      error: { code: "consent_required" },
      ok: false,
    });

    const decision = await decideShare(handlers, draft.id);
    const secondDecision = await handlers.DecideConsent(FIXTURE_ACTORS.subject, {
      decidedAt: FIXTURE_TIMES.updated,
      decision: "discard",
      expiresAt: null,
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
      visibility: null,
    });
    expect(secondDecision).toMatchObject({
      error: { code: "conflict" },
      ok: false,
    });

    const confirmed = await confirm(
      handlers,
      draft.id,
      draft.version,
      decision.id,
    );
    expect(confirmed.ok).toBe(true);
    expect(store.inspectForTest().sharedSignals).toHaveLength(1);

    const replay = await confirm(
      handlers,
      draft.id,
      draft.version,
      decision.id,
    );
    expect(replay).toEqual(confirmed);
    expect(store.inspectForTest().sharedSignals).toHaveLength(1);
  });

  it.each([
    "consent revocation",
    "evidence invalidation",
    "actor deactivation",
    "visibility member deactivation",
    "draft version drift",
    "source version drift",
  ])("revalidates %s before the shared write", async (scenario) => {
    const { handlers, store } = createHarness();
    const draft = await createDraft(handlers);
    const decision = await decideShare(handlers, draft.id);

    switch (scenario) {
      case "consent revocation":
        await store.replaceConsentDecisionForTest(
          ConsentDecisionSchema.parse({
            ...decision,
            recordState: "revoked",
            revokedAt: FIXTURE_TIMES.confirmedFrom,
            updatedAt: FIXTURE_TIMES.confirmedFrom,
            version: decision.version + 1,
          }),
        );
        break;
      case "evidence invalidation":
        await store.replaceEvidenceForTest({
          evidence: EvidenceSchema.parse({
            ...FIXTURE_EVIDENCE,
            state: "deleted",
            version: FIXTURE_EVIDENCE.version + 1,
          }),
          rawContent: FIXTURE_PRIVATE_MESSAGE.content,
          sourceMessageId: FIXTURE_IDS.message,
        });
        break;
      case "actor deactivation":
        await store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.subject,
            status: "inactive",
            version: FIXTURE_MEMBERS.subject.version + 1,
          }),
        );
        break;
      case "visibility member deactivation":
        await store.replaceMemberForTest(
          MemberSchema.parse({
            ...FIXTURE_MEMBERS.primary,
            status: "inactive",
            version: FIXTURE_MEMBERS.primary.version + 1,
          }),
        );
        break;
      case "draft version drift":
        await store.replaceSignalDraftForTest({
          ...draft,
          updatedAt: FIXTURE_TIMES.confirmedFrom,
          version: draft.version + 1,
        });
        break;
      case "source version drift":
        await store.replacePrivateMessageForTest(
          PrivateMessageSchema.parse({
            ...FIXTURE_PRIVATE_MESSAGE,
            updatedAt: FIXTURE_TIMES.confirmedFrom,
            version: FIXTURE_PRIVATE_MESSAGE.version + 1,
          }),
        );
        break;
    }

    const result = await confirm(
      handlers,
      draft.id,
      draft.version,
      decision.id,
    );

    expect(result.ok).toBe(false);
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
    expect(store.inspectForTest().signalConfirmationCount).toBe(0);
  });

  it.each([
    "Private Family Schedule",
    "PRIVATE family, schedule!",
    "Ｐｒｉｖａｔｅ　Ｆａｍｉｌｙ　Ｓｃｈｅｄｕｌｅ",
    "Private Family Schedulf",
  ])("blocks a provider-derived private variant at confirmation: %s", async (variant) => {
    const privateContent = "Private Family Schedule";
    const { handlers, store } = createHarness({ content: privateContent });
    const draft = await createDraft(handlers);

    await store.replaceSignalDraftForTest({
      ...draft,
      proposedConclusion: variant,
    });
    const decision = await decideShare(handlers, draft.id);
    const result = await confirm(
      handlers,
      draft.id,
      draft.version,
      decision.id,
    );

    expect(result).toMatchObject({
      error: { code: "consent_invalid" },
      ok: false,
    });
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
  });

  it("rechecks consent expiry after waiting in the transaction queue", async () => {
    let currentTime = new Date("2026-08-27T00:10:00.000Z");
    const clock: Clock = {
      now: () => new Date(currentTime),
    };
    const { handlers, store } = createHarness({ clock });
    const draft = await createDraft(handlers);
    const decisionResponse = await handlers.DecideConsent(
      FIXTURE_ACTORS.subject,
      {
        decidedAt: FIXTURE_TIMES.updated,
        decision: "share",
        expiresAt: "2026-08-27T08:10:30+08:00",
        requestId: FIXTURE_IDS.request,
        signalDraftId: draft.id,
        visibility: { kind: "space" },
      },
    );

    expect(decisionResponse.ok).toBe(true);

    if (!decisionResponse.ok) {
      throw new Error("Expected a queued-confirmation consent fixture.");
    }

    const entered = createDeferred();
    const release = createDeferred();
    const blocker = store.transaction(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    const pendingConfirmation = confirm(
      handlers,
      draft.id,
      draft.version,
      decisionResponse.result.decision.id,
    );
    currentTime = new Date("2026-08-27T00:11:00.000Z");
    release.resolve();
    await blocker;
    const result = await pendingConfirmation;

    expect(result).toMatchObject({
      error: { code: "consent_invalid" },
      ok: false,
    });
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
    expect(store.inspectForTest().signalConfirmationCount).toBe(0);
  });
});

describe("provider failures and diagnostics", () => {
  const invalidResult = (): LLMProviderResult => ({
    status: "completed",
    completion: {
      latencyMs: 0,
      output: { conclusion: "free provider text" },
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  });

  it("persists nothing after two invalid provider outputs", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      complete: () => {
        calls += 1;
        return Promise.resolve(invalidResult());
      },
    };
    const generator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider,
      source: "validated_ai",
    });
    const { handlers, store } = createHarness({
      signalDraftGenerator: generator,
    });

    const result = await handlers.CreateSignalDraft(
      FIXTURE_ACTORS.subject,
      draftRequest,
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        attempts: 2,
        consequentialMutationAllowed: false,
        reason: "provider_invalid_output",
        status: "needs_human_review",
      },
    });
    expect(calls).toBe(2);
    expect(store.inspectForTest().signalDrafts).toHaveLength(0);
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
  });

  it("keeps logs and errors limited to identifiers and bounded outcomes", async () => {
    const events: SafeOperationLog[] = [];
    const logger: SafeLogger = {
      write: (event) => {
        events.push(event);
      },
    };
    const privateContent = "private-marker email@example.com 13812345678";
    const provider: LLMProvider = {
      complete: () =>
        Promise.reject(new Error(`provider failed with ${privateContent}`)),
    };
    const generator = createSignalDraftGenerator({
      logger,
      provider,
      source: "validated_ai",
    });
    const { handlers } = createHarness({
      content: privateContent,
      logger,
      signalDraftGenerator: generator,
    });

    const result = await handlers.CreateSignalDraft(
      FIXTURE_ACTORS.subject,
      draftRequest,
    );
    const diagnostics = JSON.stringify({ events, result });

    expect(result).toMatchObject({
      ok: true,
      result: { reason: "provider_unavailable", status: "needs_human_review" },
    });
    expect(diagnostics).not.toContain("private-marker");
    expect(diagnostics).not.toContain("email@example.com");
    expect(diagnostics).not.toContain("13812345678");
    expect(events.every((event) => event.recordIds.length === 0)).toBe(true);
  });
});
