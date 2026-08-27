import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AIExecutionMetadataSchema,
  ConsentDecisionSchema,
  ContractErrorSchema,
  CreatePrivateMessageRequestSchema,
  CreatePrivateMessageResultSchema,
  CreateSignalDraftRequestSchema,
  CreateSignalDraftResultSchema,
  DecideConsentRequestSchema,
  DecideConsentResultSchema,
  EntityIdSchema,
  EvidenceSchema,
  GetPrivateConversationRequestSchema,
  GetPrivateConversationResultSchema,
  GetVisibleSharedSignalsRequestSchema,
  GetVisibleSharedSignalsResultSchema,
  MemberActorSchema,
  PrivateMessageSchema,
  RawEvidenceViewSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  TimestampSchema,
  ConfirmSignalRequestSchema,
  ConfirmSignalResultSchema,
  type AnyContractError,
  type Clock,
  type ContractErrorCode,
  type CreatePrivateMessageResult,
  type CreateSignalDraftResult,
  type DecideConsentResult,
  type EntityId,
  type GetPrivateConversationResult,
  type GetVisibleSharedSignalsResult,
  type MemberActor,
  type PrivateMessage,
  type RequestId,
  type SharedSignal,
  type SharedSignalPurpose,
  type SignalDraft,
  type TransportResult,
  type ConfirmSignalResult,
} from "../../../packages/contracts/src/index";
import type {
  RenderedSignalDraftFields,
  SignalDraftWitness,
} from "../../ai-witness/index";
import {
  detectHighRiskCategories,
  inspectPrivateDisclosure,
} from "../../boundary/index";

import {
  authorizeConfirmation,
  authorizeConsentDecision,
  authorizeDraftSource,
  authorizeMessageCreation,
  canReadSharedVisibility,
  confirmationStateIsUnchanged,
  draftSourceIsUnchanged,
  type ConversationDenialCode,
} from "./authorization";
import {
  isConversationRepositoryError,
  type ConfirmationState,
  type ConversationRepository,
  type DraftSourceLookup,
  type DraftSourceState,
} from "./persistence";

const FALLBACK_REQUEST_ID = "00000000-0000-4000-8000-000000000000";
const HIGH_RISK_REDACTED_EXCERPT = "Safety-sensitive content withheld.";
const HIGH_RISK_CONCLUSION =
  "Use non-diagnostic safety guidance and contact appropriate professional or emergency resources.";

export const GetRawEvidenceRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  evidenceId: EntityIdSchema,
});
export type GetRawEvidenceRequest = z.infer<typeof GetRawEvidenceRequestSchema>;

export const GetRawEvidenceResultSchema = z.strictObject({
  status: z.literal("ready"),
  evidence: RawEvidenceViewSchema,
});
export type GetRawEvidenceResult = z.infer<typeof GetRawEvidenceResultSchema>;

export type ConversationOperationResult<Result> = TransportResult<
  Result,
  AnyContractError
>;

export type ConversationOperationName =
  | "ConfirmSignal"
  | "CreatePrivateMessage"
  | "CreateSignalDraft"
  | "DecideConsent"
  | "GetPrivateConversation"
  | "GetRawEvidence"
  | "GetVisibleSharedSignals";

export type ConversationTelemetryOutcome =
  | "confirmed"
  | "created"
  | "denied"
  | "high_risk"
  | "internal_failure"
  | "needs_human_review"
  | "ready";

export interface ConversationTelemetryEvent {
  readonly operation: ConversationOperationName;
  readonly requestId: RequestId;
  readonly outcome: ConversationTelemetryOutcome;
  readonly entityIds?: readonly EntityId[];
  readonly attempts?: 1 | 2;
  readonly count?: number;
}

export interface ConversationTelemetrySink {
  record(event: ConversationTelemetryEvent): Promise<void> | void;
}

export interface ConversationServiceDependencies {
  readonly repository: ConversationRepository;
  readonly witness: SignalDraftWitness;
  readonly clock: Clock;
  readonly generateId?: () => string;
  readonly telemetry?: ConversationTelemetrySink;
}

