import { describe, expect, it, vi } from "vitest";

import {
  type Clock,
  type ConsentDecision,
  type Conversation,
  type EntityId,
  type Evidence,
  type LLMProvider,
  type Member,
  type MemberActor,
  type PrivateMessage,
  type SignalDraft,
  type Space,
} from "../../../packages/contracts/src/index";
import { createSignalDraftWitness } from "../../ai-witness/index";

import {
  createInMemoryConversationRepository,
  type InMemoryConversationRepository,
  type InMemoryConversationSeed,
} from "./in-memory-repository";
import type {
  ConfirmationState,
  ConversationRepository,
  ConversationTransaction,
} from "./persistence";
import {
  createConversationService,
  type ConversationTelemetryEvent,
} from "./service";

const IDS = {
  space: "00000000-0000-4000-8000-000000000001",
  otherSpace: "00000000-0000-4000-8000-000000000002",
  subject: "00000000-0000-4000-8000-000000000003",
  primary: "00000000-0000-4000-8000-000000000004",
  otherMember: "00000000-0000-4000-8000-000000000005",
  conversation: "00000000-0000-4000-8000-000000000006",
  message: "00000000-0000-4000-8000-000000000007",
  otherMessage: "00000000-0000-4000-8000-000000000008",
  evidence: "00000000-0000-4000-8000-000000000009",
  missingEvidence: "00000000-0000-4000-8000-000000000010",
  draft: "00000000-0000-4000-8000-000000000011",
  consent: "00000000-0000-4000-8000-000000000012",
  request: "00000000-0000-4000-8000-000000000013",
  request2: "00000000-0000-4000-8000-000000000014",
  clientMessage: "00000000-0000-4000-8000-000000000015",
} as const satisfies Readonly<Record<string, EntityId>>;

const TIMES = {
  created: "2026-08-28T00:00:00.000Z",
  beforeExpiry: "2026-08-28T00:00:04.000Z",
  expiry: "2026-08-28T00:00:05.000Z",
  afterExpiry: "2026-08-28T00:00:06.000Z",
  future: "2026-08-29T00:00:00.000Z",
} as const;

const SUBJECT_ACTOR: MemberActor = {
  authentication: "fixture_demo",
  kind: "member",
  memberId: IDS.subject,
  role: "subject",
  spaceId: IDS.space,
};

const PRIMARY_ACTOR: MemberActor = {
  authentication: "fixture_demo",
  kind: "member",
  memberId: IDS.primary,
  role: "primary",
  spaceId: IDS.space,
};

const CROSS_SPACE_ACTOR: MemberActor = {
  authentication: "fixture_demo",
  kind: "member",
  memberId: IDS.otherMember,
  role: "partner",
  spaceId: IDS.otherSpace,
};

interface SeedOptions {
  readonly privateContent?: string;
  readonly analysisConsent?: Member["analysisConsent"];
  readonly memberStatus?: Member["status"];
  readonly evidenceSourceMessageId?: EntityId;
  readonly withDraft?: boolean;
  readonly withConsent?: boolean;
  readonly consentExpiresAt?: string | null;
  readonly draftExcerpt?: string;
}

