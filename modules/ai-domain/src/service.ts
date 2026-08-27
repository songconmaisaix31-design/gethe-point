import { createHash, randomUUID } from "node:crypto";

import {
  DomainSchema,
  EntityIdSchema,
  MemberActorSchema,
  TimestampSchema,
  type Clock,
  type Domain,
  type LLMProvider,
  type LLMProviderFailure,
  type LLMProviderRequest,
  type MemberActor,
} from "../../../packages/contracts/src/index";

import { sharedVisibilitiesMatch } from "../../responsibility";
import {
  domainSuggestionGuardsMatch,
  selectionFromRequest,
  validateDomainSuggestionContext,
  type DomainContextFailureCode,
  type DomainContextValidation,
} from "./guard";
import {
  ConfirmDomainSuggestionRequestSchema,
  DOMAIN_SUGGESTION_OUTPUT_JSON_SCHEMA,
  DomainDraftContentSchema,
  DomainSuggestionContextSchema,
  DomainSuggestionMetadataSchema,
  DomainSuggestionReceiptSchema,
  DomainSuggestionRequestSchema,
  DomainSuggestionReviewSchema,
  IssueDomainDraftResultSchema,
  LoadDomainDraftResultSchema,
  PersistConfirmedDomainResultSchema,
  StoredDomainDraftSchema,
  type DomainDraftContent,
  type DomainSuggestionContext,
  type DomainSuggestionGuard,
  type DomainSuggestionMetadata,
  type DomainSuggestionReceipt,
  type DomainSuggestionRequest,
  type DomainSuggestionReview,
  type DomainSuggestionSelection,
  type StoredDomainDraft,
} from "./model";
import { runProviderAttempt } from "./provider";

export type DomainSuggestionFailureCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "stale_version"
  | "evidence_missing"
  | "idempotency_conflict"
  | "conflict"
  | "internal_failure";

