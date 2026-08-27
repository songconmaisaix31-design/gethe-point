import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  ActiveShareConsentSchema,
  ConfirmSignalRequestSchema,
  ConfirmSignalResultSchema,
  CreatePrivateMessageRequestSchema,
  CreatePrivateMessageResultSchema,
  CreateSignalDraftRequestSchema,
  CreateSignalDraftResultSchema,
  DecideConsentRequestSchema,
  DecideConsentResultSchema,
  DiscardedConsentSchema,
  EntityIdSchema,
  GetPrivateConversationRequestSchema,
  GetPrivateConversationResultSchema,
  GetVisibleSharedSignalsRequestSchema,
  GetVisibleSharedSignalsResultSchema,
  MemberActorSchema,
  PrivateMessageSchema,
  RawEvidenceViewSchema,
  RequestHashSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  TimestampSchema,
  type Clock,
  type ConfirmSignalError,
  type ConfirmSignalResult,
  type ConsentDecision,
  type ContractError,
  type ContractErrorCode,
  type CreatePrivateMessageError,
  type CreatePrivateMessageResult,
  type CreateSignalDraftError,
  type CreateSignalDraftResult,
  type DecideConsentError,
  type DecideConsentResult,
  type EntityId,
  type EvidenceProvenance,
  type GetPrivateConversationError,
  type GetPrivateConversationResult,
  type GetVisibleSharedSignalsError,
  type GetVisibleSharedSignalsResult,
  type MemberActor,
  type RequestHash,
  type RequestId,
  type SharedSignalPurpose,
  type TransportResult,
} from "../../../packages/contracts/src/index";
import {
  SignalDraftGenerationResultSchema,
  ValidatedSignalDraftCandidateSchema,
  createFixtureSignalDraftProvider,
  createHighRiskSignalDraftCandidate,
  createNeedsHumanReview,
  createSignalDraftGenerator,
  isApplicationTemplateSignalDraftCandidate,
  type SignalDraftGenerationResult,
  type SignalDraftGenerator,
  type ValidatedSignalDraftCandidate,
} from "../../ai-witness/src/index";
import {
  NOOP_SAFE_LOGGER,
  areProviderDerivedFieldsSafe,
  createSafeContractError,
  detectHighRiskContent,
  redactForProvider,
  requestIdFromUnknown,
  writeSafeLog,
  type ConversationOperation,
  type HighRiskDetection,
  type SafeLogger,
  type SafeOperationOutcome,
} from "../../boundary/src/index";
import {
  authorizeMember,
  isSharedVisibilityReadableBy,
  loadAuthorizedDraftSources,
  loadCurrentStoredDraftSources,
  sourceSnapshotsMatch,
  validateSharedVisibility,
  type AuthorizedDraftSources,
} from "./access";
import {
  RANDOM_ENTITY_ID_GENERATOR,
  type EntityIdGenerator,
} from "./runtime";
import type {
  ConversationStore,
  StoredSignalDraft,
} from "./store";

export interface ConversationHandlerOptions {
  readonly store: ConversationStore;
  readonly clock: Clock;
  readonly ids?: EntityIdGenerator;
  readonly logger?: SafeLogger;
  readonly signalDraftGenerator?: SignalDraftGenerator;
}

interface ResolvedDependencies {
  readonly store: ConversationStore;
  readonly clock: Clock;
  readonly ids: EntityIdGenerator;
  readonly logger: SafeLogger;
  readonly signalDraftGenerator: SignalDraftGenerator;
}

type CreatePrivateMessageResponse = TransportResult<
  CreatePrivateMessageResult,
  CreatePrivateMessageError
>;
type CreateSignalDraftResponse = TransportResult<
  CreateSignalDraftResult,
  CreateSignalDraftError
>;
type DecideConsentResponse = TransportResult<
  DecideConsentResult,
  DecideConsentError
>;
type ConfirmSignalResponse = TransportResult<
  ConfirmSignalResult,
  ConfirmSignalError
>;
type GetPrivateConversationResponse = TransportResult<
  GetPrivateConversationResult,
  GetPrivateConversationError