export interface ConversationService {
  createPrivateMessage(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<CreatePrivateMessageResult>>;
  createSignalDraft(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<CreateSignalDraftResult>>;
  decideConsent(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<DecideConsentResult>>;
  confirmSignal(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<ConfirmSignalResult>>;
  getPrivateConversation(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<GetPrivateConversationResult>>;
  getRawEvidence(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<GetRawEvidenceResult>>;
  getVisibleSharedSignals(
    actor: unknown,
    request: unknown,
  ): Promise<ConversationOperationResult<GetVisibleSharedSignalsResult>>;
}

type ServiceErrorCode = Extract<
  ContractErrorCode,
  | "conflict"
  | "consent_invalid"
  | "consent_required"
  | "forbidden"
  | "idempotency_conflict"
  | "internal_failure"
  | "invalid_request"
  | "not_found"
  | "stale_version"
  | "unauthenticated"
  | "visibility_denied"
>;

const SAFE_ERROR_MESSAGES: Readonly<Record<ServiceErrorCode, string>> = {
  conflict: "The requested conversation state has changed.",
  consent_invalid: "The signal consent is not valid for this operation.",
  consent_required: "An active per-signal share decision is required.",
  forbidden: "The actor is not allowed to perform this operation.",
  idempotency_conflict: "The idempotency key belongs to a different request.",
  internal_failure: "The conversation operation failed.",
  invalid_request: "The conversation request is invalid.",
  not_found: "The requested conversation record was not found.",
  stale_version: "The requested conversation version is stale.",
  unauthenticated: "A valid authenticated member actor is required.",
  visibility_denied: "The selected visibility is not currently authorized.",
};

const requestIdFromUnknown = (request: unknown): RequestId => {
  if (request === null || typeof request !== "object") {
    return FALLBACK_REQUEST_ID;
  }
  const descriptor = Object.getOwnPropertyDescriptor(request, "requestId");
  if (descriptor === undefined || !("value" in descriptor)) {
    return FALLBACK_REQUEST_ID;
  }
  const parsed = RequestIdSchema.safeParse(descriptor.value);
  return parsed.success ? parsed.data : FALLBACK_REQUEST_ID;
};

const serviceError = (
  code: ServiceErrorCode,
  requestId: RequestId,
): AnyContractError =>
  ContractErrorSchema.parse({
    code,
    message: SAFE_ERROR_MESSAGES[code],
    requestId,
    retryable: code === "internal_failure",
  });

const failure = <Result>(
  code: ServiceErrorCode,
  requestId: RequestId,
): ConversationOperationResult<Result> => ({
  error: serviceError(code, requestId),
  ok: false,
});

const success = <Result>(result: Result): ConversationOperationResult<Result> => ({
  ok: true,
  result,
});

const parseMemberActor = (actor: unknown): MemberActor | undefined => {
  const parsed = MemberActorSchema.safeParse(actor);
  return parsed.success ? parsed.data : undefined;
};

const timestampFromClock = (clock: Clock): string => {
  const value = clock.now();
  return TimestampSchema.parse(value.toISOString());
};

const mapDenial = (code: ConversationDenialCode): ServiceErrorCode => code;

const emitTelemetry = (
  sink: ConversationTelemetrySink | undefined,
  event: ConversationTelemetryEvent,
): void => {
  if (sink === undefined) {
    return;
  }
  try {
    void Promise.resolve(sink.record(event)).catch(() => undefined);
  } catch {
    // Diagnostics are non-consequential and must never expose caught errors.
  }
};

const paginationOffset = (cursor: string | null): number | undefined => {
  if (cursor === null) {
    return 0;
  }
  const match = /^offset:(0|[1-9]\d*)$/u.exec(cursor);
  if (match === null) {
    return undefined;
  }
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) ? offset : undefined;
};

const paginate = <Item>(
  items: readonly Item[],
  offset: number,
  limit: number,
): Readonly<{
  items: readonly Item[];
  page: { nextCursor: string | null; hasMore: boolean };
}> => {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < items.length;
  return {
    items: pageItems,
    page: {
      hasMore,
      nextCursor: hasMore ? `offset:${String(nextOffset)}` : null,
    },
  };
};

const privateValues = (state: DraftSourceState): readonly string[] => [
  state.message.content,
  ...state.evidence.map((record) => record.rawContent),
];

const draftLookup = (
  actor: MemberActor,
  request: z.output<typeof CreateSignalDraftRequestSchema>,
): DraftSourceLookup => ({
  actorMemberId: actor.memberId,
  evidenceIds: request.evidenceIds,
  privateMessageId: request.privateMessageId,
  spaceId: actor.spaceId,
});

const sourceLookupWithConversation = (
  lookup: DraftSourceLookup,
  source: DraftSourceState,
): DraftSourceLookup => ({ ...lookup, conversationId: source.conversation.id });

const sharedPurpose = (draft: SignalDraft): SharedSignalPurpose => {
  switch (draft.kind) {
    case "potential_task":
      return "responsibility";
    case "discussion_only":
      return "family_information";
    case "high_risk":
      return "care_information";
  }
};

const requestHash = (
  actor: MemberActor,
  request: z.output<typeof ConfirmSignalRequestSchema>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        actor.spaceId,
        actor.memberId,
        request.signalDraftId,
        request.consentDecisionId,
        request.expectedDraftVersion,
      ]),
      "utf8",
    )
    .digest("hex");

const makeSharedSignal = (
  state: ConfirmationState,
  signalId: EntityId,
  authoritativeNow: string,
): SharedSignal | undefined => {
  if (state.consent.recordState !== "active") {
    return undefined;
  }

  const parsed = SharedSignalSchema.safeParse({
    consentDecisionId: state.consent.id,
    conclusion: state.draft.proposedConclusion,
    createdAt: authoritativeNow,
    evidenceState: "available",
    id: signalId,
    provenance: state.evidence.map(({ evidence }) => ({
      evidenceId: evidence.id,
      occurredAt: evidence.occurredAt,
      sourceType: evidence.sourceType,
      speakerId: evidence.speakerId,
      state: evidence.state,
    })),
    purpose: sharedPurpose(state.draft),
    redactedExcerpt: state.draft.redactedExcerpt,
    spaceId: state.space.id,
    speakerId: state.draft.speakerId,
    updatedAt: authoritativeNow,
    version: 0,
    visibility: state.consent.visibility,
  });
  return parsed.success ? parsed.data : undefined;
};

const unexpectedFailureCode = (error: unknown): ServiceErrorCode =>
  isConversationRepositoryError(error) && error.code === "conflict"
    ? "conflict"
    : "internal_failure";

export const createConversationService = (
  dependencies: ConversationServiceDependencies,
): ConversationService => {
  const generateEntityId = (): EntityId =>
    EntityIdSchema.parse((dependencies.generateId ?? randomUUID)());

  const createPrivateMessage: ConversationService["createPrivateMessage"] =
    async (actorInput, requestInput) => {
      const requestId = requestIdFromUnknown(requestInput);
      const actor = parseMemberActor(actorInput);
      if (actor === undefined) {
        return failure("unauthenticated", requestId);
      }
      const parsedRequest = CreatePrivateMessageRequestSchema.safeParse(requestInput);
      if (!parsedRequest.success) {
        return failure("invalid_request", requestId);
      }

      try {
        const outcome = await dependencies.repository.transaction(async (tx) => {
          const state = await tx.loadMessageCreationState({
            actorMemberId: actor.memberId,
            conversationId: parsedRequest.data.conversationId,
            spaceId: actor.spaceId,
          });
          const denial = authorizeMessageCreation(actor, state);
          if (denial !== undefined) {
            return { code: denial, status: "denied" as const };
          }

          const now = timestampFromClock(dependencies.clock);
          const parsedMessage = PrivateMessageSchema.safeParse({
            authorId: actor.memberId,
            clientMessageId: parsedRequest.data.clientMessageId,
            content: parsedRequest.data.content,
            conversationId: parsedRequest.data.conversationId,
            createdAt: now,
            id: generateEntityId(),
            occurredAt: parsedRequest.data.occurredAt,
            spaceId: actor.spaceId,
            updatedAt: now,
            version: 0,
            visibility: { kind: "self", memberId: actor.memberId },
          });
          if (!parsedMessage.success) {
            throw new Error("Private message assembly failed.");
          }
          const evidenceId = generateEntityId();
          const parsedEvidence = EvidenceSchema.safeParse({
            createdAt: now,
            id: evidenceId,
            occurredAt: parsedRequest.data.occurredAt,
            rawRef: `private-message:${parsedMessage.data.id}`,
            sourceType: "agent_dm",
            spaceId: actor.spaceId,
            speakerId: actor.memberId,
            state: "available",
            updatedAt: now,
            version: 0,
            visibility: { kind: "self", memberId: actor.memberId },
          });
          if (!parsedEvidence.success) {
            throw new Error("Private evidence assembly failed.");
          }
          await tx.insertPrivateMessage(parsedMessage.data);
          await tx.insertPrivateEvidence({
            evidence: parsedEvidence.data,
            rawContent: parsedRequest.data.content,
            sourceMessageId: parsedMessage.data.id,
          });
          return { message: parsedMessage.data, status: "created" as const };
        });

        if (outcome.status === "denied") {
          emitTelemetry(dependencies.telemetry, {
            operation: "CreatePrivateMessage",
            outcome: "denied",
            requestId,
          });
          return failure(mapDenial(outcome.code), requestId);
        }

        const result = CreatePrivateMessageResultSchema.parse({
          message: outcome.message,
          status: "created",
        });
        emitTelemetry(dependencies.telemetry, {
          entityIds: [result.message.id],
          operation: "CreatePrivateMessage",
          outcome: "created",
          requestId,
        });
        return success(result);
      } catch (error) {
        emitTelemetry(dependencies.telemetry, {
          operation: "CreatePrivateMessage",
          outcome: "internal_failure",
          requestId,
        });
        return failure(unexpectedFailureCode(error), requestId);
      }
    };

  const createSignalDraft: ConversationService["createSignalDraft"] = async (
    actorInput,
    requestInput,
  ) => {
    const requestId = requestIdFromUnknown(requestInput);
    const actor = parseMemberActor(actorInput);
    if (actor === undefined) {
      return failure("unauthenticated", requestId);
    }
    const parsedRequest = CreateSignalDraftRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return failure("invalid_request", requestId);
    }
    if (
      new Set(parsedRequest.data.evidenceIds).size !==
      parsedRequest.data.evidenceIds.length
    ) {
      return failure("invalid_request", requestId);
    }

    try {
      const provisionalLookup = draftLookup(actor, parsedRequest.data);
      const discoveredSource = await dependencies.repository.loadDraftSource(
        provisionalLookup,
      );
      if (discoveredSource === undefined) {
        return failure("not_found", requestId);
      }
      const lookup = sourceLookupWithConversation(
        provisionalLookup,
        discoveredSource,
      );
      const initial = await dependencies.repository.loadDraftSource(lookup);
      const initialDenial = authorizeDraftSource(
        actor,
        initial,
        parsedRequest.data.evidenceIds,
      );
      if (initialDenial !== undefined || initial === undefined) {
        emitTelemetry(dependencies.telemetry, {
          operation: "CreateSignalDraft",
          outcome: "denied",
          requestId,
        });
        return failure(mapDenial(initialDenial ?? "not_found"), requestId);
      }

      const sourcePrivateValues = privateValues(initial);
      const highRiskCategories = detectHighRiskCategories(sourcePrivateValues);
      let fields: RenderedSignalDraftFields | undefined;
      let source: SignalDraft["source"] = "validated_ai";
      let metadata;

      if (highRiskCategories.length > 0) {
        fields = {
          candidateDomainId: null,
          confidence: 1,
          kind: "discussion_only",
          missingInfo: highRiskCategories.map(
            (category) => `Safety category: ${category}`,
          ),
          proposedConclusion: HIGH_RISK_CONCLUSION,
          redactedExcerpt: HIGH_RISK_REDACTED_EXCERPT,
        };
        source = "fixture";
        metadata = AIExecutionMetadataSchema.parse({
          attempts: 1,
          contentLogged: false,
          inputTokens: 0,
          latencyMs: 0,
          outputTokens: 0,
          promptVersion: parsedRequest.data.promptVersion,
          providerOutcome: "fixture",
          purpose: "signal_draft",
          requestId,
        });
      } else {
        const witnessResult = await dependencies.witness.draft({
          privateValues: sourcePrivateValues,
          promptVersion: parsedRequest.data.promptVersion,
          requestId,
        });
        if (witnessResult.status === "needs_human_review") {
          emitTelemetry(dependencies.telemetry, {
            attempts: 2,
            operation: "CreateSignalDraft",
            outcome: "needs_human_review",
            requestId,
          });
          return success(witnessResult);
        }
        fields = witnessResult.fields;
        metadata = witnessResult.metadata;
      }

      const outcome = await dependencies.repository.transaction(async (tx) => {
        const current = await tx.loadDraftSource(lookup);
        const denial = authorizeDraftSource(
          actor,
          current,
          parsedRequest.data.evidenceIds,
        );
        if (denial !== undefined || current === undefined) {
          return { code: denial ?? "not_found", status: "denied" as const };
        }
        if (!draftSourceIsUnchanged(initial, current)) {
          return { code: "conflict" as const, status: "denied" as const };
        }

        const now = timestampFromClock(dependencies.clock);
        const draftKind =
          highRiskCategories.length > 0 ? "high_risk" : fields.kind;
        const parsedDraft = SignalDraftSchema.safeParse({
          ...fields,
          createdAt: now,
          evidenceIds: parsedRequest.data.evidenceIds,
          id: generateEntityId(),
          kind: draftKind,
          promptVersion: parsedRequest.data.promptVersion,
          source,
          sourceMessageId: parsedRequest.data.privateMessageId,
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          updatedAt: now,
          version: 0,
        });
        if (!parsedDraft.success) {
          throw new Error("Signal draft assembly failed.");
        }
        if (
          !inspectPrivateDisclosure(
            parsedDraft.data,
            privateValues(current),
          ).safe
        ) {
          throw new Error("Signal draft disclosure boundary failed.");
        }
        await tx.insertSignalDraft(parsedDraft.data);
        return { draft: parsedDraft.data, status: "created" as const };
      });

      if (outcome.status === "denied") {
        emitTelemetry(dependencies.telemetry, {
          operation: "CreateSignalDraft",
          outcome: "denied",
          requestId,
        });
        return failure(outcome.code, requestId);
      }

      const result = CreateSignalDraftResultSchema.parse({
        draft: outcome.draft,
        metadata,
        status: "draft_created",
      });
      emitTelemetry(dependencies.telemetry, {
        attempts: metadata.attempts,
        entityIds: [outcome.draft.id],
        operation: "CreateSignalDraft",
        outcome: highRiskCategories.length > 0 ? "high_risk" : "created",
        requestId,
      });
      return success(result);
    } catch (error) {
      emitTelemetry(dependencies.telemetry, {
        operation: "CreateSignalDraft",
        outcome: "internal_failure",
        requestId,
      });
      return failure(unexpectedFailureCode(error), requestId);
    }
  };

  const decideConsent: ConversationService["decideConsent"] = async (
    actorInput,
    requestInput,
  ) => {
    const requestId = requestIdFromUnknown(requestInput);
    const actor = parseMemberActor(actorInput);
    if (actor === undefined) {
      return failure("unauthenticated", requestId);
    }
    const parsedRequest = DecideConsentRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return failure("invalid_request", requestId);
    }
    if (
      parsedRequest.data.expiresAt !== null &&
      Date.parse(parsedRequest.data.expiresAt) <=
        Date.parse(parsedRequest.data.decidedAt)
    ) {
      return failure("consent_invalid", requestId);
    }

    try {
      const outcome = await dependencies.repository.transaction(async (tx) => {
        const now = timestampFromClock(dependencies.clock);
        const state = await tx.loadConsentAuthorizationState({
          actorMemberId: actor.memberId,
          signalDraftId: parsedRequest.data.signalDraftId,
          spaceId: actor.spaceId,
          visibility: parsedRequest.data.visibility,
        });
        const denial = authorizeConsentDecision(
          actor,
          state,
          parsedRequest.data.visibility,
          now,
          parsedRequest.data.decidedAt,
          parsedRequest.data.expiresAt,
        );
        if (denial !== undefined) {
          return { code: denial, status: "denied" as const };
        }

        const common = {
          createdAt: now,
          decidedAt: parsedRequest.data.decidedAt,
          id: generateEntityId(),
          signalDraftId: parsedRequest.data.signalDraftId,
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          updatedAt: now,
          version: 0,
        };
        const decisionInput =
          parsedRequest.data.decision === "share"
            ? {
                ...common,
                expiresAt: parsedRequest.data.expiresAt,
                outcome: "share" as const,
                recordState: "active" as const,
                revokedAt: null,
                visibility: parsedRequest.data.visibility,
              }
            : {
                ...common,
                expiresAt: null,
                outcome: "discard" as const,
                recordState: "discarded" as const,
                revokedAt: null,
                visibility: null,
              };
        const parsedDecision = ConsentDecisionSchema.safeParse(decisionInput);
        if (!parsedDecision.success) {
          throw new Error("Consent decision assembly failed.");
        }
        await tx.insertConsentDecision(parsedDecision.data);
        return { decision: parsedDecision.data, status: "recorded" as const };
      });

      if (outcome.status === "denied") {
        emitTelemetry(dependencies.telemetry, {
          operation: "DecideConsent",
          outcome: "denied",
          requestId,
        });
        return failure(mapDenial(outcome.code), requestId);
      }

      const result = DecideConsentResultSchema.parse({
        decision: outcome.decision,
        status: "decision_recorded",
      });
      emitTelemetry(dependencies.telemetry, {
        entityIds: [result.decision.id],
        operation: "DecideConsent",
        outcome: "created",
        requestId,
      });
      return success(result);
    } catch (error) {
      emitTelemetry(dependencies.telemetry, {
        operation: "DecideConsent",
        outcome: "internal_failure",
        requestId,
      });
      return failure(unexpectedFailureCode(error), requestId);
    }
  };

  const confirmSignal: ConversationService["confirmSignal"] = async (
    actorInput,
    requestInput,
  ) => {
    const requestId = requestIdFromUnknown(requestInput);
    const actor = parseMemberActor(actorInput);
    if (actor === undefined) {
      return failure("unauthenticated", requestId);
    }
    const parsedRequest = ConfirmSignalRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return failure("invalid_request", requestId);
    }

    try {
      const outcome = await dependencies.repository.transaction(async (tx) => {
        // This must remain the first authoritative read after transaction entry.
        const authoritativeNow = timestampFromClock(dependencies.clock);
        const lookup = {
          actorMemberId: actor.memberId,
          consentDecisionId: parsedRequest.data.consentDecisionId,
          signalDraftId: parsedRequest.data.signalDraftId,
          spaceId: actor.spaceId,
        };
        await tx.lockConfirmationState(lookup);
        const initial = await tx.loadConfirmationState(lookup);
        const initialDenial = authorizeConfirmation(
          actor,
          initial,
          parsedRequest.data.expectedDraftVersion,
          authoritativeNow,
        );
        if (initialDenial !== undefined || initial === undefined) {
          return {
            code: initialDenial ?? "not_found",
            status: "denied" as const,
          };
        }

        const signal = makeSharedSignal(
          initial,
          generateEntityId(),
          authoritativeNow,
        );
        if (
          signal === undefined ||
          !inspectPrivateDisclosure(
            signal,
            [
              initial.sourceMessage.content,
              ...initial.evidence.map((record) => record.rawContent),
            ],
          ).safe
        ) {
          return { code: "consent_invalid" as const, status: "denied" as const };
        }

        // Immediate pre-persist reread of every locked authorization fact.
        const current = await tx.loadConfirmationState(lookup);
        const persistenceNow = timestampFromClock(dependencies.clock);
        const currentDenial = authorizeConfirmation(
          actor,
          current,
          parsedRequest.data.expectedDraftVersion,
          persistenceNow,
        );
        if (currentDenial !== undefined || current === undefined) {
          return {
            code: currentDenial ?? "not_found",
            status: "denied" as const,
          };
        }
        if (!confirmationStateIsUnchanged(initial, current)) {
          return { code: "stale_version" as const, status: "denied" as const };
        }

        const write = await tx.insertSharedSignal({
          actorMemberId: actor.memberId,
          idempotencyKey: parsedRequest.data.idempotencyKey,
          requestHash: requestHash(actor, parsedRequest.data),
          signal,
          signalDraftId: parsedRequest.data.signalDraftId,
        });
        return write.status === "conflict"
          ? {
              code: "idempotency_conflict" as const,
              status: "denied" as const,
            }
          : { signal: write.signal, status: "confirmed" as const };
      });

      if (outcome.status === "denied") {
        emitTelemetry(dependencies.telemetry, {
          operation: "ConfirmSignal",
          outcome: "denied",
          requestId,
        });
        return failure(outcome.code, requestId);
      }

      const result = ConfirmSignalResultSchema.parse({
        signal: outcome.signal,
        status: "confirmed",
      });
      emitTelemetry(dependencies.telemetry, {
        entityIds: [result.signal.id],
        operation: "ConfirmSignal",
        outcome: "confirmed",
        requestId,
      });
      return success(result);
    } catch (error) {
      emitTelemetry(dependencies.telemetry, {
        operation: "ConfirmSignal",
        outcome: "internal_failure",
        requestId,
      });
      return failure(unexpectedFailureCode(error), requestId);
    }
  };

