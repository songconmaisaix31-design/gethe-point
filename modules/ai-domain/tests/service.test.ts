import { describe, expect, it, vi } from "vitest";

import {
  type Domain,
  type LLMProvider,
  type LLMProviderRequest,
  type LLMProviderResult,
} from "../../../packages/contracts/src/index";

import {
  createDomainSuggestionService,
  type DomainSuggestionContext,
  type DomainSuggestionRepository,
  type StoredDomainDraft,
} from "../src";
import {
  actor,
  baseContext,
  createdAt,
  draftReceipt,
  ids,
  partnerActor,
  request,
  validProviderResult,
} from "./fixtures";

const requireValue = <Value>(
  value: Value | undefined,
  label: string,
): Value => {
  if (value === undefined) {
    throw new Error(`Missing test fixture value: ${label}`);
  }
  return value;
};

const createProvider = (
  results: readonly LLMProviderResult[] = [validProviderResult()],
) => {
  let index = 0;
  const requests: LLMProviderRequest[] = [];
  const complete = vi.fn<LLMProvider["complete"]>((providerRequest) => {
    requests.push(providerRequest);
    const result = results[Math.min(index, results.length - 1)];
    index += 1;
    return result === undefined
      ? Promise.reject(new Error("No provider fixture result."))
      : Promise.resolve(result);
  });
  const provider: LLMProvider = {
    complete,
  };
  return { provider, requests, complete };
};

const createRepository = (
  contextSequence: readonly unknown[] = [baseContext()],
) => {
  let contextIndex = 0;
  let issuedDraft: StoredDomainDraft | undefined;
  let domainMutationCount = 0;
  const confirmations = new Map<string, Domain>();

  const loadDomainSuggestionContext =
    vi.fn<DomainSuggestionRepository["loadDomainSuggestionContext"]>(() => {
      const context =
        contextSequence[Math.min(contextIndex, contextSequence.length - 1)];
      contextIndex += 1;
      return Promise.resolve(context);
    });
  const issueDomainDraft =
    vi.fn<DomainSuggestionRepository["issueDomainDraft"]>(({ draft }) => {
      issuedDraft = draft;
      return Promise.resolve({ status: "issued", draftReceipt });
    });
  const loadIssuedDomainDraft =
    vi.fn<DomainSuggestionRepository["loadIssuedDomainDraft"]>(
      ({ draftReceipt: candidate }) =>
        Promise.resolve(
          candidate === draftReceipt && issuedDraft !== undefined
            ? { status: "found", draft: issuedDraft }
            : { status: "not_found" },
        ),
    );
  const persistConfirmedDomain =
    vi.fn<DomainSuggestionRepository["persistConfirmedDomain"]>((input) => {
      const previous = confirmations.get(input.idempotencyKey);
      if (previous !== undefined) {
        return Promise.resolve({ status: "replayed", domain: previous });
      }
      domainMutationCount += 1;
      confirmations.set(input.idempotencyKey, input.domain);
      return Promise.resolve({ status: "persisted", domain: input.domain });
    });

  const repository: DomainSuggestionRepository = {
    loadDomainSuggestionContext,
    issueDomainDraft,
    loadIssuedDomainDraft,
    persistConfirmedDomain,
  };

  return {
    repository,
    get issuedDraft() {
      return issuedDraft;
    },
    replaceIssuedDraft(draft: StoredDomainDraft) {
      issuedDraft = draft;
    },
    get domainMutationCount() {
      return domainMutationCount;
    },
    mocks: {
      loadDomainSuggestionContext,
      issueDomainDraft,
      loadIssuedDomainDraft,
      persistConfirmedDomain,
    },
  };
};

const createService = (
  repository: DomainSuggestionRepository,
  provider: LLMProvider,
) =>
  createDomainSuggestionService({
    repository,
    provider,
    clock: { now: () => new Date(createdAt) },
    createId: () => ids.generatedDomain,
  });

const confirmationRequest = {
  requestId: ids.confirmRequest,
  idempotencyKey: "domain-confirmation-0001",
  draftReceipt,
};

