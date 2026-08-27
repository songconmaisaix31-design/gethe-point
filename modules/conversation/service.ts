import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  ActiveShareConsentSchema,
  ConsentDecisionSchema,
  ConversationSchema,
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
  MemberSchema,
  PageInfoSchema,
  PrivateContentSchema,
  PrivateMessageSchema,
  RawEvidenceViewSchema,
  RequestIdSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  ConfirmSignalRequestSchema,
  ConfirmSignalResultSchema,
  type ActiveShareConsent,
  type Clock,
  type ConfirmSignalResult,
  type ConsentDecision,
  type CreatePrivateMessageResult,
  type CreateSignalDraftResult,
  type DecideConsentResult,
  type EntityId,
  type GetPrivateConversationResult,
  type GetVisibleSharedSignalsResult,
  type LLMProvider,
  type MemberActor,
  type RawEvidenceView,
  type SharedSignal,
  type SharedVisibility,
  type SignalDraft,
  type Timestamp,
} from "../../packages/contracts/src/index";
import {
  createHighRiskDraft,
  detectHighRiskCategory,
  executeSignalDraftProvider,
  redactProviderInput,
  type RenderedSignalDraftFields,
} from "../ai-witness/index";
import { inspectDisclosure } from "../boundary/index";
import { ConversationOperationError, isConversationOperationError } from "./errors";
import type {
  AnalysisContext,
  ConfirmationContext,
  ConsentContext,
  ConversationStore,
  MessageCreationContext,
  PrivateEvidenceRecord,
} from "./ports";
import {
  captureAnalysisExpectedState,
  captureConfirmationExpectedState,
  captureConsentExpectedState,
  captureMessageCreationExpectedState,
  expectedStateMatches,
} from "./state-expectations";

const UNKNOWN_REQUEST_ID = "00000000-0000-4000-8000-000000000000";

export const GetRawEvidenceRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  evidenceId: EntityIdSchema,
});

export const GetRawEvidenceResultSchema = z.strictObject({
  status: z.literal("ready"),
  evidence: RawEvidenceViewSchema,
});

export type GetRawEvidenceRequest = z.infer<typeof GetRawEvidenceRequestSchema>;
export type GetRawEvidenceResult = z.infer<typeof GetRawEvidenceResultSchema>;

export interface ConversationIdFactory {
  next(): EntityId;
}

export interface ConversationServiceDependencies {
  readonly store: ConversationStore;
  readonly provider: LLMProvider;
  readonly clock: Clock;
  readonly idFactory?: ConversationIdFactory;
  readonly providerTimeoutMs?: number;
}

export interface ConversationService {
  createPrivateMessage(
    actor: unknown,
    request: unknown,
  ): Promise<CreatePrivateMessageResult>;
  createSignalDraft(
    actor: unknown,
    request: unknown,
  ): Promise<CreateSignalDraftResult>;
  decideConsent(
    actor: unknown,
    request: unknown,
  ): Promise<DecideConsentResult>;
  confirmSignal(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmSignalResult>;
  getPrivateConversation(
    actor: unknown,
    request: unknown,
  ): Promise<GetPrivateConversationResult>;
  getRawEvidence(
    actor: unknown,
    request: unknown,
  ): Promise<GetRawEvidenceResult>;
  getVisibleSharedSignals(
    actor: unknown,
    request: unknown,
  ): Promise<GetVisibleSharedSignalsResult>;
}

const requestIdFrom = (request: unknown): string => {
  if (request === null || typeof request !== "object") {
    return UNKNOWN_REQUEST_ID;
  }

  const descriptor = Object.getOwnPropertyDescriptor(request, "requestId");
  if (descriptor === undefined || !("value" in descriptor)) {
    return UNKNOWN_REQUEST_ID;
  }

  const parsed = RequestIdSchema.safeParse(descriptor.value);
  return parsed.success ? parsed.data : UNKNOWN_REQUEST_ID;
};

const fail = (
  code: ConstructorParameters<typeof ConversationOperationError>[0],
  requestId: string,
): never => {
  throw new ConversationOperationError(code, requestId);
};

const parseBoundary = <Result>(
  schema: z.ZodType<Result>,
  input: unknown,
  requestId: string,
): Result => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return fail("invalid_request", requestId);
  }
  return parsed.data;
};

