import { describe, expect, it, vi } from "vitest";

import type {
  LLMProvider,
  Member,
  MemberActor,
  SharedSignal,
  Space,
  Task,
} from "../../../packages/contracts/src/index";
import {
  createDomainSuggestionService,
  type DomainSuggestionContext,
  type DomainSuggestionDraft,
  type DomainSuggestionRepository,
  type DomainSuggestionRequest,
  type PersistConfirmedDomainInput,
} from "../index";

const IDS = Object.freeze({
  space: "10000000-0000-4000-8000-000000000001",
  otherSpace: "10000000-0000-4000-8000-000000000002",
  primary: "10000000-0000-4000-8000-000000000003",
  partner: "10000000-0000-4000-8000-000000000004",
  outsider: "10000000-0000-4000-8000-000000000005",
  domain: "10000000-0000-4000-8000-000000000006",
  task: "10000000-0000-4000-8000-000000000007",
  evidence: "10000000-0000-4000-8000-000000000008",
  extraEvidence: "10000000-0000-4000-8000-000000000009",
  signal: "10000000-0000-4000-8000-000000000010",
  consent: "10000000-0000-4000-8000-000000000011",
  request: "10000000-0000-4000-8000-000000000012",
  confirmRequest: "10000000-0000-4000-8000-000000000013",
  suggestion: "10000000-0000-4000-8000-000000000014",
});

const TIMES = Object.freeze({
  created: "2026-08-01T00:00:00.000Z",
  updated: "2026-08-15T00:00:00.000Z",
  generated: "2026-08-20T00:00:00.000Z",
});

const metadata = (id: string, version = 3) => ({
  id,
  spaceId: IDS.space,
  createdAt: TIMES.created,
  updatedAt: TIMES.updated,
  version,
});

const space: Space = {
  ...metadata(IDS.space),
  name: "Fixture family",
  createdBy: IDS.primary,
  status: "active",
};

const member = (id: string, role: Member["role"]): Member => ({
  ...metadata(id),
  role,
  displayName: role,
  status: "active",
  joinedAt: TIMES.created,
  analysisConsent: "enabled",
});

const primary = member(IDS.primary, "primary");
const partner = member(IDS.partner, "partner");

const actor: MemberActor = {
  kind: "member",
  memberId: IDS.primary,
  spaceId: IDS.space,
  role: "primary",
  authentication: "verified_session",
};

const task: Task = {
  ...metadata(IDS.task),
  domainId: IDS.domain,
  title: "Private task title that must not reach the provider",
  dueAt: null,
  status: "open",
  reviewState: "current",
  visibility: { kind: "space" },
  evidenceIds: [IDS.evidence],
  discoveredBy: IDS.primary,
  deadlineKeptBy: IDS.primary,
  scheduledBy: IDS.partner,
  executedBy: null,
  followedUpBy: null,
};

const signal: SharedSignal = {
  ...metadata(IDS.signal),
  speakerId: IDS.primary,
  consentDecisionId: IDS.consent,
  redactedExcerpt: "需要安排下一次复诊",
  conclusion: "Internal conclusion that must not reach the provider.",
  purpose: "responsibility",
  visibility: { kind: "space" },
  provenance: [
    {
      evidenceId: IDS.evidence,
      sourceType: "family_group",
      speakerId: IDS.primary,
      occurredAt: TIMES.created,
      state: "available",
    },
  ],
  evidenceState: "available",
};

const evidence = {
  id: IDS.evidence,
  spaceId: IDS.space,
  speakerId: IDS.primary,
  state: "available" as const,
  version: 3,
};

const context = (): DomainSuggestionContext => ({
  space,
  actorMember: primary,
  members: [primary, partner],
  tasks: [task],
  signals: [{ signal, sourceKind: "potential_task" }],
  evidence: [evidence],
});

const request = (): DomainSuggestionRequest => ({
  requestId: IDS.request,
  spaceId: IDS.space,
  expectedSpaceVersion: space.version,
  expectedActorVersion: primary.version,
  tasks: [{ id: IDS.task, version: task.version }],
  signals: [{ id: IDS.signal, version: signal.version }],
  evidence: [{ id: IDS.evidence, version: evidence.version }],
  promptVersion: "domain-v1",
  timeoutMs: 100,
});

const providerSuccess = () => ({
  status: "completed" as const,
  completion: {
    output: { name: "复诊安排", nextAction: "确认日期" },
    latencyMs: 12,
    usage: { inputTokens: 20, outputTokens: 8 },
  },
});

const createProvider = (
  result: Awaited<ReturnType<LLMProvider["complete"]>> = providerSuccess(),
) => {
  const complete = vi.fn<LLMProvider["complete"]>();
  complete.mockResolvedValue(result);
  return { provider: { complete } satisfies LLMProvider, complete };
};