export interface DomainSuggestionFailure {
  readonly code: DomainSuggestionFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type DomainSuggestionResult<Result> =
  | Readonly<{ ok: true; result: Result }>
  | Readonly<{ ok: false; error: DomainSuggestionFailure }>;

const SAFE_MESSAGES: Readonly<Record<DomainSuggestionFailureCode, string>> = {
  invalid_request: "The domain suggestion request is invalid.",
  unauthenticated: "A valid member actor is required.",
  forbidden: "The actor is not allowed to use the selected sources.",
  not_found: "The selected domain-suggestion records are unavailable.",
  stale_version: "The selected records changed before confirmation.",
  evidence_missing: "Current evidence is required for this suggestion.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  conflict: "The domain suggestion can no longer be confirmed.",
  internal_failure: "The domain suggestion operation failed.",
};

const fail = <Result>(
  code: DomainSuggestionFailureCode,
): DomainSuggestionResult<Result> => ({
  ok: false,
  error: {
    code,
    message: SAFE_MESSAGES[code],
    retryable: code === "internal_failure",
  },
});

export interface LoadDomainSuggestionContextInput {
  readonly actor: MemberActor;
  readonly spaceId: string;
  readonly taskIds: readonly string[];
  readonly signalIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface IssueDomainDraftInput {
  readonly draft: StoredDomainDraft;
}

export interface LoadIssuedDomainDraftInput {
  readonly draftReceipt: string;
}

export interface PersistConfirmedDomainInput {
  readonly actor: MemberActor;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly draftReceipt: string;
  readonly draftIntegrityHash: string;
  readonly guard: DomainSuggestionGuard;
  readonly domain: Domain;
  readonly confirmedByMemberId: string;
}

/**
 * `issueDomainDraft` must create an unguessable receipt mapped to one immutable
 * server-side draft. `persistConfirmedDomain` atomically verifies that exact
 * unconsumed receipt and guard before applying one idempotent domain write.
 */
export interface DomainSuggestionRepository {
  loadDomainSuggestionContext(
    input: LoadDomainSuggestionContextInput,
  ): Promise<unknown>;
  issueDomainDraft(input: IssueDomainDraftInput): Promise<unknown>;
  loadIssuedDomainDraft(input: LoadIssuedDomainDraftInput): Promise<unknown>;
  persistConfirmedDomain(input: PersistConfirmedDomainInput): Promise<unknown>;
}

export interface DomainSuggestionServiceDependencies {
  readonly repository: DomainSuggestionRepository;
  readonly provider: LLMProvider;
  readonly clock: Clock;
  readonly createId?: () => string;
}

type LoadedContext = Readonly<{
  context: DomainSuggestionContext;
  validation: Extract<DomainContextValidation, { ok: true }>;
}>;

type LoadContextResult =
  | Readonly<{ ok: true; value: LoadedContext }>
  | Readonly<{
      ok: false;
      code: DomainContextFailureCode | "internal_failure";
    }>;

const contextLoadInput = (
  actor: MemberActor,
  selection: DomainSuggestionSelection,
): LoadDomainSuggestionContextInput => ({
  actor,
  spaceId: selection.spaceId,
  taskIds: selection.tasks.map(({ id }) => id),
  signalIds: selection.signals.map(({ id }) => id),
  evidenceIds: selection.evidence.map(({ id }) => id),
});

const loadAndValidateContext = async (
  repository: DomainSuggestionRepository,
  actor: MemberActor,
  selection: DomainSuggestionSelection,
): Promise<LoadContextResult> => {
  let rawContext: unknown;
  try {
    rawContext = await repository.loadDomainSuggestionContext(
      contextLoadInput(actor, selection),
    );
  } catch {
    return { ok: false, code: "internal_failure" };
  }
  const context = DomainSuggestionContextSchema.safeParse(rawContext);
  if (!context.success) {
    return { ok: false, code: "internal_failure" };
  }
  const validation = validateDomainSuggestionContext(
    context.data,
    actor,
    selection,
  );
  return validation.ok
    ? { ok: true, value: { context: context.data, validation } }
    : { ok: false, code: validation.code };
};

interface ProviderTotals {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

const providerOutcome = (
  reason: LLMProviderFailure["code"],
): DomainSuggestionMetadata["providerOutcome"] => {
  switch (reason) {
    case "provider_invalid_output":
      return "invalid_output";
    case "provider_timeout":
      return "timeout";
    case "provider_unavailable":
      return "unavailable";
  }
};

const createMetadata = (
  request: DomainSuggestionRequest,
  attempts: 1 | 2,
  outcome: DomainSuggestionMetadata["providerOutcome"],
  totals: ProviderTotals,
): DomainSuggestionMetadata =>
  DomainSuggestionMetadataSchema.parse({
    requestId: request.requestId,
    purpose: "domain_draft",
    promptVersion: request.promptVersion,
    attempts,
    providerOutcome: outcome,
    latencyMs: totals.latencyMs,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    contentLogged: false,
  });

const reviewReason = (
  reason: LLMProviderFailure["code"],
): DomainSuggestionReview["reason"] => reason;

const contextReviewReason = (
  code: DomainContextFailureCode,
): DomainSuggestionReview["reason"] => {
  switch (code) {
    case "stale_version":
      return "version_changed";
    case "evidence_missing":
      return "evidence_changed";
    case "invalid_request":
    case "not_found":
    case "forbidden":
      return "authorization_changed";
  }
};

const reviewResult = (
  reason: DomainSuggestionReview["reason"],
  metadata: DomainSuggestionMetadata,
): DomainSuggestionReview =>
  DomainSuggestionReviewSchema.parse({
    status: "needs_human_review",
    reason,
    attempts: metadata.attempts,
    consequentialMutationAllowed: false,
    metadata,
  });

const draftContentFromStored = (
  draft: StoredDomainDraft,
): DomainDraftContent =>
  DomainDraftContentSchema.parse({
    domainId: draft.domainId,
    spaceId: draft.spaceId,
    requestedByMemberId: draft.requestedByMemberId,
    suggestion: draft.suggestion,
    visibility: draft.visibility,
    evidenceIds: draft.evidenceIds,
    selection: draft.selection,
    guard: draft.guard,
    promptVersion: draft.promptVersion,
    createdAt: draft.createdAt,
    source: draft.source,
    status: draft.status,
    metadata: draft.metadata,
  });

export const domainDraftIntegrityHash = (
  content: DomainDraftContent,
): string =>
  createHash("sha256").update(JSON.stringify(content)).digest("hex");

const persistedDomainMatchesDraft = (
  domain: Domain,
  draft: StoredDomainDraft,
): boolean =>
  domain.id === draft.domainId &&
  domain.spaceId === draft.spaceId &&
  domain.createdAt === draft.createdAt &&
  domain.updatedAt === draft.createdAt &&
  domain.version === 0 &&
  domain.name === draft.suggestion.name &&
  domain.ownerId === null &&
  domain.status === "active" &&
  domain.nextAction === draft.suggestion.nextAction &&
  sharedVisibilitiesMatch(domain.visibility, draft.visibility) &&
  domain.evidenceIds.length === draft.evidenceIds.length &&
  domain.evidenceIds.every((id) => draft.evidenceIds.includes(id));

const mapPersistFailure = (
  status:
    | "not_found"
    | "forbidden"
    | "stale_version"
    | "receipt_consumed"
    | "idempotency_conflict"
    | "conflict",
): DomainSuggestionFailureCode => {
  switch (status) {
    case "not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
    case "stale_version":
      return "stale_version";
    case "receipt_consumed":
    case "conflict":
      return "conflict";
    case "idempotency_conflict":
      return "idempotency_conflict";
  }
};

export const createDomainSuggestionService = (
  dependencies: DomainSuggestionServiceDependencies,
) => {
  const createId = dependencies.createId ?? randomUUID;

  const draftDomainSuggestion = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<
    DomainSuggestionResult<DomainSuggestionReceipt | DomainSuggestionReview>
  > => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }
    const requestResult = DomainSuggestionRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }
    const actor = actorResult.data;
    const request = requestResult.data;
    if (actor.spaceId !== request.spaceId) {
      return fail("not_found");
    }
    const selection = selectionFromRequest(request);
    const initial = await loadAndValidateContext(
      dependencies.repository,
      actor,
      selection,
    );
    if (!initial.ok) {
      return fail(initial.code);
    }