const parseActor = (input: unknown, requestId: string): MemberActor => {
  const parsed = MemberActorSchema.safeParse(input);
  if (!parsed.success) {
    return fail("unauthenticated", requestId);
  }
  return parsed.data;
};

const runSafely = async <Result>(
  requestId: string,
  work: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (isConversationOperationError(error)) {
      throw error;
    }
    throw new ConversationOperationError("internal_failure", requestId);
  }
};

const currentTimestamp = (clock: Clock, requestId: string): Timestamp => {
  let value: Date;
  try {
    value = clock.now();
  } catch {
    return fail("internal_failure", requestId);
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return fail("internal_failure", requestId);
  }

  return value.toISOString();
};

const nextId = (
  idFactory: ConversationIdFactory,
  requestId: string,
): EntityId => {
  let value: unknown;
  try {
    value = idFactory.next();
  } catch {
    return fail("internal_failure", requestId);
  }

  const parsed = EntityIdSchema.safeParse(value);
  return parsed.success ? parsed.data : fail("internal_failure", requestId);
};

const idsEqual = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...right].sort((a, b) => a.localeCompare(b));
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

const hasUniqueIds = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const validateSpaceAndActor = (
  context: Pick<MessageCreationContext, "space" | "actor">,
  actor: MemberActor,
  requestId: string,
  requireAnalysisConsent: boolean,
): void => {
  if (
    !SpaceSchema.safeParse(context.space).success ||
    !MemberSchema.safeParse(context.actor).success ||
    context.space.id !== actor.spaceId ||
    context.space.spaceId !== actor.spaceId ||
    context.space.status !== "active" ||
    context.actor.id !== actor.memberId ||
    context.actor.spaceId !== actor.spaceId ||
    context.actor.role !== actor.role ||
    context.actor.status !== "active" ||
    (requireAnalysisConsent && context.actor.analysisConsent !== "enabled")
  ) {
    fail("not_found", requestId);
  }
};

const validateMessageCreationContext = (
  context: MessageCreationContext | undefined,
  actor: MemberActor,
  conversationId: EntityId,
  requestId: string,
): MessageCreationContext => {
  if (context === undefined) {
    return fail("not_found", requestId);
  }

  validateSpaceAndActor(context, actor, requestId, false);
  if (
    !ConversationSchema.safeParse(context.conversation).success ||
    context.conversation.id !== conversationId ||
    context.conversation.spaceId !== actor.spaceId ||
    context.conversation.type !== "agent_dm" ||
    !context.conversation.participantMemberIds.includes(actor.memberId)
  ) {
    return fail("not_found", requestId);
  }

  return context;
};

const validateEvidence = (
  records: readonly PrivateEvidenceRecord[],
  expectedIds: readonly EntityId[],
  actor: MemberActor,
  sourceMessageId: EntityId,
  requestId: string,
): void => {
  if (!hasUniqueIds(expectedIds)) {
    fail("invalid_request", requestId);
  }
  if (!idsEqual(records.map(({ evidence }) => evidence.id), expectedIds)) {
    fail("not_found", requestId);
  }

  for (const record of records) {
    if (
      !EvidenceSchema.safeParse(record.evidence).success ||
      !PrivateContentSchema.safeParse(record.rawContent).success ||
      record.evidence.spaceId !== actor.spaceId ||
      record.evidence.speakerId !== actor.memberId ||
      record.evidence.visibility.memberId !== actor.memberId ||
      record.evidence.state !== "available" ||
      (record.evidence.sourceType === "agent_dm" &&
        record.sourceMessageId !== sourceMessageId)
    ) {
      fail("not_found", requestId);
    }
  }
};

const validateAnalysisContext = (
  context: AnalysisContext | undefined,
  actor: MemberActor,
  request: z.infer<typeof CreateSignalDraftRequestSchema>,
  requestId: string,
): AnalysisContext => {
  if (context === undefined) {
    return fail("not_found", requestId);
  }

  validateSpaceAndActor(context, actor, requestId, true);
  if (
    !ConversationSchema.safeParse(context.conversation).success ||
    !PrivateMessageSchema.safeParse(context.message).success ||
    context.conversation.id !== context.message.conversationId ||
    context.conversation.spaceId !== actor.spaceId ||
    context.conversation.type !== "agent_dm" ||
    !context.conversation.participantMemberIds.includes(actor.memberId) ||
    context.message.id !== request.privateMessageId ||
    context.message.spaceId !== actor.spaceId ||
    context.message.authorId !== actor.memberId ||
    context.message.visibility.memberId !== actor.memberId
  ) {
    return fail("not_found", requestId);
  }

  validateEvidence(
    context.evidence,
    request.evidenceIds,
    actor,
    context.message.id,
    requestId,
  );
  return context;
};