>;
type GetVisibleSharedSignalsResponse = TransportResult<
  GetVisibleSharedSignalsResult,
  GetVisibleSharedSignalsError
>;

export const GetRawEvidenceRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  evidenceId: EntityIdSchema,
});
export type GetRawEvidenceRequest = z.infer<
  typeof GetRawEvidenceRequestSchema
>;

export const GetRawEvidenceResultSchema = z.strictObject({
  status: z.literal("ready"),
  evidence: RawEvidenceViewSchema,
});
export type GetRawEvidenceResult = z.infer<typeof GetRawEvidenceResultSchema>;

type RawEvidenceErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "internal_failure";
type GetRawEvidenceResponse = TransportResult<
  GetRawEvidenceResult,
  ContractError<RawEvidenceErrorCode>
>;

const resolveDependencies = (
  options: Readonly<ConversationHandlerOptions>,
): ResolvedDependencies => {
  const ids = options.ids ?? RANDOM_ENTITY_ID_GENERATOR;
  const logger = options.logger ?? NOOP_SAFE_LOGGER;

  return Object.freeze({
    clock: options.clock,
    ids,
    logger,
    signalDraftGenerator:
      options.signalDraftGenerator ??
      createSignalDraftGenerator({
        logger,
        provider: createFixtureSignalDraftProvider(),
        source: "fixture",
      }),
    store: options.store,
  });
};

const timestampNow = (clock: Clock): string =>
  TimestampSchema.parse(clock.now().toISOString());

const actorFromUnknown = (input: unknown): MemberActor | undefined => {
  const parsed = MemberActorSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
};

const log = (
  dependencies: ResolvedDependencies,
  operation: ConversationOperation,
  requestId: RequestId,
  actor: MemberActor | undefined,
  outcome: SafeOperationOutcome,
  recordIds: readonly EntityId[] = [],
): void => {
  writeSafeLog(dependencies.logger, {
    actorId: actor?.memberId ?? null,
    attempt: null,
    latencyMs: null,
    operation,
    outcome,
    recordIds: [...recordIds],
    requestId,
    spaceId: actor?.spaceId ?? null,
  });
};

type FailureOutcome = Extract<SafeOperationOutcome, ContractErrorCode>;

const failure = <Code extends FailureOutcome>(
  dependencies: ResolvedDependencies,
  operation: ConversationOperation,
  requestId: RequestId,
  actor: MemberActor | undefined,
  code: Code,
): Readonly<{ ok: false; error: ContractError<Code> }> => {
  log(dependencies, operation, requestId, actor, code);
  return Object.freeze({
    error: createSafeContractError(code, requestId),
    ok: false as const,
  });
};

const privateInputsMatch = (
  expected: readonly string[],
  current: readonly string[],
): boolean =>
  expected.length === current.length &&
  expected.every((value, index) => value === current[index]);

const createPrivateMessageWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<CreatePrivateMessageResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "CreatePrivateMessage",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = CreatePrivateMessageRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "CreatePrivateMessage",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const mutation = await dependencies.store.transaction(async (transaction) => {
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const conversation = await transaction.findConversation(
        actor.spaceId,
        request.data.conversationId,
      );

      if (
        conversation?.type !== "agent_dm" ||
        !conversation.participantMemberIds.includes(actor.memberId)
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const existing = await transaction.findPrivateMessageByClientId(
        actor.spaceId,
        conversation.id,
        request.data.clientMessageId,
      );

      if (existing !== undefined) {
        const isReplay =
          existing.authorId === actor.memberId &&
          existing.visibility.memberId === actor.memberId &&
          existing.content === request.data.content &&
          existing.occurredAt === request.data.occurredAt;

        return isReplay
          ? { result: { message: existing, status: "created" as const }, status: "ready" as const }
          : { code: "conflict" as const, status: "error" as const };
      }

      const now = timestampNow(dependencies.clock);
      const message = PrivateMessageSchema.parse({
        authorId: actor.memberId,
        clientMessageId: request.data.clientMessageId,
        content: request.data.content,
        conversationId: conversation.id,
        createdAt: now,
        id: dependencies.ids.next(),
        occurredAt: request.data.occurredAt,
        spaceId: actor.spaceId,
        updatedAt: now,
        version: 0,
        visibility: { kind: "self", memberId: actor.memberId },
      });
      const result = CreatePrivateMessageResultSchema.parse({
        message,
        status: "created",
      });

      await transaction.insertPrivateMessage(message);
      return { result, status: "ready" as const };
    });

    if (mutation.status === "error") {
      return failure(
        dependencies,
        "CreatePrivateMessage",
        requestId,
        actor,
        mutation.code,
      );
    }

    log(dependencies, "CreatePrivateMessage", requestId, actor, "created", [
      mutation.result.message.id,
    ]);
    return { ok: true, result: mutation.result };
  } catch {
    return failure(
      dependencies,
      "CreatePrivateMessage",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const highRiskGeneration = (
  requestId: RequestId,
  promptVersion: string,
  detection: Readonly<HighRiskDetection>,
): ValidatedSignalDraftCandidate =>
  ValidatedSignalDraftCandidateSchema.parse({
    candidate: createHighRiskSignalDraftCandidate(
      detection.category,
      detection.guidance,
    ),
    metadata: AIExecutionMetadataSchema.parse({
      attempts: 1,
      contentLogged: false,
      inputTokens: 0,
      latencyMs: 0,
      outputTokens: 0,
      promptVersion,
      providerOutcome: "fixture",
      purpose: "signal_draft",
      requestId,
    }),
    source: "human",
    status: "validated",
  });

const generateDraft = async (
  dependencies: ResolvedDependencies,
  actor: MemberActor,
  request: ReturnType<typeof CreateSignalDraftRequestSchema.parse>,
  sources: Readonly<AuthorizedDraftSources>,
): Promise<
  Readonly<{
    result: SignalDraftGenerationResult;
    providerBypassed: boolean;
  }>
> => {
  const highRisk = detectHighRiskContent(sources.privateInputs);

  if (highRisk !== undefined) {
    return {
      providerBypassed: true,
      result: highRiskGeneration(
        request.requestId,
        request.promptVersion,
        highRisk,
      ),
    };
  }

  let rawGeneration: unknown;

  try {
    rawGeneration = await dependencies.signalDraftGenerator.generate({
      actorId: actor.memberId,
      privateInputs: [...sources.privateInputs],
      promptVersion: request.promptVersion,
      redactedInput: redactForProvider(sources.privateInputs),
      requestId: request.requestId,
      spaceId: actor.spaceId,
    });
  } catch {
    rawGeneration = createNeedsHumanReview({
      promptVersion: request.promptVersion,
      reason: "provider_unavailable",
      requestId: request.requestId,
    });
  }

  const generation = SignalDraftGenerationResultSchema.safeParse(rawGeneration);

  return {
    providerBypassed: false,
    result: generation.success
      ? generation.data
      : createNeedsHumanReview({
          promptVersion: request.promptVersion,
          reason: "provider_invalid_output",
          requestId: request.requestId,
        }),
  };
};

const providerCandidateIsSafe = (
  generation: Readonly<ValidatedSignalDraftCandidate>,
  privateInputs: readonly string[],
  requestId: RequestId,
  promptVersion: string,
): boolean =>
  (generation.source === "fixture" || generation.source === "validated_ai") &&
  generation.metadata.requestId === requestId &&
  generation.metadata.promptVersion === promptVersion &&
  generation.metadata.providerOutcome ===
    (generation.source === "fixture" ? "fixture" : "validated") &&
  isApplicationTemplateSignalDraftCandidate(generation.candidate) &&
  areProviderDerivedFieldsSafe(generation.candidate, privateInputs);

const createSignalDraftWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<CreateSignalDraftResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "CreateSignalDraft",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = CreateSignalDraftRequestSchema.safeParse(requestInput);

  if (
    !request.success ||
    new Set(request.data.evidenceIds).size !== request.data.evidenceIds.length
  ) {
    return failure(
      dependencies,
      "CreateSignalDraft",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const initial = await dependencies.store.transaction((transaction) =>
      loadAuthorizedDraftSources(transaction, actor, request.data, true),
    );

    if (initial.status === "error") {
      return failure(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        initial.code,
      );
    }

    const generated = await generateDraft(
      dependencies,
      actor,
      request.data,
      initial.value,
    );

    if (generated.result.status === "needs_human_review") {
      const result = CreateSignalDraftResultSchema.parse(generated.result);
      log(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        "needs_human_review",
      );
      return { ok: true, result };
    }

    if (
      (!generated.providerBypassed &&
        !providerCandidateIsSafe(
          generated.result,
          initial.value.privateInputs,
          requestId,
          request.data.promptVersion,
        )) ||
      (generated.providerBypassed && generated.result.source !== "human")
    ) {
      const result = CreateSignalDraftResultSchema.parse(
        createNeedsHumanReview({
          promptVersion: request.data.promptVersion,
          reason: "provider_invalid_output",
          requestId,
        }),
      );
      log(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        "needs_human_review",
      );
      return { ok: true, result };
    }

    const validatedGeneration: ValidatedSignalDraftCandidate = generated.result;

    const mutation = await dependencies.store.transaction(async (transaction) => {
      const current = await loadAuthorizedDraftSources(
        transaction,
        actor,
        request.data,
        true,
      );

      if (current.status === "error") {
        return current;
      }

      if (
        !sourceSnapshotsMatch(initial.value.snapshot, current.value.snapshot) ||
        !privateInputsMatch(initial.value.privateInputs, current.value.privateInputs)
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const now = timestampNow(dependencies.clock);
      const draft = SignalDraftSchema.parse({
        ...validatedGeneration.candidate,
        createdAt: now,
        evidenceIds: request.data.evidenceIds,
        id: dependencies.ids.next(),
        promptVersion: request.data.promptVersion,
        source: validatedGeneration.source,
        sourceMessageId: request.data.privateMessageId,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: now,
        version: 0,
      });
      const result = CreateSignalDraftResultSchema.parse({
        draft,
        metadata: validatedGeneration.metadata,
        status: "draft_created",
      });

      if (result.status !== "draft_created") {
        throw new Error("A validated candidate must produce a draft.");
      }

      await transaction.insertSignalDraft(draft, current.value.snapshot);
      return { result, status: "ready" as const };
    });

    if (mutation.status === "error") {
      return failure(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        mutation.code,
      );
    }

    log(
      dependencies,
      "CreateSignalDraft",
      requestId,
      actor,
      generated.providerBypassed ? "high_risk_bypassed" : "draft_created",
      [mutation.result.draft.id],
    );
    return { ok: true, result: mutation.result };
  } catch {
    return failure(
      dependencies,
      "CreateSignalDraft",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const decideConsentWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<DecideConsentResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "DecideConsent",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = DecideConsentRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "DecideConsent",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const mutation = await dependencies.store.transaction(async (transaction) => {
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const stored = await transaction.findStoredSignalDraft(
        actor.spaceId,
        request.data.signalDraftId,
      );

      if (stored?.draft.speakerId !== actor.memberId) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const currentSources = await loadCurrentStoredDraftSources(
        transaction,
        actor,
        stored,
      );

      if (
        currentSources.status === "error" ||
        !sourceSnapshotsMatch(
          stored.sourceSnapshot,
          currentSources.value.snapshot,
        )
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      if (
        (await transaction.findConsentDecisionForDraft(
          actor.spaceId,
          stored.draft.id,
        )) !== undefined
      ) {
        return { code: "conflict" as const, status: "error" as const };
      }

      if (
        request.data.decision === "share" &&
        ((request.data.expiresAt !== null &&
          Date.parse(request.data.expiresAt) <=
            Date.parse(request.data.decidedAt)) ||
          !(await validateSharedVisibility(
            transaction,
            actor.spaceId,
            request.data.visibility,
          )))
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      const base = {
        createdAt: request.data.decidedAt,
        decidedAt: request.data.decidedAt,
        id: dependencies.ids.next(),
        signalDraftId: stored.draft.id,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: request.data.decidedAt,
        version: 0,
      };
      const decision: ConsentDecision =
        request.data.decision === "share"
          ? ActiveShareConsentSchema.parse({
              ...base,
              expiresAt: request.data.expiresAt,
              outcome: "share",
              recordState: "active",
              revokedAt: null,
              visibility: request.data.visibility,
            })
          : DiscardedConsentSchema.parse({
              ...base,
              expiresAt: null,
              outcome: "discard",
              recordState: "discarded",
              revokedAt: null,
              visibility: null,
            });
      const result = DecideConsentResultSchema.parse({
        decision,
        status: "decision_recorded",
      });

      await transaction.insertConsentDecision(decision);
      return { result, status: "ready" as const };
    });

    if (mutation.status === "error") {
      return failure(
        dependencies,
        "DecideConsent",
        requestId,
        actor,
        mutation.code,
      );
    }

    log(dependencies, "DecideConsent", requestId, actor, "decision_recorded", [
      mutation.result.decision.id,
    ]);
    return { ok: true, result: mutation.result };
  } catch {
    return failure(
      dependencies,
      "DecideConsent",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const signalPurposeForKind = (
  kind: "potential_task" | "discussion_only" | "high_risk",
): SharedSignalPurpose => {
  switch (kind) {
    case "potential_task":
      return "responsibility";
    case "discussion_only":
      return "family_information";
    case "high_risk":
      return "care_information";
  }
};

const confirmationHash = (
  actor: MemberActor,
  request: ReturnType<typeof ConfirmSignalRequestSchema.parse>,
): RequestHash =>
  RequestHashSchema.parse(
    createHash("sha256")
      .update(
        JSON.stringify([
          actor.spaceId,
          actor.memberId,
          request.signalDraftId,
          request.consentDecisionId,
          request.expectedDraftVersion,
        ]),
      )
      .digest("hex"),
  );

const draftCanBePublished = (
  stored: Readonly<StoredSignalDraft>,
  privateInputs: readonly string[],
): boolean => {
  const candidate = {
    candidateDomainId: stored.draft.candidateDomainId,
    confidence: stored.draft.confidence,
    kind: stored.draft.kind,
    missingInfo: stored.draft.missingInfo,
    proposedConclusion: stored.draft.proposedConclusion,
    redactedExcerpt: stored.draft.redactedExcerpt,
  };

  return (
    (stored.draft.source === "human" ||
      isApplicationTemplateSignalDraftCandidate(candidate)) &&
    areProviderDerivedFieldsSafe(candidate, privateInputs)
  );
};

const confirmSignalWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<ConfirmSignalResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "ConfirmSignal",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = ConfirmSignalRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "ConfirmSignal",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const requestHash = confirmationHash(actor, request.data);
    const mutation = await dependencies.store.transaction(async (transaction) => {
      const validationNow = timestampNow(dependencies.clock);
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const existingConfirmation = await transaction.findSignalConfirmation(
        actor.spaceId,
        actor.memberId,
        request.data.idempotencyKey,
      );

      if (existingConfirmation !== undefined) {
        return existingConfirmation.requestHash === requestHash
          ? { result: existingConfirmation.result, status: "ready" as const }
          : {
              code: "idempotency_conflict" as const,
              status: "error" as const,
            };
      }

      const stored = await transaction.findStoredSignalDraft(
        actor.spaceId,
        request.data.signalDraftId,
      );

      if (stored?.draft.speakerId !== actor.memberId) {
        return { code: "not_found" as const, status: "error" as const };
      }

      if (stored.draft.version !== request.data.expectedDraftVersion) {
        return { code: "stale_version" as const, status: "error" as const };
      }

      const decision = await transaction.findConsentDecision(
        actor.spaceId,
        request.data.consentDecisionId,
      );

      if (decision === undefined) {
        return { code: "consent_required" as const, status: "error" as const };
      }

      if (
        decision.recordState !== "active" ||
        decision.signalDraftId !== stored.draft.id ||
        decision.speakerId !== actor.memberId ||
        (decision.expiresAt !== null &&
          Date.parse(decision.expiresAt) <= Date.parse(validationNow))
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      if (
        !(await validateSharedVisibility(
          transaction,
          actor.spaceId,
          decision.visibility,
        ))
      ) {
        return { code: "visibility_denied" as const, status: "error" as const };
      }

      const currentSources = await loadCurrentStoredDraftSources(
        transaction,
        actor,
        stored,
      );

      if (
        currentSources.status === "error" ||
        !sourceSnapshotsMatch(
          stored.sourceSnapshot,
          currentSources.value.snapshot,
        ) ||
        !draftCanBePublished(stored, currentSources.value.privateInputs)
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      if (
        (await transaction.findSignalForConsent(actor.spaceId, decision.id)) !==
        undefined
      ) {
        return { code: "conflict" as const, status: "error" as const };
      }

      const persistedAt = timestampNow(dependencies.clock);

      if (
        decision.expiresAt !== null &&
        Date.parse(decision.expiresAt) <= Date.parse(persistedAt)
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      const provenance: EvidenceProvenance[] = currentSources.value.evidence.map(
        (view) => ({
          evidenceId: view.evidence.id,
          occurredAt: view.evidence.occurredAt,
          sourceType: view.evidence.sourceType,
          speakerId: view.evidence.speakerId,
          state: "available",
        }),
      );
      const signal = SharedSignalSchema.parse({
        conclusion: stored.draft.proposedConclusion,
        consentDecisionId: decision.id,
        createdAt: persistedAt,
        evidenceState: "available",
        id: dependencies.ids.next(),
        provenance,
        purpose: signalPurposeForKind(stored.draft.kind),
        redactedExcerpt: stored.draft.redactedExcerpt,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: persistedAt,
        version: 0,
        visibility: decision.visibility,
      });
      const result = ConfirmSignalResultSchema.parse({
        signal,
        status: "confirmed",
      });

      await transaction.insertSharedSignal(signal);
      await transaction.saveSignalConfirmation(
        actor.spaceId,
        actor.memberId,
        request.data.idempotencyKey,
        { requestHash, result },
      );
      return { result, status: "ready" as const };
    });

    if (mutation.status === "error") {
      return failure(
        dependencies,
        "ConfirmSignal",
        requestId,
        actor,
        mutation.code,
      );
    }

    log(dependencies, "ConfirmSignal", requestId, actor, "confirmed", [
      mutation.result.signal.id,
      mutation.result.signal.consentDecisionId,
    ]);
    return { ok: true, result: mutation.result };
  } catch {
    return failure(
      dependencies,
      "ConfirmSignal",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const pageFromCursor = <Value>(
  values: readonly Value[],
  cursor: string | null,
  limit: number,
):
  | Readonly<{
      status: "ready";
      values: readonly Value[];
      page: Readonly<{ hasMore: boolean; nextCursor: string | null }>;
    }>
  | Readonly<{ status: "error" }> => {
  const match = cursor === null ? undefined : /^offset:(\d+)$/u.exec(cursor);

  if (cursor !== null && match === null) {
    return { status: "error" };
  }

  const offsetText = match?.[1] ?? "0";
  const offset = Number(offsetText);

  if (!Number.isSafeInteger(offset) || offset < 0 || offset > values.length) {
    return { status: "error" };
  }

  const pageValues = values.slice(offset, offset + limit);
  const nextOffset = offset + pageValues.length;
  const hasMore = nextOffset < values.length;

  return {
    page: {
      hasMore,
      nextCursor: hasMore ? `offset:${String(nextOffset)}` : null,
    },
    status: "ready",
    values: pageValues,
  };
};

const getPrivateConversationWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<GetPrivateConversationResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "GetPrivateConversation",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = GetPrivateConversationRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "GetPrivateConversation",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const query = await dependencies.store.transaction(async (transaction) => {
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const conversation = await transaction.findConversation(
        actor.spaceId,
        request.data.conversationId,
      );

      if (
        conversation?.type !== "agent_dm" ||
        !conversation.participantMemberIds.includes(actor.memberId)
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const messages = await transaction.listPrivateMessages(
        actor.spaceId,
        conversation.id,
      );

      if (
        messages.some(
          (message) =>
            message.authorId !== actor.memberId ||
            message.visibility.memberId !== actor.memberId,
        )
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const page = pageFromCursor(
        messages,
        request.data.page.cursor,
        request.data.page.limit,
      );

      if (page.status === "error") {
        return { code: "invalid_request" as const, status: "error" as const };
      }

      return {
        result: GetPrivateConversationResultSchema.parse({
          conversation: {
            conversation,
            messages: page.values,
            page: page.page,
          },
          status: "ready",
        }),
        status: "ready" as const,
      };
    });

    if (query.status === "error") {
      return failure(
        dependencies,
        "GetPrivateConversation",
        requestId,
        actor,
        query.code,
      );
    }

    log(dependencies, "GetPrivateConversation", requestId, actor, "ready");
    return { ok: true, result: query.result };
  } catch {
    return failure(
      dependencies,
      "GetPrivateConversation",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const getRawEvidenceWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<GetRawEvidenceResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "GetRawEvidence",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = GetRawEvidenceRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "GetRawEvidence",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const query = await dependencies.store.transaction(async (transaction) => {
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const view = await transaction.findEvidence(
        actor.spaceId,
        request.data.evidenceId,
      );

      if (
        view?.evidence.speakerId !== actor.memberId ||
        view.evidence.visibility.memberId !== actor.memberId ||
        view.evidence.state !== "available"
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      return {
        result: GetRawEvidenceResultSchema.parse({
          evidence: {
            evidence: view.evidence,
            rawContent: view.rawContent,
          },
          status: "ready",
        }),
        status: "ready" as const,
      };
    });

    if (query.status === "error") {
      return failure(
        dependencies,
        "GetRawEvidence",
        requestId,
        actor,
        query.code,
      );
    }

    log(dependencies, "GetRawEvidence", requestId, actor, "ready");
    return { ok: true, result: query.result };
  } catch {
    return failure(
      dependencies,
      "GetRawEvidence",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

const getVisibleSharedSignalsWithDependencies = async (
  dependencies: ResolvedDependencies,
  actorInput: unknown,
  requestInput: unknown,
): Promise<GetVisibleSharedSignalsResponse> => {
  const requestId = requestIdFromUnknown(requestInput, () => dependencies.ids.next());
  const actor = actorFromUnknown(actorInput);

  if (actor === undefined) {
    return failure(
      dependencies,
      "GetVisibleSharedSignals",
      requestId,
      undefined,
      "unauthenticated",
    );
  }

  const request = GetVisibleSharedSignalsRequestSchema.safeParse(requestInput);

  if (!request.success) {
    return failure(
      dependencies,
      "GetVisibleSharedSignals",
      requestId,
      actor,
      "invalid_request",
    );
  }

  if (request.data.spaceId !== actor.spaceId) {
    return failure(
      dependencies,
      "GetVisibleSharedSignals",
      requestId,
      actor,
      "not_found",
    );
  }

  try {
    const query = await dependencies.store.transaction(async (transaction) => {
      const authorization = await authorizeMember(transaction, actor, false);

      if (authorization.status === "error") {
        return authorization;
      }

      const signals = (await transaction.listSharedSignals(actor.spaceId)).filter(
        (signal) =>
          isSharedVisibilityReadableBy(signal.visibility, actor.memberId),
      );
      const page = pageFromCursor(
        signals,
        request.data.page.cursor,
        request.data.page.limit,
      );

      if (page.status === "error") {
        return { code: "invalid_request" as const, status: "error" as const };
      }

      return {
        result: GetVisibleSharedSignalsResultSchema.parse({
          page: page.page,
          signals: page.values,
          status: "ready",
        }),
        status: "ready" as const,
      };
    });

    if (query.status === "error") {
      return failure(
        dependencies,
        "GetVisibleSharedSignals",
        requestId,
        actor,
        query.code,
      );
    }

    log(dependencies, "GetVisibleSharedSignals", requestId, actor, "ready");
    return { ok: true, result: query.result };
  } catch {
    return failure(
      dependencies,
      "GetVisibleSharedSignals",
      requestId,
      actor,
      "internal_failure",
    );
  }
};

export interface ConversationHandlers {
  CreatePrivateMessage(
    actor: unknown,
    request: unknown,
  ): Promise<CreatePrivateMessageResponse>;
  CreateSignalDraft(
    actor: unknown,
    request: unknown,
  ): Promise<CreateSignalDraftResponse>;
  DecideConsent(
    actor: unknown,
    request: unknown,
  ): Promise<DecideConsentResponse>;
  ConfirmSignal(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmSignalResponse>;
  GetPrivateConversation(
    actor: unknown,
    request: unknown,
  ): Promise<GetPrivateConversationResponse>;
  GetRawEvidence(
    actor: unknown,
    request: unknown,
  ): Promise<GetRawEvidenceResponse>;
  GetVisibleSharedSignals(
    actor: unknown,
    request: unknown,
  ): Promise<GetVisibleSharedSignalsResponse>;
}

export const createConversationHandlers = (
  options: Readonly<ConversationHandlerOptions>,
): ConversationHandlers => {
  const dependencies = resolveDependencies(options);

  return Object.freeze({
    ConfirmSignal: (actor: unknown, request: unknown) =>
      confirmSignalWithDependencies(dependencies, actor, request),
    CreatePrivateMessage: (actor: unknown, request: unknown) =>
      createPrivateMessageWithDependencies(dependencies, actor, request),
    CreateSignalDraft: (actor: unknown, request: unknown) =>
      createSignalDraftWithDependencies(dependencies, actor, request),
    DecideConsent: (actor: unknown, request: unknown) =>
      decideConsentWithDependencies(dependencies, actor, request),
    GetPrivateConversation: (actor: unknown, request: unknown) =>
      getPrivateConversationWithDependencies(dependencies, actor, request),
    GetRawEvidence: (actor: unknown, request: unknown) =>
      getRawEvidenceWithDependencies(dependencies, actor, request),
    GetVisibleSharedSignals: (actor: unknown, request: unknown) =>
      getVisibleSharedSignalsWithDependencies(dependencies, actor, request),
  });
};

export const createPrivateMessage = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<CreatePrivateMessageResponse> =>
  createPrivateMessageWithDependencies(resolveDependencies(options), actor, request);

export const createSignalDraft = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<CreateSignalDraftResponse> =>
  createSignalDraftWithDependencies(resolveDependencies(options), actor, request);

export const decideConsent = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<DecideConsentResponse> =>
  decideConsentWithDependencies(resolveDependencies(options), actor, request);

export const confirmSignal = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<ConfirmSignalResponse> =>
  confirmSignalWithDependencies(resolveDependencies(options), actor, request);

export const getPrivateConversation = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<GetPrivateConversationResponse> =>
  getPrivateConversationWithDependencies(
    resolveDependencies(options),
    actor,
    request,
  );

export const getRawEvidence = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<GetRawEvidenceResponse> =>
  getRawEvidenceWithDependencies(resolveDependencies(options), actor, request);

export const getVisibleSharedSignals = (
  options: Readonly<ConversationHandlerOptions>,
  actor: unknown,
  request: unknown,
): Promise<GetVisibleSharedSignalsResponse> =>
  getVisibleSharedSignalsWithDependencies(
    resolveDependencies(options),
    actor,
    request,
  );

export const CreatePrivateMessage = createPrivateMessage;
export const CreateSignalDraft = createSignalDraft;
export const DecideConsent = decideConsent;
export const ConfirmSignal = confirmSignal;
export const GetPrivateConversation = getPrivateConversation;
export const GetRawEvidence = getRawEvidence;
export const GetVisibleSharedSignals = getVisibleSharedSignals;
