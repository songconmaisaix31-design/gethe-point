import { describe, expect, it } from "vitest";

import {
  FIXTURE_ACTORS,
  FIXTURE_CONSENT,
  FIXTURE_CONVERSATION,
  FIXTURE_EVIDENCE,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_TIMES,
  type Clock,
  type LLMProvider,
} from "../../../packages/contracts/src/index";
import {
  createSignalDraftGenerator,
  type SignalDraftGenerator,
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
  Array.from({ length: 20 }, (_, index) => generatedId(index + 1));

const memberSeed = [
  FIXTURE_MEMBERS.primary,
  FIXTURE_MEMBERS.partner,
  FIXTURE_MEMBERS.subject,
];

const conversationSeed = {
  ...FIXTURE_CONVERSATION,
  participantMemberIds: [...FIXTURE_CONVERSATION.participantMemberIds],
};

const evidenceSeed = (rawContent: string) => ({
  evidence: FIXTURE_EVIDENCE,
  rawContent,
  sourceMessageId: FIXTURE_PRIVATE_MESSAGE.id,
});

interface HarnessOptions {
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
  const message = { ...FIXTURE_PRIVATE_MESSAGE, content };
  const store = createInMemoryConversationStore({
    conversations: [conversationSeed],
    evidence: [evidenceSeed(content)],
    members: memberSeed,
    privateMessages: [message],
  });
  const handlerOptions = {
    clock: FIXED_CLOCK,
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

const draftRequest = Object.freeze({
  evidenceIds: [FIXTURE_IDS.evidence],
  privateMessageId: FIXTURE_IDS.message,
  promptVersion: "signal-draft-v1",
  purpose: "signal_draft",
  requestId: FIXTURE_IDS.request,
});

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
    visibility: FIXTURE_CONSENT.visibility,
  });

  expect(response.ok).toBe(true);

  if (!response.ok) {
    throw new Error("Expected an active share decision.");
  }

  return response.result.decision;
};