const visibilityMemberIds = (
  visibility: SharedVisibility,
): readonly EntityId[] => {
  switch (visibility.kind) {
    case "space":
      return [];
    case "members":
      return visibility.memberIds;
    case "care_related":
      return [visibility.subjectId, ...visibility.memberIds];
  }
};

const validateVisibilityMembers = (
  visibility: SharedVisibility,
  members: ConsentContext["visibilityMembers"],
  actor: MemberActor,
  requestId: string,
): void => {
  const expectedIds = visibilityMemberIds(visibility);
  if (
    !hasUniqueIds(expectedIds) ||
    !idsEqual(
      members.map((member) => member.id),
      expectedIds,
    )
  ) {
    fail("visibility_denied", requestId);
  }

  for (const member of members) {
    if (
      !MemberSchema.safeParse(member).success ||
      member.spaceId !== actor.spaceId ||
      member.status !== "active"
    ) {
      fail("visibility_denied", requestId);
    }
  }
};

const validateDraftAndEvidence = (
  context: ConsentContext,
  actor: MemberActor,
  signalDraftId: EntityId,
  requestId: string,
): void => {
  if (
    !SignalDraftSchema.safeParse(context.draft).success ||
    context.draft.id !== signalDraftId ||
    context.draft.spaceId !== actor.spaceId ||
    context.draft.speakerId !== actor.memberId
  ) {
    fail("not_found", requestId);
  }

  validateEvidence(
    context.evidence,
    context.draft.evidenceIds,
    actor,
    context.draft.sourceMessageId,
    requestId,
  );
};

const validateConsentContext = (
  context: ConsentContext | undefined,
  actor: MemberActor,
  signalDraftId: EntityId,
  visibility: SharedVisibility | null,
  requestId: string,
): ConsentContext => {
  if (context === undefined) {
    return fail("not_found", requestId);
  }

  validateSpaceAndActor(context, actor, requestId, true);
  validateDraftAndEvidence(context, actor, signalDraftId, requestId);
  if (visibility !== null) {
    validateVisibilityMembers(visibility, context.visibilityMembers, actor, requestId);
  } else if (context.visibilityMembers.length !== 0) {
    fail("visibility_denied", requestId);
  }

  return context;
};

const validateConfirmationContext = (
  context: ConfirmationContext | undefined,
  actor: MemberActor,
  request: z.infer<typeof ConfirmSignalRequestSchema>,
  observedAt: Timestamp,
  requestId: string,
): ActiveShareConsent => {
  if (context === undefined) {
    return fail("not_found", requestId);
  }

  validateSpaceAndActor(context, actor, requestId, true);
  validateDraftAndEvidence(context, actor, request.signalDraftId, requestId);
  if (context.draft.version !== request.expectedDraftVersion) {
    return fail("stale_version", requestId);
  }
  if (context.draft.kind === "high_risk") {
    return fail("consent_invalid", requestId);
  }
  if (context.consent === undefined) {
    return fail("consent_required", requestId);
  }

  const parsedConsent = ActiveShareConsentSchema.safeParse(context.consent);
  if (
    !parsedConsent.success ||
    parsedConsent.data.id !== request.consentDecisionId ||
    parsedConsent.data.spaceId !== actor.spaceId ||
    parsedConsent.data.signalDraftId !== context.draft.id ||
    parsedConsent.data.speakerId !== actor.memberId ||
    (parsedConsent.data.expiresAt !== null &&
      Date.parse(parsedConsent.data.expiresAt) <= Date.parse(observedAt))
  ) {
    return fail("consent_invalid", requestId);
  }

  validateVisibilityMembers(
    parsedConsent.data.visibility,
    context.visibilityMembers,
    actor,
    requestId,
  );
  return parsedConsent.data;
};