describe("AI domain suggestion guard", () => {
  it("sends only bounded redacted excerpts, issues an opaque receipt, and persists only on exact confirmation", async () => {
    const repositoryFixture = createRepository();
    const providerFixture = createProvider();
    const service = createService(
      repositoryFixture.repository,
      providerFixture.provider,
    );

    const drafted = await service.draftDomainSuggestion(actor, request());
    expect(drafted.ok).toBe(true);
    if (!drafted.ok || drafted.result.status !== "awaiting_human_confirmation") {
      return;
    }
    expect(Object.keys(drafted.result).sort()).toEqual(
      ["draftReceipt", "metadata", "status", "suggestion"].sort(),
    );
    expect(drafted.result.draftReceipt).toBe(draftReceipt);
    expect(repositoryFixture.mocks.issueDomainDraft).toHaveBeenCalledTimes(1);
    expect(repositoryFixture.mocks.persistConfirmedDomain).not.toHaveBeenCalled();

    const providerRequest = requireValue(
      providerFixture.requests[0],
      "provider request",
    );
    expect(providerRequest.redactedInput).toContain(
      "The follow-up appointment needs scheduling.",
    );
    expect(providerRequest.redactedInput).toContain("agent_dm");
    for (const selectedId of Object.values(ids)) {
      expect(providerRequest.redactedInput).not.toContain(selectedId);
    }
    expect(providerRequest.redactedInput).not.toContain("rawRef");
    expect(providerRequest.redactedInput).not.toContain("rawContent");
    expect(new TextEncoder().encode(providerRequest.redactedInput).byteLength).toBeLessThanOrEqual(
      8_000,
    );

    const confirmed = await service.confirmDomainSuggestion(
      actor,
      confirmationRequest,
    );
    expect(confirmed).toMatchObject({
      ok: true,
      result: {
        id: ids.generatedDomain,
        name: "Recent health follow-up",
        ownerId: null,
      },
    });
    expect(repositoryFixture.domainMutationCount).toBe(1);

    const tamperedFields = await service.confirmDomainSuggestion(actor, {
      ...confirmationRequest,
      suggestion: { name: "Client replacement", nextAction: null },
    });
    expect(tamperedFields).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(repositoryFixture.domainMutationCount).toBe(1);
  });

  it("rejects unauthorized, non-exact, stale, hidden, and mismatched source graphs before provider invocation", async () => {
    const cases: Readonly<{ context: unknown; request?: unknown }>[] = [];

    const deleting = baseContext();
    deleting.space.status = "deleting";
    cases.push({ context: deleting });

    const revoked = baseContext();
    revoked.actorMember.analysisConsent = "revoked";
    requireValue(revoked.members[0], "revoked member").analysisConsent =
      "revoked";
    cases.push({ context: revoked });

    const inactive = baseContext();
    inactive.actorMember.status = "inactive";
    requireValue(inactive.members[0], "inactive member").status = "inactive";
    cases.push({ context: inactive });

    const review = baseContext();
    requireValue(review.tasks[0], "review task").reviewState = "needs_review";
    cases.push({ context: review });

    const hidden = baseContext();
    requireValue(hidden.tasks[0], "hidden task").visibility = {
      kind: "members",
      memberIds: [ids.partner],
    };
    requireValue(hidden.signals[0], "hidden signal").signal.visibility = {
      kind: "members",
      memberIds: [ids.partner],
    };
    cases.push({ context: hidden });

    const discussion = baseContext();
    requireValue(discussion.signals[0], "discussion signal").sourceKind =
      "discussion_only";
    cases.push({ context: discussion });

    const deleted = baseContext();
    requireValue(deleted.evidence[0], "deleted evidence").state = "deleted";
    const deletedSignal = requireValue(deleted.signals[0], "deleted signal");
    requireValue(
      deletedSignal.signal.provenance[0],
      "deleted provenance",
    ).state = "deleted";
    deletedSignal.signal.evidenceState = "evidence_missing";
    cases.push({ context: deleted });

    const evidenceSpeakerMismatch = baseContext();
    requireValue(
      evidenceSpeakerMismatch.evidence[0],
      "mismatched evidence",
    ).speakerId = ids.partner;
    cases.push({ context: evidenceSpeakerMismatch });

    const provenanceSpeakerMismatch = baseContext();
    const mismatchedSignal = requireValue(
      provenanceSpeakerMismatch.signals[0],
      "mismatched signal",
    );
    requireValue(
      mismatchedSignal.signal.provenance[0],
      "mismatched provenance",
    ).speakerId = ids.partner;
    cases.push({ context: provenanceSpeakerMismatch });

    const missingSourceMember = baseContext();
    requireValue(
      missingSourceMember.signals[0],
      "missing-source signal",
    ).signal.speakerId = ids.partner;
    cases.push({ context: missingSourceMember });

    const rawProjection = {
      ...baseContext(),
      evidence: [
        {
          ...requireValue(baseContext().evidence[0], "raw evidence projection"),
          rawRef: "private://evidence",
        },
      ],
    };
    cases.push({ context: rawProjection });

    const staleRequest = request();
    requireValue(staleRequest.evidence[0], "stale evidence reference").version +=
      1;
    cases.push({ context: baseContext(), request: staleRequest });

    const missingSelection = request();
    cases.push({
      context: baseContext(),
      request: { ...missingSelection, signals: [] },
    });

    for (const testCase of cases) {
      const repositoryFixture = createRepository([testCase.context]);
      const providerFixture = createProvider();
      const service = createService(
        repositoryFixture.repository,
        providerFixture.provider,
      );
      const result = await service.draftDomainSuggestion(
        actor,
        testCase.request ?? request(),
      );
      expect(result.ok).toBe(false);
      expect(providerFixture.complete).not.toHaveBeenCalled();
      expect(repositoryFixture.mocks.issueDomainDraft).not.toHaveBeenCalled();
      expect(repositoryFixture.domainMutationCount).toBe(0);
    }
  });

  it("returns bounded review after invalid outputs, provider errors, and real timeouts", async () => {
    const invalidProvider = createProvider([
      {
        status: "completed",
        completion: {
          output: { name: "Missing next action" },
          latencyMs: 1,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      },
    ]);
    const unavailableProvider = createProvider([
      {
        status: "failed",
        failure: { code: "provider_unavailable", retryable: true },
      },
    ]);
    const timeoutComplete = vi.fn<LLMProvider["complete"]>(
      () =>
        new Promise<LLMProviderResult>(() => {
          // The service timeout owns completion of this attempt.
        }),
    );
    const scenarios: Readonly<{
      provider: LLMProvider;
      calls: () => number;
      reason: string;
    }>[] = [
      {
        provider: invalidProvider.provider,
        calls: () => invalidProvider.complete.mock.calls.length,
        reason: "provider_invalid_output",
      },
      {
        provider: unavailableProvider.provider,
        calls: () => unavailableProvider.complete.mock.calls.length,
        reason: "provider_unavailable",
      },
      {
        provider: { complete: timeoutComplete },
        calls: () => timeoutComplete.mock.calls.length,
        reason: "provider_timeout",
      },
    ];

    for (const scenario of scenarios) {
      const repositoryFixture = createRepository();
      const service = createService(repositoryFixture.repository, scenario.provider);
      const result = await service.draftDomainSuggestion(actor, request());
      expect(result).toMatchObject({
        ok: true,
        result: {
          status: "needs_human_review",
          reason: scenario.reason,
          attempts: 2,
          consequentialMutationAllowed: false,
        },
      });
      expect(scenario.calls()).toBe(2);
      expect(repositoryFixture.mocks.issueDomainDraft).not.toHaveBeenCalled();
      expect(repositoryFixture.domainMutationCount).toBe(0);
    }
  });

  it("discards actor, membership, visibility, evidence, review, and version drift after provider return", async () => {
    const drifts: DomainSuggestionContext[] = [];

    const consent = baseContext();
    consent.actorMember.analysisConsent = "revoked";
    requireValue(consent.members[0], "consent member").analysisConsent =
      "revoked";
    drifts.push(consent);

    const membership = baseContext();
    membership.actorMember.status = "inactive";
    requireValue(membership.members[0], "membership member").status =
      "inactive";
    drifts.push(membership);

    const visibility = baseContext();
    requireValue(visibility.tasks[0], "visibility task").visibility = {
      kind: "members",
      memberIds: [ids.partner],
    };
    requireValue(visibility.signals[0], "visibility signal").signal.visibility = {
      kind: "members",
      memberIds: [ids.partner],
    };
    drifts.push(visibility);

    const evidence = baseContext();
    requireValue(evidence.evidence[0], "drift evidence").state = "deleted";
    const evidenceSignal = requireValue(
      evidence.signals[0],
      "drift evidence signal",
    );
    requireValue(
      evidenceSignal.signal.provenance[0],
      "drift provenance",
    ).state = "deleted";
    evidenceSignal.signal.evidenceState = "evidence_missing";
    drifts.push(evidence);

    const review = baseContext();
    requireValue(review.tasks[0], "drift review task").reviewState =
      "needs_review";
    drifts.push(review);

    const version = baseContext();
    requireValue(version.tasks[0], "drift version task").version += 1;
    drifts.push(version);

    for (const drift of drifts) {
      const repositoryFixture = createRepository([baseContext(), drift]);
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
          consequentialMutationAllowed: false,
        },
      });
      expect(repositoryFixture.mocks.issueDomainDraft).not.toHaveBeenCalled();
      expect(repositoryFixture.domainMutationCount).toBe(0);
    }
  });
});

