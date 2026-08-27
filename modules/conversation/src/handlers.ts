import { createHash } from "node:crypto";

import {
  ActiveShareConsentSchema,
  AIExecutionMetadataSchema,
  ConfirmSignalRequestSchema,
  ConfirmSignalResultSchema,
  CreatePrivateMessageRequestSchema,
  CreatePrivateMessageResultSchema,
  CreateSignalDraftRequestSchema,
  CreateSignalDraftResultSchema,
  DecideConsentRequestSchema,
  DecideConsentResultSchema,
  DiscardedConsentSchema,
  MemberActorSchema,
  PrivateMessageSchema,
  RequestHashSchema,
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
  type CreateSignalDraftRequest,
  type CreateSignalDraftResult,
  type DecideConsentError,
  type DecideConsentResult,
  type EntityId,
  type EvidenceProvenance,
  type MemberActor,
  type RequestHash,
  type RequestId,
  type SharedSignalPurpose,
  type SharedVisibility,
  type SignalDraft,
  type TransportResult,
} from "../../../packages/contracts/src/index";
import {
  createFixtureSignalDraftProvider,
  createHighRiskSignalDraftCandidate,
  createSignalDraftGenerator,
  type SignalDraftGenerationResult,
  type SignalDraftGenerator,
  type ValidatedSignalDraftCandidate,
} from "../../ai-witness/src/index";
import {
  NOOP_SAFE_LOGGER,
  containsHighRiskContent,
  createSafeContractError,
  redactForProvider,
  requestIdFromUnknown,
  writeSafeLog,
  type SafeLogger,
  type SafeOperationOutcome,
} from "../../boundary/src/index";
import {
  RANDOM_ENTITY_ID_GENERATOR,
  type EntityIdGenerator,
} from "./runtime";
import type {
  ConversationEvidenceView,
  ConversationStore,
  ConversationTransaction,
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

const log = (
  dependencies: ResolvedDependencies,
  operation:
    | "CreatePrivateMessage"
    | "CreateSignalDraft"
    | "DecideConsent"
    | "ConfirmSignal",
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
  operation:
    | "CreatePrivateMessage"
    | "CreateSignalDraft"
    | "DecideConsent"
    | "ConfirmSignal",
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

const actorFromUnknown = (input: unknown): MemberActor | undefined => {
  const parsed = MemberActorSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
};

const isActiveMember = async (
  transaction: ConversationTransaction,
  actor: MemberActor,
): Promise<boolean> => {
  const member = await transaction.findMember(actor.spaceId, actor.memberId);
  return member?.status === "active";
};

const validateSharedVisibility = async (
  transaction: ConversationTransaction,
  spaceId: EntityId,
  visibility: SharedVisibility,
): Promise<boolean> => {
  if (visibility.kind === "space") {
    return true;
  }

  if (new Set(visibility.memberIds).size !== visibility.memberIds.length) {
    return false;
  }

  const memberIds =
    visibility.kind === "members"
      ? visibility.memberIds
      : [...new Set([...visibility.memberIds, visibility.subjectId])];

  for (const memberId of memberIds) {
    const member = await transaction.findMember(spaceId, memberId);

    if (member?.status !== "active") {
      return false;
    }
  }

  return true;
};

interface DraftSources {
  readonly messageContent: string;
  readonly evidence: readonly ConversationEvidenceView[];
  readonly privateInputs: readonly string[];
}

type DraftSourceResult =
  | Readonly<{ status: "ready"; sources: DraftSources }>
  | Readonly<{
      status: "error";
      code: "forbidden" | "not_found";
    }>;

const loadDraftSources = async (
  transaction: ConversationTransaction,
  actor: MemberActor,
  request: CreateSignalDraftRequest,
): Promise<DraftSourceResult> => {
  const member = await transaction.findMember(actor.spaceId, actor.memberId);

  if (
    member?.status !== "active" ||
    member.analysisConsent !== "enabled"
  ) {
    return { code: "forbidden", status: "error" };
  }

  const message = await transaction.findPrivateMessage(
    actor.spaceId,
    request.privateMessageId,
  );

  if (
    message?.authorId !== actor.memberId ||
    message.visibility.memberId !== actor.memberId
  ) {
    return { code: "not_found", status: "error" };
  }

  const evidence: ConversationEvidenceView[] = [];

  for (const evidenceId of request.evidenceIds) {
    const view = await transaction.findEvidence(actor.spaceId, evidenceId);

    if (
      view?.sourceMessageId !== request.privateMessageId ||
      view.evidence.speakerId !== actor.memberId ||
      view.evidence.state !== "available" ||
      view.evidence.visibility.memberId !== actor.memberId
    ) {
      return { code: "not_found", status: "error" };
    }

    evidence.push(view);
  }

  const privateInputs = [
    message.content,
    ...evidence.map((view) => view.rawContent),
  ];

  return {
    sources: {
      evidence,
      messageContent: message.content,
      privateInputs,
    },
    status: "ready",
  };
};

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

  const parsedRequest = CreatePrivateMessageRequestSchema.safeParse(requestInput);

  if (!parsedRequest.success) {
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
      if (!(await isActiveMember(transaction, actor))) {
        return { code: "forbidden" as const, status: "error" as const };
      }

      const conversation = await transaction.findConversation(
        actor.spaceId,
        parsedRequest.data.conversationId,
      );

      if (
        conversation?.type !== "agent_dm" ||
        !conversation.participantMemberIds.includes(actor.memberId)
      ) {
        return { code: "not_found" as const, status: "error" as const };
      }

      const existing = await transaction.findPrivateMessageByClientId(
        actor.spaceId,
        parsedRequest.data.conversationId,
        parsedRequest.data.clientMessageId,
      );

      if (existing !== undefined) {
        const isReplay =
          existing.authorId === actor.memberId &&
          existing.content === parsedRequest.data.content &&
          existing.occurredAt === parsedRequest.data.occurredAt;

        return isReplay
          ? { message: existing, status: "created" as const }
          : { code: "conflict" as const, status: "error" as const };
      }

      const now = timestampNow(dependencies.clock);
      const message = PrivateMessageSchema.parse({
        authorId: actor.memberId,
        clientMessageId: parsedRequest.data.clientMessageId,
        content: parsedRequest.data.content,
        conversationId: parsedRequest.data.conversationId,
        createdAt: now,
        id: dependencies.ids.next(),
        occurredAt: parsedRequest.data.occurredAt,
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
      return { message: result.message, status: "created" as const };
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

    const result = CreatePrivateMessageResultSchema.parse(mutation);
    log(dependencies, "CreatePrivateMessage", requestId, actor, "created", [
      result.message.id,
    ]);
    return { ok: true, result };
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
): ValidatedSignalDraftCandidate => ({
  candidate: createHighRiskSignalDraftCandidate(),
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
  source: "fixture",
  status: "validated",
});

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

  const parsedRequest = CreateSignalDraftRequestSchema.safeParse(requestInput);

  if (
    !parsedRequest.success ||
    new Set(parsedRequest.data.evidenceIds).size !==
      parsedRequest.data.evidenceIds.length
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
    const initialSources = await dependencies.store.transaction((transaction) =>
      loadDraftSources(transaction, actor, parsedRequest.data),
    );

    if (initialSources.status === "error") {
      return failure(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        initialSources.code,
      );
    }

    const generation: SignalDraftGenerationResult = containsHighRiskContent(
      initialSources.sources.privateInputs,
    )
      ? highRiskGeneration(requestId, parsedRequest.data.promptVersion)
      : await dependencies.signalDraftGenerator.generate({
          actorId: actor.memberId,
          privateInputs: initialSources.sources.privateInputs,
          promptVersion: parsedRequest.data.promptVersion,
          redactedInput: redactForProvider(initialSources.sources.privateInputs),
          requestId,
          spaceId: actor.spaceId,
        });

    if (generation.status === "needs_human_review") {
      const result = CreateSignalDraftResultSchema.parse(generation);
      log(
        dependencies,
        "CreateSignalDraft",
        requestId,
        actor,
        "needs_human_review",
      );
      return { ok: true, result };
    }

    const mutation = await dependencies.store.transaction(async (transaction) => {
      const currentSources = await loadDraftSources(
        transaction,
        actor,
        parsedRequest.data,
      );

      if (currentSources.status === "error") {
        return currentSources;
      }

      const now = timestampNow(dependencies.clock);
      const draft = SignalDraftSchema.parse({
        ...generation.candidate,
        createdAt: now,
        evidenceIds: parsedRequest.data.evidenceIds,
        id: dependencies.ids.next(),
        promptVersion: parsedRequest.data.promptVersion,
        source: generation.source,
        sourceMessageId: parsedRequest.data.privateMessageId,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: now,
        version: 0,
      });
      const result = CreateSignalDraftResultSchema.parse({
        draft,
        metadata: generation.metadata,
        status: "draft_created",
      });

      if (result.status !== "draft_created") {
        throw new Error("A validated candidate must produce a draft result.");
      }

      await transaction.insertSignalDraft(draft);
      return { result, status: "created" as const };
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
      mutation.result.draft.kind === "high_risk"
        ? "high_risk_guidance"
        : "draft_created",
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

  const parsedRequest = DecideConsentRequestSchema.safeParse(requestInput);

  if (!parsedRequest.success) {
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
      if (!(await isActiveMember(transaction, actor))) {
        return { code: "forbidden" as const, status: "error" as const };
      }

      const draft = await transaction.findSignalDraft(
        actor.spaceId,
        parsedRequest.data.signalDraftId,
      );

      if (draft?.speakerId !== actor.memberId) {
        return { code: "not_found" as const, status: "error" as const };
      }

      if (
        (await transaction.findConsentDecisionForDraft(
          actor.spaceId,
          draft.id,
        )) !== undefined
      ) {
        return { code: "conflict" as const, status: "error" as const };
      }

      if (
        parsedRequest.data.decision === "share" &&
        ((parsedRequest.data.expiresAt !== null &&
          Date.parse(parsedRequest.data.expiresAt) <=
            Date.parse(parsedRequest.data.decidedAt)) ||
          !(await validateSharedVisibility(
            transaction,
            actor.spaceId,
            parsedRequest.data.visibility,
          )))
      ) {
        return { code: "consent_invalid" as const, status: "error" as const };
      }

      const base = {
        createdAt: parsedRequest.data.decidedAt,
        decidedAt: parsedRequest.data.decidedAt,
        id: dependencies.ids.next(),
        signalDraftId: draft.id,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: parsedRequest.data.decidedAt,
        version: 0,
      };
      const decision: ConsentDecision =
        parsedRequest.data.decision === "share"
          ? ActiveShareConsentSchema.parse({
              ...base,
              expiresAt: parsedRequest.data.expiresAt,
              outcome: "share",
              recordState: "active",
              revokedAt: null,
              visibility: parsedRequest.data.visibility,
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
      return { result, status: "created" as const };
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

const signalPurposeForDraft = (draft: SignalDraft): SharedSignalPurpose => {
  switch (draft.kind) {
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

  const parsedRequest = ConfirmSignalRequestSchema.safeParse(requestInput);

  if (!parsedRequest.success) {
    return failure(
      dependencies,
      "ConfirmSignal",
      requestId,
      actor,
      "invalid_request",
    );
  }

  try {
    const requestHash = confirmationHash(actor, parsedRequest.data);
    const now = timestampNow(dependencies.clock);
    const mutation = await dependencies.store.transaction(async (transaction) => {
      if (!(await isActiveMember(transaction, actor))) {
        return { code: "forbidden" as const, status: "error" as const };
      }

      const existingConfirmation = await transaction.findSignalConfirmation(
        actor.spaceId,
        actor.memberId,
        parsedRequest.data.idempotencyKey,
      );

      if (existingConfirmation !== undefined) {
        return existingConfirmation.requestHash === requestHash
          ? { result: existingConfirmation.result, status: "confirmed" as const }
          : {
              code: "idempotency_conflict" as const,
              status: "error" as const,
            };
      }

      const draft = await transaction.findSignalDraft(
        actor.spaceId,
        parsedRequest.data.signalDraftId,
      );

      if (draft?.speakerId !== actor.memberId) {
        return { code: "not_found" as const, status: "error" as const };
      }

      if (draft.version !== parsedRequest.data.expectedDraftVersion) {
        return { code: "stale_version" as const, status: "error" as const };
      }

      const decision = await transaction.findConsentDecision(
        actor.spaceId,
        parsedRequest.data.consentDecisionId,
      );

      if (decision === undefined) {
        return { code: "consent_required" as const, status: "error" as const };
      }

      if (
        decision.recordState !== "active" ||
        decision.signalDraftId !== draft.id ||
        decision.speakerId !== actor.memberId ||
        (decision.expiresAt !== null && Date.parse(decision.expiresAt) <= Date.parse(now))
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

      if (
        (await transaction.findSignalForConsent(actor.spaceId, decision.id)) !==
        undefined
      ) {
        return { code: "conflict" as const, status: "error" as const };
      }

      const provenance: EvidenceProvenance[] = [];

      for (const evidenceId of draft.evidenceIds) {
        const view = await transaction.findEvidence(actor.spaceId, evidenceId);

        if (
          view?.evidence.speakerId !== actor.memberId ||
          view.evidence.state !== "available"
        ) {
          return { code: "consent_invalid" as const, status: "error" as const };
        }

        provenance.push({
          evidenceId: view.evidence.id,
          occurredAt: view.evidence.occurredAt,
          sourceType: view.evidence.sourceType,
          speakerId: view.evidence.speakerId,
          state: view.evidence.state,
        });
      }

      const signal = SharedSignalSchema.parse({
        conclusion: draft.proposedConclusion,
        consentDecisionId: decision.id,
        createdAt: now,
        evidenceState: "available",
        id: dependencies.ids.next(),
        provenance,
        purpose: signalPurposeForDraft(draft),
        redactedExcerpt: draft.redactedExcerpt,
        spaceId: actor.spaceId,
        speakerId: actor.memberId,
        updatedAt: now,
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
        parsedRequest.data.idempotencyKey,
        { requestHash, result },
      );
      return { result, status: "confirmed" as const };
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
}

export const createConversationHandlers = (
  options: Readonly<ConversationHandlerOptions>,
): ConversationHandlers => {
  const dependencies = resolveDependencies(options);
  const handlers: ConversationHandlers = {
    ConfirmSignal: (actor: unknown, request: unknown) =>
      confirmSignalWithDependencies(dependencies, actor, request),
    CreatePrivateMessage: (actor: unknown, request: unknown) =>
      createPrivateMessageWithDependencies(dependencies, actor, request),
    CreateSignalDraft: (actor: unknown, request: unknown) =>
      createSignalDraftWithDependencies(dependencies, actor, request),
    DecideConsent: (actor: unknown, request: unknown) =>
      decideConsentWithDependencies(dependencies, actor, request),
  };

  return Object.freeze(handlers);
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

export const CreatePrivateMessage = createPrivateMessage;
export const CreateSignalDraft = createSignalDraft;
export const DecideConsent = decideConsent;
export const ConfirmSignal = confirmSignal;