const makeSeed = (options: SeedOptions = {}): InMemoryConversationSeed => {
  const content =
    options.privateContent ??
    "Pick up the private package from the north desk before six.";
  const space: Space = {
    createdAt: TIMES.created,
    createdBy: IDS.subject,
    id: IDS.space,
    name: "Fixture Household",
    spaceId: IDS.space,
    status: "active",
    updatedAt: TIMES.created,
    version: 0,
  };
  const subject: Member = {
    analysisConsent: options.analysisConsent ?? "enabled",
    createdAt: TIMES.created,
    displayName: "Fixture Subject",
    id: IDS.subject,
    joinedAt: TIMES.created,
    role: "subject",
    spaceId: IDS.space,
    status: options.memberStatus ?? "active",
    updatedAt: TIMES.created,
    version: 0,
  };
  const primary: Member = {
    analysisConsent: "enabled",
    createdAt: TIMES.created,
    displayName: "Fixture Primary",
    id: IDS.primary,
    joinedAt: TIMES.created,
    role: "primary",
    spaceId: IDS.space,
    status: "active",
    updatedAt: TIMES.created,
    version: 0,
  };
  const conversation: Conversation = {
    createdAt: TIMES.created,
    id: IDS.conversation,
    participantMemberIds: [IDS.subject],
    spaceId: IDS.space,
    type: "agent_dm",
    updatedAt: TIMES.created,
    version: 0,
  };
  const message: PrivateMessage = {
    authorId: IDS.subject,
    clientMessageId: IDS.clientMessage,
    content,
    conversationId: IDS.conversation,
    createdAt: TIMES.created,
    id: IDS.message,
    occurredAt: TIMES.created,
    spaceId: IDS.space,
    updatedAt: TIMES.created,
    version: 0,
    visibility: { kind: "self", memberId: IDS.subject },
  };
  const evidence: Evidence = {
    createdAt: TIMES.created,
    id: IDS.evidence,
    occurredAt: TIMES.created,
    rawRef: "fixture://evidence/private-message",
    sourceType: "agent_dm",
    spaceId: IDS.space,
    speakerId: IDS.subject,
    state: "available",
    updatedAt: TIMES.created,
    version: 0,
    visibility: { kind: "self", memberId: IDS.subject },
  };
  const draft: SignalDraft = {
    candidateDomainId: null,
    confidence: 0.8,
    createdAt: TIMES.created,
    evidenceIds: [IDS.evidence],
    id: IDS.draft,
    kind: "potential_task",
    missingInfo: [],
    promptVersion: "signal-draft-v2",
    proposedConclusion: "Review before sharing: A follow-up may need scheduling.",
    redactedExcerpt:
      options.draftExcerpt ?? "Summary: A household follow-up was mentioned.",
    source: "validated_ai",
    sourceMessageId: IDS.message,
    spaceId: IDS.space,
    speakerId: IDS.subject,
    updatedAt: TIMES.created,
    version: 0,
  };
  const consent: ConsentDecision = {
    createdAt: TIMES.created,
    decidedAt: TIMES.created,
    expiresAt: options.consentExpiresAt ?? TIMES.future,
    id: IDS.consent,
    outcome: "share",
    recordState: "active",
    revokedAt: null,
    signalDraftId: IDS.draft,
    spaceId: IDS.space,
    speakerId: IDS.subject,
    updatedAt: TIMES.created,
    version: 0,
    visibility: { kind: "members", memberIds: [IDS.primary] },
  };

  return {
    consentDecisions: options.withConsent === true ? [consent] : [],
    conversations: [conversation],
    evidence: [
      {
        evidence,
        rawContent: content,
        sourceMessageId:
          options.evidenceSourceMessageId ?? IDS.message,
      },
    ],
    members: [subject, primary],
    messages: [message],
    sharedSignals: [],
    signalDrafts: options.withDraft === true ? [draft] : [],
    spaces: [space],
  };
};

const safeProviderOutput = {
  confidence: 0.82,
  kind: "potential_task",
  missingInfo: ["Confirm the preferred time."],
  proposedConclusion: "A follow-up may need to be scheduled.",
  redactedExcerpt: "A household follow-up was mentioned.",
} as const;

const createIdGenerator = () => {
  let value = 100;
  return (): string => {
    const suffix = String(value).padStart(12, "0");
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
};

interface ServiceFixtureOptions {
  readonly seed?: InMemoryConversationSeed;
  readonly repository?: ConversationRepository;
  readonly complete?: LLMProvider["complete"];
  readonly clock?: Clock;
  readonly telemetry?: ConversationTelemetryEvent[];
}

const makeServiceFixture = (options: ServiceFixtureOptions = {}) => {
  const baseRepository = createInMemoryConversationRepository(
    options.seed ?? makeSeed(),
  );
  const complete =
    options.complete ??
    vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve({
        completion: {
          latencyMs: 5,
          output: safeProviderOutput,
          usage: { inputTokens: 10, outputTokens: 8 },
        },
        status: "completed",
      }),
    );
  const telemetry = options.telemetry;
  const service = createConversationService({
    clock:
      options.clock ??
      ({ now: () => new Date(TIMES.beforeExpiry) } satisfies Clock),
    generateId: createIdGenerator(),
    repository: options.repository ?? baseRepository,
    ...(telemetry === undefined
      ? {}
      : { telemetry: { record: (event) => void telemetry.push(event) } }),
    witness: createSignalDraftWitness({ complete }, { timeoutMs: 100 }),
  });
  return { baseRepository, complete, service };
};

const createDraftRequest = (evidenceId: EntityId = IDS.evidence) => ({
  evidenceIds: [evidenceId],
  privateMessageId: IDS.message,
  promptVersion: "signal-draft-v2",
  purpose: "signal_draft" as const,
  requestId: IDS.request,
});

const confirmRequest = {
  consentDecisionId: IDS.consent,
  expectedDraftVersion: 0,
  idempotencyKey: "idem_confirm_fixture_0001",
  requestId: IDS.request2,
  signalDraftId: IDS.draft,
} as const;