describe("conversation handlers", () => {
  it("creates a self-only private message without shared state", async () => {
    const store = createInMemoryConversationStore({
      conversations: [conversationSeed],
      members: memberSeed,
    });
    const handlers = createConversationHandlers({
      clock: FIXED_CLOCK,
      ids: createSequenceEntityIdGenerator(generatedIds()),
      store,
    });

    const response = await handlers.CreatePrivateMessage(
      FIXTURE_ACTORS.subject,
      {
        clientMessageId: FIXTURE_IDS.clientMessage,
        content: "只保存在我的私聊里。",
        conversationId: FIXTURE_IDS.conversation,
        occurredAt: FIXTURE_TIMES.created,
        requestId: FIXTURE_IDS.request,
      },
    );

    expect(response.ok).toBe(true);
    const snapshot = store.inspectForTest();
    expect(snapshot.privateMessages).toHaveLength(1);
    expect(snapshot.privateMessages[0]?.visibility).toEqual({
      kind: "self",
      memberId: FIXTURE_IDS.subject,
    });
    expect(snapshot.signalDrafts).toHaveLength(0);
    expect(snapshot.consentDecisions).toHaveLength(0);
    expect(snapshot.sharedSignals).toHaveLength(0);
  });

  it("requires per-item consent and shares only the drafted redacted fields", async () => {
    const privateContent =
      "请联系 13812345678，并把完整病历原文 secret-private-record 发到家里。";
    const { handlers, store } = createHarness({ content: privateContent });
    const draft = await createDraft(handlers);

    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
    const missingConsent = await handlers.ConfirmSignal(FIXTURE_ACTORS.subject, {
      consentDecisionId: FIXTURE_IDS.consent,
      expectedDraftVersion: draft.version,
      idempotencyKey: "confirm_without_consent_0001",
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
    });
    expect(missingConsent).toMatchObject({
      error: { code: "consent_required" },
      ok: false,
    });

    const decision = await decideShare(handlers, draft.id);
    const confirmationRequest = {
      consentDecisionId: decision.id,
      expectedDraftVersion: draft.version,
      idempotencyKey: "confirm_signal_fixture_0001",
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
    };
    const confirmed = await handlers.ConfirmSignal(
      FIXTURE_ACTORS.subject,
      confirmationRequest,
    );

    expect(confirmed.ok).toBe(true);

    if (!confirmed.ok) {
      throw new Error("Expected a confirmed signal.");
    }

    const serialized = JSON.stringify(confirmed.result.signal);
    expect(confirmed.result.signal.redactedExcerpt).toBe(draft.redactedExcerpt);
    expect(confirmed.result.signal.conclusion).toBe(draft.proposedConclusion);
    expect(serialized).not.toContain(privateContent);
    expect(serialized).not.toContain("13812345678");
    expect(serialized).not.toContain("secret-private-record");
    expect(serialized).not.toContain(FIXTURE_EVIDENCE.rawRef);
    expect(confirmed.result.signal.provenance).toEqual([
      {
        evidenceId: FIXTURE_IDS.evidence,
        occurredAt: FIXTURE_TIMES.created,
        sourceType: "agent_dm",
        speakerId: FIXTURE_IDS.subject,
        state: "available",
      },
    ]);
    expect(store.inspectForTest().sharedSignals).toHaveLength(1);

    const replay = await handlers.ConfirmSignal(
      FIXTURE_ACTORS.subject,
      confirmationRequest,
    );
    expect(replay).toEqual(confirmed);
    expect(store.inspectForTest().sharedSignals).toHaveLength(1);
  });

  it("keeps consent immutable and rejects an idempotency key reused for another request", async () => {
    const { handlers, store } = createHarness();
    const draft = await createDraft(handlers);
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

    const firstConfirmation = await handlers.ConfirmSignal(
      FIXTURE_ACTORS.subject,
      {
        consentDecisionId: decision.id,
        expectedDraftVersion: draft.version,
        idempotencyKey: "confirm_signal_fixture_0002",
        requestId: FIXTURE_IDS.request,
        signalDraftId: draft.id,
      },
    );
    expect(firstConfirmation.ok).toBe(true);

    const conflict = await handlers.ConfirmSignal(FIXTURE_ACTORS.subject, {
      consentDecisionId: decision.id,
      expectedDraftVersion: draft.version + 1,
      idempotencyKey: "confirm_signal_fixture_0002",
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
    });
    expect(conflict).toMatchObject({
      error: { code: "idempotency_conflict" },
      ok: false,
    });
    expect(store.inspectForTest().sharedSignals).toHaveLength(1);
  });

  it("rejects expired consent without a shared write", async () => {
    const { handlers, store } = createHarness();
    const draft = await createDraft(handlers);
    const decision = await handlers.DecideConsent(FIXTURE_ACTORS.subject, {
      decidedAt: FIXTURE_TIMES.updated,
      decision: "share",
      expiresAt: "2026-08-27T08:07:00+08:00",
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
      visibility: FIXTURE_CONSENT.visibility,
    });

    expect(decision.ok).toBe(true);

    if (!decision.ok) {
      throw new Error("Expected consent to be recorded before its expiry.");
    }

    const confirmation = await handlers.ConfirmSignal(FIXTURE_ACTORS.subject, {
      consentDecisionId: decision.result.decision.id,
      expectedDraftVersion: draft.version,
      idempotencyKey: "confirm_expired_consent_0001",
      requestId: FIXTURE_IDS.request,
      signalDraftId: draft.id,
    });

    expect(confirmation).toMatchObject({
      error: { code: "consent_invalid" },
      ok: false,
    });
    expect(store.inspectForTest().sharedSignals).toHaveLength(0);
  });

  it("persists nothing when both provider outputs are invalid", async () => {
    let attempts = 0;
    const invalidProvider: LLMProvider = {
      complete: () => {
        attempts += 1;
        return Promise.resolve({
          completion: {
            latencyMs: 0,
            output: "{invalid-json",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
          status: "completed",
        });
      },
    };
    const signalDraftGenerator = createSignalDraftGenerator({
      logger: { write: () => undefined },
      provider: invalidProvider,
      source: "validated_ai",
    });
    const { handlers, store } = createHarness({ signalDraftGenerator });

    const response = await handlers.CreateSignalDraft(
      FIXTURE_ACTORS.subject,
      draftRequest,
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        attempts: 2,
        consequentialMutationAllowed: false,
        reason: "provider_invalid_output",
        status: "needs_human_review",
      },
    });
    expect(attempts).toBe(2);
    const snapshot = store.inspectForTest();
    expect(snapshot.signalDrafts).toHaveLength(0);
    expect(snapshot.consentDecisions).toHaveLength(0);
    expect(snapshot.sharedSignals).toHaveLength(0);
  });

  it("keeps discussion-only and high-risk fixtures non-consequential", async () => {
    const discussion = createHarness({
      content: "这件事只是讨论，不需要安排任务。",
    });
    const discussionDraft = await createDraft(discussion.handlers);
    expect(discussionDraft.kind).toBe("discussion_only");
    expect(discussion.store.inspectForTest().consentDecisions).toHaveLength(0);
    expect(discussion.store.inspectForTest().sharedSignals).toHaveLength(0);

    let providerCalls = 0;
    const forbiddenProvider: SignalDraftGenerator = {
      generate: () => {
        providerCalls += 1;
        return Promise.reject(new Error("High-risk content reached the provider."));
      },
    };
    const highRisk = createHarness({
      content: "我现在想伤害自己。",
      signalDraftGenerator: forbiddenProvider,
    });
    const highRiskDraft = await createDraft(highRisk.handlers);
    expect(providerCalls).toBe(0);
    expect(highRiskDraft.kind).toBe("high_risk");
    expect(highRiskDraft.proposedConclusion).toContain("不作诊断");
    expect(highRisk.store.inspectForTest().consentDecisions).toHaveLength(0);
    expect(highRisk.store.inspectForTest().sharedSignals).toHaveLength(0);
  });

  it("does not leak private content through logs or errors", async () => {
    const events: SafeOperationLog[] = [];
    const logger: SafeLogger = {
      write: (event) => {
        events.push(event);
      },
    };
    const privateContent = "private-marker email@example.com 13812345678";
    const { handlers } = createHarness({ content: privateContent, logger });

    const denied = await handlers.CreateSignalDraft(
      FIXTURE_ACTORS.partner,
      draftRequest,
    );

    expect(denied).toMatchObject({ error: { code: "not_found" }, ok: false });
    const diagnostics = JSON.stringify({ denied, events });
    expect(diagnostics).not.toContain("private-marker");
    expect(diagnostics).not.toContain("email@example.com");
    expect(diagnostics).not.toContain("13812345678");
    expect(events[0]).toMatchObject({
      actorId: FIXTURE_IDS.partner,
      outcome: "not_found",
      recordIds: [],
      requestId: FIXTURE_IDS.request,
      spaceId: FIXTURE_IDS.space,
    });
  });
});