    const totals: ProviderTotals = {
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    let output: DomainDraftContent["suggestion"] | undefined;
    let lastFailure: LLMProviderFailure["code"] = "provider_unavailable";
    let attempts: 1 | 2 = 1;

    for (const attempt of [1, 2] as const) {
      attempts = attempt;
      const providerRequest: LLMProviderRequest = {
        requestId: request.requestId,
        purpose: "domain_draft",
        promptVersion: request.promptVersion,
        redactedInput: initial.value.validation.redactedInput,
        outputSchema: DOMAIN_SUGGESTION_OUTPUT_JSON_SCHEMA,
        timeoutMs: request.timeoutMs,
        attempt,
      };
      const result = await runProviderAttempt(
        dependencies.provider,
        providerRequest,
      );
      totals.latencyMs += result.totals.latencyMs;
      totals.inputTokens += result.totals.inputTokens;
      totals.outputTokens += result.totals.outputTokens;
      if (result.status === "validated") {
        output = result.output;
        break;
      }
      lastFailure = result.reason;
    }

    if (output === undefined) {
      const metadata = createMetadata(
        request,
        attempts,
        providerOutcome(lastFailure),
        totals,
      );
      return {
        ok: true,
        result: reviewResult(reviewReason(lastFailure), metadata),
      };
    }

    const metadata = createMetadata(request, attempts, "validated", totals);
    const current = await loadAndValidateContext(
      dependencies.repository,
      actor,
      selection,
    );
    if (!current.ok) {
      if (current.code === "internal_failure") {
        return fail("internal_failure");
      }
      return {
        ok: true,
        result: reviewResult(contextReviewReason(current.code), metadata),
      };
    }
    if (
      !domainSuggestionGuardsMatch(
        initial.value.validation.guard,
        current.value.validation.guard,
      ) ||
      initial.value.validation.redactedInput !==
        current.value.validation.redactedInput ||
      !sharedVisibilitiesMatch(
        initial.value.validation.visibility,
        current.value.validation.visibility,
      )
    ) {
      return {
        ok: true,
        result: reviewResult("version_changed", metadata),
      };
    }

    const domainId = createId();
    if (!EntityIdSchema.safeParse(domainId).success) {
      return fail("internal_failure");
    }
    let createdAt: string;
    try {
      createdAt = dependencies.clock.now().toISOString();
    } catch {
      return fail("internal_failure");
    }
    if (!TimestampSchema.safeParse(createdAt).success) {
      return fail("internal_failure");
    }

    const content = DomainDraftContentSchema.parse({
      domainId,
      spaceId: actor.spaceId,
      requestedByMemberId: actor.memberId,
      suggestion: output,
      visibility: current.value.validation.visibility,
      evidenceIds: current.value.validation.guard.evidence.map(({ id }) => id),
      selection,
      guard: current.value.validation.guard,
      promptVersion: request.promptVersion,
      createdAt,
      source: "validated_ai",
      status: "awaiting_human_confirmation",
      metadata,
    });
    const draft = StoredDomainDraftSchema.parse({
      ...content,
      integrityHash: domainDraftIntegrityHash(content),
    });

    let rawIssue: unknown;
    try {
      rawIssue = await dependencies.repository.issueDomainDraft({ draft });
    } catch {
      return fail("internal_failure");
    }
    const issue = IssueDomainDraftResultSchema.safeParse(rawIssue);
    if (!issue.success) {
      return fail("internal_failure");
    }
    if (issue.data.status === "conflict") {
      return fail("conflict");
    }

    return {
      ok: true,
      result: DomainSuggestionReceiptSchema.parse({
        status: "awaiting_human_confirmation",
        draftReceipt: issue.data.draftReceipt,
        suggestion: output,
        metadata,
      }),
    };
  };