describe("opaque human confirmation", () => {
  it("rejects fabricated receipts, a different actor, and persisted-content tampering", async () => {
    const emptyRepository = createRepository();
    const emptyService = createService(
      emptyRepository.repository,
      createProvider().provider,
    );
    const fabricated = await emptyService.confirmDomainSuggestion(actor, {
      ...confirmationRequest,
      draftReceipt: "fabricated_receipt_0000000000000000000000001",
    });
    expect(fabricated).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });

    const otherRepository = createRepository();
    const otherService = createService(
      otherRepository.repository,
      createProvider().provider,
    );
    await otherService.draftDomainSuggestion(actor, request());
    const otherActor = await otherService.confirmDomainSuggestion(
      partnerActor,
      confirmationRequest,
    );
    expect(otherActor).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(otherRepository.domainMutationCount).toBe(0);

    const tamperedRepository = createRepository();
    const tamperedService = createService(
      tamperedRepository.repository,
      createProvider().provider,
    );
    await tamperedService.draftDomainSuggestion(actor, request());
    const stored = tamperedRepository.issuedDraft;
    expect(stored).toBeDefined();
    if (stored === undefined) {
      return;
    }
    tamperedRepository.replaceIssuedDraft({
      ...stored,
      suggestion: { ...stored.suggestion, name: "Tampered server content" },
    });
    const tampered = await tamperedService.confirmDomainSuggestion(
      actor,
      confirmationRequest,
    );
    expect(tampered).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(tamperedRepository.domainMutationCount).toBe(0);
  });

  it("revalidates the guard and makes exact confirmation replay one total mutation", async () => {
    const repositoryFixture = createRepository();
    const service = createService(
      repositoryFixture.repository,
      createProvider().provider,
    );
    await service.draftDomainSuggestion(actor, request());

    const first = await service.confirmDomainSuggestion(actor, confirmationRequest);
    const replay = await service.confirmDomainSuggestion(actor, confirmationRequest);
    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(repositoryFixture.domainMutationCount).toBe(1);

    const stale = baseContext();
    requireValue(stale.tasks[0], "stale confirmation task").version += 1;
    const staleRepository = createRepository([baseContext(), baseContext(), stale]);
    const staleService = createService(
      staleRepository.repository,
      createProvider().provider,
    );
    await staleService.draftDomainSuggestion(actor, request());
    const staleConfirmation = await staleService.confirmDomainSuggestion(
      actor,
      confirmationRequest,
    );
    expect(staleConfirmation).toMatchObject({
      ok: false,
      error: { code: "stale_version" },
    });
    expect(staleRepository.domainMutationCount).toBe(0);
  });
});