const createRepository = (rawContext: unknown = context()) => {
  const loadDomainSuggestionContext =
    vi.fn<DomainSuggestionRepository["loadDomainSuggestionContext"]>();
  loadDomainSuggestionContext.mockResolvedValue(rawContext);
  const revalidateDomainSuggestionContext =
    vi.fn<DomainSuggestionRepository["revalidateDomainSuggestionContext"]>();
  revalidateDomainSuggestionContext.mockResolvedValue({ status: "current" });
  const persistConfirmedDomain =
    vi.fn<DomainSuggestionRepository["persistConfirmedDomain"]>();
  persistConfirmedDomain.mockImplementation(
    (input: PersistConfirmedDomainInput) =>
      Promise.resolve({ status: "persisted", domain: input.domain }),
  );
  const repository: DomainSuggestionRepository = {
    loadDomainSuggestionContext,
    revalidateDomainSuggestionContext,
    persistConfirmedDomain,
  };
  return {
    repository,
    loadDomainSuggestionContext,
    revalidateDomainSuggestionContext,
    persistConfirmedDomain,
  };
};

const createService = (
  repository: DomainSuggestionRepository,
  provider: LLMProvider,
) =>
  createDomainSuggestionService({
    repository,
    provider,
    clock: { now: () => new Date(TIMES.generated) },
    createId: () => IDS.suggestion,
  });

const produceDraft = async (
  repository: DomainSuggestionRepository,
  provider: LLMProvider,
): Promise<DomainSuggestionDraft> => {
  const result = await createService(repository, provider).draftDomainSuggestion(
    actor,
    request(),
  );
  if (!result.ok || result.result.status !== "awaiting_human_confirmation") {
    throw new Error("Expected a validated domain suggestion draft.");
  }
  return result.result;
};

describe("AI domain suggestion boundary", () => {
  it("sends only authorized redacted excerpts and never mutates during drafting", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider();
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );

    const result = await service.draftDomainSuggestion(actor, request());

    expect(result.ok).toBe(true);
    expect(providerFixture.complete).toHaveBeenCalledTimes(1);
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
    const providerRequest = providerFixture.complete.mock.calls[0]?.[0];
    expect(providerRequest?.redactedInput).toBe(
      JSON.stringify({ facts: [{ fact: 1, text: signal.redactedExcerpt }] }),
    );
    for (const id of Object.values(IDS)) {
      expect(providerRequest?.redactedInput).not.toContain(id);
    }
    expect(providerRequest?.redactedInput).not.toContain(task.title);
    expect(providerRequest?.redactedInput).not.toContain(signal.conclusion);
    expect(providerRequest?.outputSchema).not.toHaveProperty("taskId");
    expect(providerRequest?.outputSchema).not.toHaveProperty("signalId");
  });

  it("fails actor, space, task, signal, and evidence authorization before provider invocation", async () => {
    const hiddenVisibility = {
      kind: "members" as const,
      memberIds: [IDS.partner],
    };
    const cases: readonly Readonly<{
      actorInput: unknown;
      requestInput: unknown;
      rawContext: unknown;
    }>[] = [
      {
        actorInput: { ...actor, spaceId: IDS.otherSpace },
        requestInput: request(),
        rawContext: context(),
      },
      {
        actorInput: actor,
        requestInput: { ...request(), spaceId: IDS.otherSpace },
        rawContext: context(),
      },
      {
        actorInput: actor,
        requestInput: request(),
        rawContext: {
          ...context(),
          actorMember: { ...primary, status: "inactive" },
        },
      },
      {
        actorInput: actor,
        requestInput: {
          ...request(),
          tasks: [{ id: IDS.task, version: task.version - 1 }],
        },
        rawContext: context(),
      },
      {
        actorInput: actor,
        requestInput: request(),
        rawContext: {
          ...context(),
          tasks: [{ ...task, visibility: hiddenVisibility }],
        },
      },
      {
        actorInput: actor,
        requestInput: request(),
        rawContext: {
          ...context(),
          signals: [
            {
              signal: { ...signal, visibility: hiddenVisibility },
              sourceKind: "potential_task",
            },
          ],
        },
      },
      {
        actorInput: actor,
        requestInput: {
          ...request(),
          evidence: [
            ...request().evidence,
            { id: IDS.extraEvidence, version: 3 },
          ],
        },
        rawContext: {
          ...context(),
          evidence: [
            evidence,
            {
              ...evidence,
              id: IDS.extraEvidence,
              speakerId: IDS.outsider,
            },
          ],
        },
      },
    ];

    for (const testCase of cases) {
      const repositoryFixture = createRepository(testCase.rawContext);
      const providerFixture = createProvider();
      const service = createService(
        repositoryFixture.repository,
        providerFixture.provider,
      );

      const result = await service.draftDomainSuggestion(
        testCase.actorInput,
        testCase.requestInput,
      );

      expect(result.ok).toBe(false);
      expect(providerFixture.complete).not.toHaveBeenCalled();
      expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
    }
  });

  it("rejects raw evidence projections and discussion-only signals before provider invocation", async () => {
    const rawRepository = createRepository({
      ...context(),
      evidence: [{ ...evidence, rawRef: "private://raw-evidence" }],
    });
    const rawProvider = createProvider();
    const rawService = createService(rawRepository.repository, rawProvider.provider);

    expect(
      await rawService.draftDomainSuggestion(actor, request()),
    ).toMatchObject({ ok: false, error: { code: "internal_failure" } });
    expect(rawProvider.complete).not.toHaveBeenCalled();

    const discussionRepository = createRepository({
      ...context(),
      signals: [{ signal, sourceKind: "discussion_only" }],
    });
    const discussionProvider = createProvider();
    const discussionService = createService(
      discussionRepository.repository,
      discussionProvider.provider,
    );

    expect(
      await discussionService.draftDomainSuggestion(actor, request()),
    ).toMatchObject({ ok: false, error: { code: "ineligible_fact" } });
    expect(discussionProvider.complete).not.toHaveBeenCalled();
  });

  it("returns bounded review after two invalid outputs with zero mutation", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider({
      status: "completed",
      completion: {
        output: { name: "Unbounded", nextAction: null, ownerId: IDS.partner },
        latencyMs: 5,
        usage: { inputTokens: 4, outputTokens: 4 },
      },
    });
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );

    const result = await service.draftDomainSuggestion(actor, request());

    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "needs_human_review",
        reason: "provider_invalid_output",
        attempts: 2,
        consequentialMutationAllowed: false,
        metadata: { contentLogged: false },
      },
    });
    expect(providerFixture.complete).toHaveBeenCalledTimes(2);
    expect(repositoryFixture.revalidateDomainSuggestionContext).not.toHaveBeenCalled();
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
  });

  it("returns bounded review after provider timeouts with zero mutation", async () => {
    const repositoryFixture = createRepository();
    const complete = vi.fn<LLMProvider["complete"]>();
    complete.mockImplementation((_providerRequest, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve({
              status: "failed",
              failure: { code: "provider_timeout", retryable: true },
            });
          },
          { once: true },
        );
      }),
    );
    const provider: LLMProvider = { complete };
    const service = createService(repositoryFixture.repository, provider);

    const result = await service.draftDomainSuggestion(actor, {
      ...request(),
      timeoutMs: 100,
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "needs_human_review",
        reason: "provider_timeout",
        attempts: 2,
        consequentialMutationAllowed: false,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
  });

  it.each([
    "authorization_changed",
    "evidence_changed",
    "version_changed",
  ] as const)(
    "discards a validated suggestion when %s during provider execution",
    async (status) => {
      const repositoryFixture = createRepository();
      repositoryFixture.revalidateDomainSuggestionContext.mockResolvedValue({
        status,
      });
      const providerFixture = createProvider();
      const service = createService(
        repositoryFixture.repository,
        providerFixture.provider,
      );

      const result = await service.draftDomainSuggestion(actor, request());

      expect(result).toMatchObject({
        ok: true,
        result: {
          status: "needs_human_review",
          reason: status,
          consequentialMutationAllowed: false,
        },
      });
      expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
    },
  );
});