  const confirmDomainSuggestion = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<DomainSuggestionResult<Domain>> => {
    const actorResult = MemberActorSchema.safeParse(actorInput);
    if (!actorResult.success) {
      return fail("unauthenticated");
    }
    const requestResult = ConfirmDomainSuggestionRequestSchema.safeParse(requestInput);
    if (!requestResult.success) {
      return fail("invalid_request");
    }
    const actor = actorResult.data;
    const request = requestResult.data;

    let rawLoad: unknown;
    try {
      rawLoad = await dependencies.repository.loadIssuedDomainDraft({
        draftReceipt: request.draftReceipt,
      });
    } catch {
      return fail("internal_failure");
    }
    const loaded = LoadDomainDraftResultSchema.safeParse(rawLoad);
    if (!loaded.success) {
      return fail("internal_failure");
    }
    if (loaded.data.status === "not_found") {
      return fail("not_found");
    }
    if (loaded.data.status === "consumed") {
      return fail("conflict");
    }

    const draft = loaded.data.draft;
    const content = draftContentFromStored(draft);
    if (
      domainDraftIntegrityHash(content) !== draft.integrityHash ||
      actor.spaceId !== draft.spaceId ||
      actor.memberId !== draft.requestedByMemberId
    ) {
      return fail("not_found");
    }

    const current = await loadAndValidateContext(
      dependencies.repository,
      actor,
      draft.selection,
    );
    if (!current.ok) {
      return fail(current.code);
    }
    if (
      !domainSuggestionGuardsMatch(draft.guard, current.value.validation.guard) ||
      !sharedVisibilitiesMatch(
        draft.visibility,
        current.value.validation.visibility,
      )
    ) {
      return fail("stale_version");
    }

    const domainResult = DomainSchema.safeParse({
      id: draft.domainId,
      spaceId: draft.spaceId,
      createdAt: draft.createdAt,
      updatedAt: draft.createdAt,
      version: 0,
      name: draft.suggestion.name,
      ownerId: null,
      status: "active",
      nextAction: draft.suggestion.nextAction,
      visibility: draft.visibility,
      evidenceIds: draft.evidenceIds,
    });
    if (!domainResult.success) {
      return fail("internal_failure");
    }

    let rawPersist: unknown;
    try {
      rawPersist = await dependencies.repository.persistConfirmedDomain({
        actor,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        draftReceipt: request.draftReceipt,
        draftIntegrityHash: draft.integrityHash,
        guard: draft.guard,
        domain: domainResult.data,
        confirmedByMemberId: actor.memberId,
      });
    } catch {
      return fail("internal_failure");
    }
    const persisted = PersistConfirmedDomainResultSchema.safeParse(rawPersist);
    if (!persisted.success) {
      return fail("internal_failure");
    }
    if (
      persisted.data.status !== "persisted" &&
      persisted.data.status !== "replayed"
    ) {
      return fail(mapPersistFailure(persisted.data.status));
    }
    if (!persistedDomainMatchesDraft(persisted.data.domain, draft)) {
      return fail("internal_failure");
    }
    return { ok: true, result: persisted.data.domain };
  };

  return Object.freeze({
    draftDomainSuggestion,
    confirmDomainSuggestion,
  });
};