const protectedValues = (context: AnalysisContext | ConsentContext): string[] => [
  ...("message" in context ? [context.message.content] : []),
  ...context.evidence.map(({ rawContent }) => rawContent),
];

const providerFixtureMetadata = (
  requestId: EntityId,
  promptVersion: string,
) => ({
  requestId,
  purpose: "signal_draft" as const,
  promptVersion,
  attempts: 1 as const,
  providerOutcome: "fixture" as const,
  latencyMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  contentLogged: false as const,
});

const visibilityAllows = (
  visibility: SharedVisibility,
  memberId: EntityId,
): boolean => {
  switch (visibility.kind) {
    case "space":
      return true;
    case "members":
      return visibility.memberIds.includes(memberId);
    case "care_related":
      return (
        visibility.subjectId === memberId || visibility.memberIds.includes(memberId)
      );
  }
};

const confirmationRequestHash = (
  actor: MemberActor,
  request: z.infer<typeof ConfirmSignalRequestSchema>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        actorId: actor.memberId,
        spaceId: actor.spaceId,
        signalDraftId: request.signalDraftId,
        consentDecisionId: request.consentDecisionId,
        expectedDraftVersion: request.expectedDraftVersion,
      }),
      "utf8",
    )
    .digest("hex");

const defaultIdFactory: ConversationIdFactory = {
  next: () => randomUUID(),
};