describe("human confirmation boundary", () => {
  it("does not persist a provider suggestion without explicit confirmation", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider();
    const draft = await produceDraft(
      repositoryFixture.repository,
      providerFixture.provider,
    );
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );

    const result = await service.confirmDomainSuggestion(actor, {
      requestId: IDS.confirmRequest,
      idempotencyKey: "confirm-domain-suggestion-0001",
      suggestion: draft,
      confirmedByHuman: false,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
  });

  it("persists only after the requesting human is reauthorized and the guard is current", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider();
    const draft = await produceDraft(
      repositoryFixture.repository,
      providerFixture.provider,
    );
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );

    const result = await service.confirmDomainSuggestion(actor, {
      requestId: IDS.confirmRequest,
      idempotencyKey: "confirm-domain-suggestion-0001",
      suggestion: draft,
      confirmedByHuman: true,
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        id: IDS.suggestion,
        ownerId: null,
        status: "active",
        name: "复诊安排",
      },
    });
    expect(repositoryFixture.persistConfirmedDomain).toHaveBeenCalledTimes(1);
    const persisted = repositoryFixture.persistConfirmedDomain.mock.calls[0]?.[0];
    expect(persisted?.confirmedByMemberId).toBe(IDS.primary);
    expect(persisted?.guard).toEqual(draft.guard);
    expect(providerFixture.complete).toHaveBeenCalledTimes(1);
  });

  it("rejects a different actor and stale confirmation without a domain write", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider();
    const draft = await produceDraft(
      repositoryFixture.repository,
      providerFixture.provider,
    );
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );
    const partnerActor: MemberActor = {
      ...actor,
      memberId: IDS.partner,
      role: "partner",
    };

    expect(
      await service.confirmDomainSuggestion(partnerActor, {
        requestId: IDS.confirmRequest,
        idempotencyKey: "confirm-domain-suggestion-0001",
        suggestion: draft,
        confirmedByHuman: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();

    repositoryFixture.revalidateDomainSuggestionContext.mockResolvedValue({
      status: "version_changed",
    });
    expect(
      await service.confirmDomainSuggestion(actor, {
        requestId: IDS.confirmRequest,
        idempotencyKey: "confirm-domain-suggestion-0001",
        suggestion: draft,
        confirmedByHuman: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "stale_version" } });
    expect(repositoryFixture.persistConfirmedDomain).not.toHaveBeenCalled();
  });
});