  const getPrivateConversation: ConversationService["getPrivateConversation"] =
    async (actorInput, requestInput) => {
      const requestId = requestIdFromUnknown(requestInput);
      const actor = parseMemberActor(actorInput);
      if (actor === undefined) {
        return failure("unauthenticated", requestId);
      }
      const parsedRequest = GetPrivateConversationRequestSchema.safeParse(requestInput);
      if (!parsedRequest.success) {
        return failure("invalid_request", requestId);
      }
      const offset = paginationOffset(parsedRequest.data.page.cursor);
      if (offset === undefined) {
        return failure("invalid_request", requestId);
      }

      try {
        const state = await dependencies.repository.loadPrivateConversationState({
          actorMemberId: actor.memberId,
          conversationId: parsedRequest.data.conversationId,
          spaceId: actor.spaceId,
        });
        const denial = authorizeMessageCreation(actor, state);
        if (denial !== undefined || state === undefined) {
          return failure(mapDenial(denial ?? "not_found"), requestId);
        }
        const authorizedMessages = state.messages
          .filter(
            (message): message is PrivateMessage =>
              message.spaceId === actor.spaceId &&
              message.authorId === actor.memberId &&
              message.visibility.memberId === actor.memberId,
          )
          .toSorted((left, right) =>
            left.occurredAt === right.occurredAt
              ? left.id.localeCompare(right.id)
              : left.occurredAt.localeCompare(right.occurredAt),
          );
        const page = paginate(
          authorizedMessages,
          offset,
          parsedRequest.data.page.limit,
        );
        const result = GetPrivateConversationResultSchema.parse({
          conversation: {
            conversation: state.conversation,
            messages: page.items,
            page: page.page,
          },
          status: "ready",
        });
        emitTelemetry(dependencies.telemetry, {
          count: page.items.length,
          operation: "GetPrivateConversation",
          outcome: "ready",
          requestId,
        });
        return success(result);
      } catch {
        emitTelemetry(dependencies.telemetry, {
          operation: "GetPrivateConversation",
          outcome: "internal_failure",
          requestId,
        });
        return failure("internal_failure", requestId);
      }
    };