export const createConversationService = ({
  clock,
  idFactory = defaultIdFactory,
  provider,
  providerTimeoutMs = 2_000,
  store,
}: ConversationServiceDependencies): ConversationService => {
  if (
    !Number.isInteger(providerTimeoutMs) ||
    providerTimeoutMs < 1 ||
    providerTimeoutMs > 30_000
  ) {
    throw new Error("Conversation provider timeout configuration is invalid.");
  }

  const createPrivateMessage = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<CreatePrivateMessageResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        CreatePrivateMessageRequestSchema,
        requestInput,
        requestId,
      );

      return store.transaction(async (transaction) => {
        const context = validateMessageCreationContext(
          await transaction.lockMessageCreationContext({
            spaceId: actor.spaceId,
            actorId: actor.memberId,
            conversationId: request.conversationId,
          }),
          actor,
          request.conversationId,
          requestId,
        );
        const persistedAt = currentTimestamp(clock, requestId);
        const messageId = nextId(idFactory, requestId);
        const evidenceId = nextId(idFactory, requestId);
        const message = PrivateMessageSchema.parse({
          id: messageId,
          spaceId: actor.spaceId,
          conversationId: request.conversationId,
          authorId: actor.memberId,
          clientMessageId: request.clientMessageId,
          content: request.content,
          occurredAt: request.occurredAt,
          visibility: { kind: "self", memberId: actor.memberId },
          createdAt: persistedAt,
          updatedAt: persistedAt,
          version: 0,
        });
        const evidence = EvidenceSchema.parse({
          id: evidenceId,
          spaceId: actor.spaceId,
          sourceType: "agent_dm",
          speakerId: actor.memberId,
          occurredAt: request.occurredAt,
          rawRef: `message:${messageId}`,
          visibility: { kind: "self", memberId: actor.memberId },
          state: "available",
          createdAt: persistedAt,
          updatedAt: persistedAt,
          version: 0,
        });
        const outcome = await transaction.persistPrivateMessage({
          message,
          evidence: {
            evidence,
            rawContent: request.content,
            sourceMessageId: message.id,
          },
          expected: captureMessageCreationExpectedState(context),
        });

        if (outcome !== "inserted") {
          return fail("conflict", requestId);
        }

        return CreatePrivateMessageResultSchema.parse({
          status: "created",
          message,
        });
      });
    });
  };

  const createSignalDraft = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<CreateSignalDraftResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        CreateSignalDraftRequestSchema,
        requestInput,
        requestId,
      );
      const initial = validateAnalysisContext(
        await store.read((reader) =>
          reader.loadAnalysisContext({
            spaceId: actor.spaceId,
            actorId: actor.memberId,
            privateMessageId: request.privateMessageId,
            evidenceIds: request.evidenceIds,
          }),
        ),
        actor,
        request,
        requestId,
      );
      const initialExpectation = captureAnalysisExpectedState(initial);
      const privateValues = protectedValues(initial);
      const highRiskCategory = privateValues
        .map(detectHighRiskCategory)
        .find((category) => category !== undefined);

      let fields: RenderedSignalDraftFields;
      let metadata;
      let source: SignalDraft["source"];

      if (highRiskCategory !== undefined) {
        const highRiskFields = createHighRiskDraft(
          highRiskCategory,
          privateValues,
        );
        if (highRiskFields === undefined) {
          return fail("internal_failure", requestId);
        }
        fields = highRiskFields;
        metadata = providerFixtureMetadata(request.requestId, request.promptVersion);
        source = "fixture";
      } else {
        const execution = await executeSignalDraftProvider(provider, {
          requestId: request.requestId,
          promptVersion: request.promptVersion,
          redactedInput: redactProviderInput(initial.message.content),
          protectedValues: privateValues,
          timeoutMs: providerTimeoutMs,
        });
        if (execution.status === "needs_human_review") {
          return CreateSignalDraftResultSchema.parse(execution);
        }
        fields = execution.fields;
        metadata = execution.metadata;
        source = "validated_ai";
      }

      return store.transaction(async (transaction) => {
        const locked = validateAnalysisContext(
          await transaction.lockAnalysisContext({
            spaceId: actor.spaceId,
            actorId: actor.memberId,
            privateMessageId: request.privateMessageId,
            evidenceIds: request.evidenceIds,
          }),
          actor,
          request,
          requestId,
        );
        const lockedExpectation = captureAnalysisExpectedState(locked);
        if (!expectedStateMatches(initialExpectation, lockedExpectation)) {
          return fail("conflict", requestId);
        }

        const persistedAt = currentTimestamp(clock, requestId);
        const draft = SignalDraftSchema.parse({
          id: nextId(idFactory, requestId),
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          sourceMessageId: locked.message.id,
          evidenceIds: request.evidenceIds,
          kind: fields.kind,
          redactedExcerpt: fields.redactedExcerpt,
          proposedConclusion: fields.proposedConclusion,
          candidateDomainId: fields.candidateDomainId,
          confidence: fields.confidence,
          missingInfo: fields.missingInfo,
          promptVersion: request.promptVersion,
          source,
          createdAt: persistedAt,
          updatedAt: persistedAt,
          version: 0,
        });
        if (
          !inspectDisclosure({
            value: {
              kind: draft.kind,
              redactedExcerpt: draft.redactedExcerpt,
              proposedConclusion: draft.proposedConclusion,
              candidateDomainId: draft.candidateDomainId,
              confidence: draft.confidence,
              missingInfo: draft.missingInfo,
            },
            protectedValues: protectedValues(locked),
          }).safe
        ) {
          return fail("internal_failure", requestId);
        }
        const outcome = await transaction.persistSignalDraft({
          draft,
          expected: lockedExpectation,
        });
        if (outcome !== "inserted") {
          return fail("conflict", requestId);
        }

        return CreateSignalDraftResultSchema.parse({
          status: "draft_created",
          draft,
          metadata,
        });
      });
    });
  };

  const decideConsent = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<DecideConsentResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        DecideConsentRequestSchema,
        requestInput,
        requestId,
      );
      const visibility = request.decision === "share" ? request.visibility : null;
      const requiredVisibilityMemberIds =
        visibility === null ? [] : visibilityMemberIds(visibility);

      return store.transaction(async (transaction) => {
        const context = validateConsentContext(
          await transaction.lockConsentContext({
            spaceId: actor.spaceId,
            actorId: actor.memberId,
            signalDraftId: request.signalDraftId,
            visibilityMemberIds: requiredVisibilityMemberIds,
          }),
          actor,
          request.signalDraftId,
          visibility,
          requestId,
        );
        if (context.draft.kind === "high_risk" && request.decision === "share") {
          return fail("consent_invalid", requestId);
        }
        const persistedAt = currentTimestamp(clock, requestId);
        if (
          request.decision === "share" &&
          request.expiresAt !== null &&
          (Date.parse(request.expiresAt) <= Date.parse(request.decidedAt) ||
            Date.parse(request.expiresAt) <= Date.parse(persistedAt))
        ) {
          return fail("consent_invalid", requestId);
        }

        const common = {
          id: nextId(idFactory, requestId),
          spaceId: actor.spaceId,
          signalDraftId: request.signalDraftId,
          speakerId: actor.memberId,
          decidedAt: request.decidedAt,
          createdAt: persistedAt,
          updatedAt: persistedAt,
          version: 0,
        };
        const decision: ConsentDecision = ConsentDecisionSchema.parse(
          request.decision === "share"
            ? {
                ...common,
                recordState: "active",
                outcome: "share",
                visibility: request.visibility,
                expiresAt: request.expiresAt,
                revokedAt: null,
              }
            : {
                ...common,
                recordState: "discarded",
                outcome: "discard",
                visibility: null,
                expiresAt: null,
                revokedAt: null,
              },
        );
        const outcome = await transaction.persistConsentDecision({
          decision,
          expected: captureConsentExpectedState(context),
        });
        if (outcome !== "inserted") {
          return fail("conflict", requestId);
        }

        return DecideConsentResultSchema.parse({
          status: "decision_recorded",
          decision,
        });
      });
    });
  };

  const confirmSignal = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<ConfirmSignalResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        ConfirmSignalRequestSchema,
        requestInput,
        requestId,
      );
      const requestHash = confirmationRequestHash(actor, request);

      return store.transaction(async (transaction) => {
        const transactionObservedAt = currentTimestamp(clock, requestId);
        const replay = await transaction.findConfirmationReplay({
          spaceId: actor.spaceId,
          actorId: actor.memberId,
          idempotencyKey: request.idempotencyKey,
        });
        if (replay !== undefined) {
          if (replay.requestHash !== requestHash) {
            return fail("idempotency_conflict", requestId);
          }
          const signal = SharedSignalSchema.safeParse(replay.signal);
          if (
            !signal.success ||
            signal.data.spaceId !== actor.spaceId ||
            signal.data.speakerId !== actor.memberId
          ) {
            return fail("internal_failure", requestId);
          }
          return ConfirmSignalResultSchema.parse({
            status: "confirmed",
            signal: signal.data,
          });
        }

        const contextQuery = {
          spaceId: actor.spaceId,
          actorId: actor.memberId,
          signalDraftId: request.signalDraftId,
          consentDecisionId: request.consentDecisionId,
        } as const;
        const locked = await transaction.lockConfirmationContext(contextQuery);
        validateConfirmationContext(
          locked,
          actor,
          request,
          transactionObservedAt,
          requestId,
        );
        if (locked === undefined) {
          return fail("not_found", requestId);
        }
        const lockedExpectation = captureConfirmationExpectedState(locked);
        if (lockedExpectation === undefined) {
          return fail("consent_required", requestId);
        }

        const reread = await transaction.readConfirmationContext(contextQuery);
        const persistenceObservedAt = currentTimestamp(clock, requestId);
        const consent = validateConfirmationContext(
          reread,
          actor,
          request,
          persistenceObservedAt,
          requestId,
        );
        if (reread === undefined) {
          return fail("not_found", requestId);
        }
        const rereadExpectation = captureConfirmationExpectedState(reread);
        if (
          rereadExpectation === undefined ||
          !expectedStateMatches(lockedExpectation, rereadExpectation)
        ) {
          return fail("stale_version", requestId);
        }

        const signal: SharedSignal = SharedSignalSchema.parse({
          id: nextId(idFactory, requestId),
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          consentDecisionId: consent.id,
          redactedExcerpt: reread.draft.redactedExcerpt,
          conclusion: reread.draft.proposedConclusion,
          purpose:
            reread.draft.kind === "potential_task"
              ? "responsibility"
              : "family_information",
          visibility: consent.visibility,
          provenance: reread.evidence.map(({ evidence }) => ({
            evidenceId: evidence.id,
            sourceType: evidence.sourceType,
            speakerId: evidence.speakerId,
            occurredAt: evidence.occurredAt,
            state: evidence.state,
          })),
          evidenceState: "available",
          createdAt: persistenceObservedAt,
          updatedAt: persistenceObservedAt,
          version: 0,
        });
        if (
          !inspectDisclosure({
            value: signal,
            protectedValues: protectedValues(reread),
          }).safe
        ) {
          return fail("consent_invalid", requestId);
        }

        const outcome = await transaction.persistConfirmedSignal({
          signal,
          consent,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          expected: rereadExpectation,
        });
        if (outcome === "stale") {
          return fail("stale_version", requestId);
        }
        if (outcome === "conflict") {
          return fail("conflict", requestId);
        }

        return ConfirmSignalResultSchema.parse({ status: "confirmed", signal });
      });
    });
  };

  const getPrivateConversation = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<GetPrivateConversationResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        GetPrivateConversationRequestSchema,
        requestInput,
        requestId,
      );
      const context = await store.read((reader) =>
        reader.loadPrivateConversation({
          spaceId: actor.spaceId,
          actorId: actor.memberId,
          conversationId: request.conversationId,
          cursor: request.page.cursor,
          limit: request.page.limit,
        }),
      );
      if (context === undefined) {
        return fail("not_found", requestId);
      }
      validateMessageCreationContext(
        context,
        actor,
        request.conversationId,
        requestId,
      );
      if (!PageInfoSchema.safeParse(context.page).success) {
        return fail("internal_failure", requestId);
      }
      const messages = context.messages.filter((message) => {
        const parsed = PrivateMessageSchema.safeParse(message);
        return (
          parsed.success &&
          parsed.data.spaceId === actor.spaceId &&
          parsed.data.conversationId === request.conversationId &&
          parsed.data.authorId === actor.memberId &&
          parsed.data.visibility.memberId === actor.memberId
        );
      });

      return GetPrivateConversationResultSchema.parse({
        status: "ready",
        conversation: {
          conversation: context.conversation,
          messages,
          page: context.page,
        },
      });
    });
  };

  const getRawEvidence = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<GetRawEvidenceResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        GetRawEvidenceRequestSchema,
        requestInput,
        requestId,
      );
      const context = await store.read((reader) =>
        reader.loadRawEvidence({
          spaceId: actor.spaceId,
          actorId: actor.memberId,
          evidenceId: request.evidenceId,
        }),
      );
      if (context === undefined) {
        return fail("not_found", requestId);
      }
      validateSpaceAndActor(context, actor, requestId, false);
      const record = context.evidence;
      if (
        !EvidenceSchema.safeParse(record.evidence).success ||
        !PrivateContentSchema.safeParse(record.rawContent).success ||
        record.evidence.id !== request.evidenceId ||
        record.evidence.spaceId !== actor.spaceId ||
        record.evidence.speakerId !== actor.memberId ||
        record.evidence.visibility.memberId !== actor.memberId ||
        record.evidence.state !== "available"
      ) {
        return fail("not_found", requestId);
      }

      const evidence: RawEvidenceView = RawEvidenceViewSchema.parse({
        evidence: record.evidence,
        rawContent: record.rawContent,
      });
      return GetRawEvidenceResultSchema.parse({ status: "ready", evidence });
    });
  };

  const getVisibleSharedSignals = async (
    actorInput: unknown,
    requestInput: unknown,
  ): Promise<GetVisibleSharedSignalsResult> => {
    const requestId = requestIdFrom(requestInput);
    return runSafely(requestId, async () => {
      const actor = parseActor(actorInput, requestId);
      const request = parseBoundary(
        GetVisibleSharedSignalsRequestSchema,
        requestInput,
        requestId,
      );
      if (request.spaceId !== actor.spaceId) {
        return fail("not_found", requestId);
      }
      const context = await store.read((reader) =>
        reader.loadVisibleSignals({
          spaceId: actor.spaceId,
          actorId: actor.memberId,
          cursor: request.page.cursor,
          limit: request.page.limit,
        }),
      );
      if (context === undefined) {
        return fail("not_found", requestId);
      }
      validateSpaceAndActor(context, actor, requestId, false);
      if (!PageInfoSchema.safeParse(context.page).success) {
        return fail("internal_failure", requestId);
      }
      const signals = context.signals.filter((signal) => {
        const parsed = SharedSignalSchema.safeParse(signal);
        return (
          parsed.success &&
          parsed.data.spaceId === actor.spaceId &&
          visibilityAllows(parsed.data.visibility, actor.memberId)
        );
      });

      return GetVisibleSharedSignalsResultSchema.parse({
        status: "ready",
        signals,
        page: context.page,
      });
    });
  };

  return {
    createPrivateMessage,
    createSignalDraft,
    decideConsent,
    confirmSignal,
    getPrivateConversation,
    getRawEvidence,
    getVisibleSharedSignals,
  };
};