describe("conversation service pre-provider boundaries", () => {
  it.each([
    {
      actor: SUBJECT_ACTOR,
      name: "inactive actor",
      request: createDraftRequest(),
      seed: makeSeed({ memberStatus: "inactive" }),
    },
    {
      actor: SUBJECT_ACTOR,
      name: "revoked same-speaker analysis consent",
      request: createDraftRequest(),
      seed: makeSeed({ analysisConsent: "revoked" }),
    },
    {
      actor: SUBJECT_ACTOR,
      name: "missing evidence",
      request: createDraftRequest(IDS.missingEvidence),
      seed: makeSeed(),
    },
    {
      actor: SUBJECT_ACTOR,
      name: "mismatched evidence source",
      request: createDraftRequest(),
      seed: makeSeed({ evidenceSourceMessageId: IDS.otherMessage }),
    },
    {
      actor: CROSS_SPACE_ACTOR,
      name: "cross-space actor",
      request: createDraftRequest(),
      seed: makeSeed(),
    },
  ])("denies $name before invoking the provider", async ({ actor, request, seed }) => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve({
        completion: {
          latencyMs: 1,
          output: safeProviderOutput,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        status: "completed",
      }),
    );
    const { baseRepository, service } = makeServiceFixture({ complete, seed });

    const result = await service.createSignalDraft(actor, request);

    expect(result.ok).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect((await baseRepository.inspect()).signalDrafts).toHaveLength(0);
  });

  it.each([
    "I want to end my life tonight.",
    "My partner hit me again.",
    "I have chest pain and cannot breathe.",
  ])("bypasses the provider for high-risk content", async (privateContent) => {
    const complete = vi.fn<LLMProvider["complete"]>();
    const { baseRepository, service } = makeServiceFixture({
      complete,
      seed: makeSeed({ privateContent }),
    });

    const result = await service.createSignalDraft(
      SUBJECT_ACTOR,
      createDraftRequest(),
    );
    const snapshot = await baseRepository.inspect();

    expect(result).toMatchObject({
      ok: true,
      result: { draft: { kind: "high_risk" }, status: "draft_created" },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(snapshot.signalDrafts).toHaveLength(1);
    expect(snapshot.sharedSignals).toHaveLength(0);
    expect(snapshot.consentDecisions).toHaveLength(0);
  });

  it("revalidates source state after provider execution and writes no draft on drift", async () => {
    const baseRepository = createInMemoryConversationRepository(makeSeed());
    const driftRepository: ConversationRepository = {
      ...baseRepository,
      transaction: (work) =>
        baseRepository.transaction((transaction) =>
          work({
            ...transaction,
            loadDraftSource: async (lookup) => {
              const state = await transaction.loadDraftSource(lookup);
              return state === undefined
                ? undefined
                : {
                    ...state,
                    actorMember: {
                      ...state.actorMember,
                      status: "inactive",
                      version: state.actorMember.version + 1,
                    },
                  };
            },
          }),
        ),
    };
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve({
        completion: {
          latencyMs: 1,
          output: safeProviderOutput,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        status: "completed",
      }),
    );
    const { service } = makeServiceFixture({
      complete,
      repository: driftRepository,
    });

    const result = await service.createSignalDraft(
      SUBJECT_ACTOR,
      createDraftRequest(),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await baseRepository.inspect()).signalDrafts).toHaveLength(0);
  });

  it("returns needs_human_review without mutation after two invalid outputs", async () => {
    const complete = vi.fn<LLMProvider["complete"]>(() =>
      Promise.resolve({
        completion: {
          latencyMs: 1,
          output: { invalid: "shape" },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        status: "completed",
      }),
    );
    const { baseRepository, service } = makeServiceFixture({ complete });

    const result = await service.createSignalDraft(
      SUBJECT_ACTOR,
      createDraftRequest(),
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        consequentialMutationAllowed: false,
        status: "needs_human_review",
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect((await baseRepository.inspect()).signalDrafts).toHaveLength(0);
  });
});

describe("private conversation and consented sharing", () => {
  it("creates a private message with no shared, task-like, or consent side effect", async () => {
    const telemetry: ConversationTelemetryEvent[] = [];
    const { baseRepository, service } = makeServiceFixture({ telemetry });
    const before = await baseRepository.inspect();
    const privateContent = "A newly entered private-only message.";

    const result = await service.createPrivateMessage(SUBJECT_ACTOR, {
      clientMessageId: "00000000-0000-4000-8000-000000000016",
      content: privateContent,
      conversationId: IDS.conversation,
      occurredAt: TIMES.beforeExpiry,
      requestId: IDS.request,
    });
    const after = await baseRepository.inspect();

    expect(result).toMatchObject({ ok: true, result: { status: "created" } });
    expect(after.messages).toHaveLength(before.messages.length + 1);
    expect(after.evidence).toHaveLength(before.evidence.length + 1);
    expect(after.evidence.at(-1)).toMatchObject({
      evidence: {
        sourceType: "agent_dm",
        visibility: { kind: "self", memberId: IDS.subject },
      },
      rawContent: privateContent,
    });
    expect(after.signalDrafts).toEqual(before.signalDrafts);
    expect(after.sharedSignals).toEqual(before.sharedSignals);
    expect(after.consentDecisions).toEqual(before.consentDecisions);
    expect(JSON.stringify(telemetry)).not.toContain(privateContent);
  });

  it("keeps private messages and raw evidence self-only when another role guesses IDs", async () => {
    const { service } = makeServiceFixture();

    const privateQuery = await service.getPrivateConversation(PRIMARY_ACTOR, {
      conversationId: IDS.conversation,
      page: { cursor: null, limit: 20 },
      requestId: IDS.request,
    });
    const evidenceQuery = await service.getRawEvidence(PRIMARY_ACTOR, {
      evidenceId: IDS.evidence,
      requestId: IDS.request,
    });
    const ownerEvidence = await service.getRawEvidence(SUBJECT_ACTOR, {
      evidenceId: IDS.evidence,
      requestId: IDS.request,
    });

    expect(privateQuery).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });
    expect(evidenceQuery).toMatchObject({
      error: { code: "not_found" },
      ok: false,
    });
    expect(ownerEvidence).toMatchObject({
      ok: true,
      result: { status: "ready" },
    });
  });

  it("requires same-speaker per-signal consent and confirms exactly one visible signal", async () => {
    const { baseRepository, service } = makeServiceFixture();
    const draftResult = await service.createSignalDraft(
      SUBJECT_ACTOR,
      createDraftRequest(),
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok || draftResult.result.status !== "draft_created") {
      throw new Error("Expected a fixture draft.");
    }

    const wrongSpeakerDecision = await service.decideConsent(PRIMARY_ACTOR, {
      decision: "share",
      decidedAt: TIMES.beforeExpiry,
      expiresAt: TIMES.future,
      requestId: IDS.request2,
      signalDraftId: draftResult.result.draft.id,
      visibility: { kind: "members", memberIds: [IDS.primary] },
    });
    expect(wrongSpeakerDecision.ok).toBe(false);

    const decision = await service.decideConsent(SUBJECT_ACTOR, {
      decision: "share",
      decidedAt: TIMES.beforeExpiry,
      expiresAt: TIMES.future,
      requestId: IDS.request2,
      signalDraftId: draftResult.result.draft.id,
      visibility: { kind: "members", memberIds: [IDS.primary] },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      throw new Error("Expected a fixture consent decision.");
    }

    const confirmationRequest = {
      consentDecisionId: decision.result.decision.id,
      expectedDraftVersion: draftResult.result.draft.version,
      idempotencyKey: "idem_confirm_fixture_0002",
      requestId: IDS.request,
      signalDraftId: draftResult.result.draft.id,
    };
    const confirmation = await service.confirmSignal(
      SUBJECT_ACTOR,
      confirmationRequest,
    );
    const replay = await service.confirmSignal(
      SUBJECT_ACTOR,
      confirmationRequest,
    );
    const visible = await service.getVisibleSharedSignals(PRIMARY_ACTOR, {
      page: { cursor: null, limit: 20 },
      requestId: IDS.request2,
      spaceId: IDS.space,
    });

    expect(confirmation).toMatchObject({
      ok: true,
      result: { status: "confirmed" },
    });
    expect(replay).toEqual(confirmation);
    expect(visible).toMatchObject({
      ok: true,
      result: { signals: [{ visibility: { kind: "members" } }] },
    });
    expect((await baseRepository.inspect()).sharedSignals).toHaveLength(1);
  });

  it("rejects a final shared signal that contains a Unicode-folded private value", async () => {
    const seed = makeSeed({
      draftExcerpt: "STRASSE family detail",
      privateContent: "Straße family detail",
      withConsent: true,
      withDraft: true,
    });
    const { baseRepository, service } = makeServiceFixture({ seed });

    const result = await service.confirmSignal(SUBJECT_ACTOR, confirmRequest);

    expect(result).toMatchObject({
      error: { code: "consent_invalid" },
      ok: false,
    });
    expect((await baseRepository.inspect()).sharedSignals).toHaveLength(0);
  });
});

const revokeConsent = (state: ConfirmationState): ConfirmationState => {
  if (state.consent.recordState !== "active") {
    return state;
  }
  return {
    ...state,
    consent: {
      ...state.consent,
      recordState: "revoked",
      revokedAt: TIMES.afterExpiry,
      updatedAt: TIMES.afterExpiry,
      version: state.consent.version + 1,
    },
  };
};

const invalidateEvidence = (state: ConfirmationState): ConfirmationState => ({
  ...state,
  evidence: state.evidence.map((record, index) =>
    index === 0
      ? {
          ...record,
          evidence: {
            ...record.evidence,
            state: "deleted",
            updatedAt: TIMES.afterExpiry,
            version: record.evidence.version + 1,
          },
        }
      : record,
  ),
});

const deactivateActor = (state: ConfirmationState): ConfirmationState => ({
  ...state,
  actorMember: {
    ...state.actorMember,
    status: "inactive",
    updatedAt: TIMES.afterExpiry,
    version: state.actorMember.version + 1,
  },
});

const driftVisibility = (state: ConfirmationState): ConfirmationState => {
  if (state.consent.recordState !== "active") {
    return state;
  }
  return {
    ...state,
    consent: {
      ...state.consent,
      updatedAt: TIMES.afterExpiry,
      version: state.consent.version + 1,
      visibility: { kind: "members", memberIds: [IDS.subject] },
    },
  };
};

const driftDraftVersion = (state: ConfirmationState): ConfirmationState => ({
  ...state,
  draft: {
    ...state.draft,
    updatedAt: TIMES.afterExpiry,
    version: state.draft.version + 1,
  },
});

describe("confirmation transaction revalidation", () => {
  it.each([
    ["consent revocation", revokeConsent],
    ["evidence invalidation", invalidateEvidence],
    ["actor deactivation", deactivateActor],
    ["visibility drift", driftVisibility],
    ["version drift", driftDraftVersion],
  ] as const)("writes nothing on %s immediately before persistence", async (_name, drift) => {
    const baseRepository = createInMemoryConversationRepository(
      makeSeed({ withConsent: true, withDraft: true }),
    );
    const events: string[] = [];
    let confirmationLoads = 0;
    const repository: ConversationRepository = {
      ...baseRepository,
      transaction: (work) =>
        baseRepository.transaction((transaction) => {
          events.push("transaction-enter");
          const wrapped: ConversationTransaction = {
            ...transaction,
            insertSharedSignal: async (input) => {
              events.push("insert");
              return transaction.insertSharedSignal(input);
            },
            loadConfirmationState: async (lookup) => {
              confirmationLoads += 1;
              events.push(`load-${String(confirmationLoads)}`);
              const state = await transaction.loadConfirmationState(lookup);
              return confirmationLoads === 2 && state !== undefined
                ? drift(state)
                : state;
            },
            lockConfirmationState: async (lookup) => {
              events.push("lock");
              await transaction.lockConfirmationState(lookup);
            },
          };
          return work(wrapped);
        }),
    };
    const clock: Clock = {
      now: () => {
        events.push("clock");
        return new Date(TIMES.beforeExpiry);
      },
    };
    const { service } = makeServiceFixture({ clock, repository });

    const result = await service.confirmSignal(SUBJECT_ACTOR, confirmRequest);

    expect(result.ok).toBe(false);
    expect(events.slice(0, 5)).toEqual([
      "transaction-enter",
      "clock",
      "lock",
      "load-1",
      "load-2",
    ]);
    expect(events).not.toContain("insert");
    expect((await baseRepository.inspect()).sharedSignals).toHaveLength(0);
  });

  it("reads Clock.now only after a queued confirmation enters the transaction", async () => {
    const repository: InMemoryConversationRepository =
      createInMemoryConversationRepository(
        makeSeed({
          consentExpiresAt: TIMES.expiry,
          withConsent: true,
          withDraft: true,
        }),
      );
    let currentTime: string = TIMES.beforeExpiry;
    const clock: Clock = { now: () => new Date(currentTime) };
    const { service } = makeServiceFixture({ clock, repository });
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocker = repository.transaction(async () => {
      markStarted?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await started;

    const pendingConfirmation = service.confirmSignal(
      SUBJECT_ACTOR,
      confirmRequest,
    );
    currentTime = TIMES.afterExpiry;
    release?.();
    await blocker;
    const result = await pendingConfirmation;

    expect(result).toMatchObject({
      error: { code: "consent_invalid" },
      ok: false,
    });
    expect((await repository.inspect()).sharedSignals).toHaveLength(0);
  });
});