  const getRawEvidence: ConversationService["getRawEvidence"] = async (
    actorInput,
    requestInput,
  ) => {
    const requestId = requestIdFromUnknown(requestInput);
    const actor = parseMemberActor(actorInput);
    if (actor === undefined) {
      return failure("unauthenticated", requestId);
    }
    const parsedRequest = GetRawEvidenceRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success) {
      return failure("invalid_request", requestId);
    }

    try {
      const state = await dependencies.repository.loadPrivateEvidenceState(
        actor.spaceId,
        actor.memberId,
        parsedRequest.data.evidenceId,
      );
      if (state === undefined) {
        return failure("not_found", requestId);
      }
      if (
        state.space.status !== "active" ||
        state.actorMember.id !== actor.memberId ||
        state.actorMember.spaceId !== actor.spaceId ||
        state.actorMember.role !== actor.role ||
        state.actorMember.status !== "active" ||
        state.record.evidence.spaceId !== actor.spaceId ||
        state.record.evidence.speakerId !== actor.memberId ||
        state.record.evidence.visibility.memberId !== actor.memberId ||
        state.record.evidence.state !== "available"
      ) {
        return failure("not_found", requestId);
      }
      const result = GetRawEvidenceResultSchema.parse({
        evidence: {
          evidence: state.record.evidence,
          rawContent: state.record.rawContent,
        },
        status: "ready",
      });
      emitTelemetry(dependencies.telemetry, {
        entityIds: [state.record.evidence.id],
        operation: "GetRawEvidence",
        outcome: "ready",
        requestId,
      });
      return success(result);
    } catch {
      emitTelemetry(dependencies.telemetry, {
        operation: "GetRawEvidence",
        outcome: "internal_failure",
        requestId,
      });
      return failure("internal_failure", requestId);
    }
  };

  const getVisibleSharedSignals: ConversationService["getVisibleSharedSignals"] =
    async (actorInput, requestInput) => {
      const requestId = requestIdFromUnknown(requestInput);
      const actor = parseMemberActor(actorInput);
      if (actor === undefined) {
        return failure("unauthenticated", requestId);
      }
      const parsedRequest = GetVisibleSharedSignalsRequestSchema.safeParse(
        requestInput,
      );
      if (!parsedRequest.success) {
        return failure("invalid_request", requestId);
      }
      const offset = paginationOffset(parsedRequest.data.page.cursor);
      if (offset === undefined || parsedRequest.data.spaceId !== actor.spaceId) {
        return failure("not_found", requestId);
      }

      try {
        const state = await dependencies.repository.loadSharedSignalListState(
          actor.spaceId,
          actor.memberId,
        );
        if (state === undefined) {
          return failure("not_found", requestId);
        }
        if (
          state.space.status !== "active" ||
          state.actorMember.id !== actor.memberId ||
          state.actorMember.role !== actor.role ||
          state.actorMember.status !== "active"
        ) {
          return failure("not_found", requestId);
        }
        const visibleSignals = state.signals
          .filter(
            (signal) =>
              signal.spaceId === actor.spaceId &&
              canReadSharedVisibility(actor.memberId, signal.visibility),
          )
          .toSorted((left, right) =>
            left.createdAt === right.createdAt
              ? left.id.localeCompare(right.id)
              : left.createdAt.localeCompare(right.createdAt),
          );
        const page = paginate(
          visibleSignals,
          offset,
          parsedRequest.data.page.limit,
        );
        const result = GetVisibleSharedSignalsResultSchema.parse({
          page: page.page,
          signals: page.items,
          status: "ready",
        });
        emitTelemetry(dependencies.telemetry, {
          count: page.items.length,
          operation: "GetVisibleSharedSignals",
          outcome: "ready",
          requestId,
        });
        return success(result);
      } catch {
        emitTelemetry(dependencies.telemetry, {
          operation: "GetVisibleSharedSignals",
          outcome: "internal_failure",
          requestId,
        });
        return failure("internal_failure", requestId);
      }
    };

  return Object.freeze({
    confirmSignal,
    createPrivateMessage,
    createSignalDraft,
    decideConsent,
    getPrivateConversation,
    getRawEvidence,
    getVisibleSharedSignals,
  });
};
