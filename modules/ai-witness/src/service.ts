import { randomUUID } from "node:crypto";

import type { ZodType } from "zod";

import {
  AIExecutionMetadataSchema,
  CreateSignalDraftRequestSchema,
  CreateSignalDraftResultSchema,
  EntityIdSchema,
  EvidenceSchema,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_SIGNAL_DRAFT,
  MemberActorSchema,
  PrivateMessageSchema,
  SignalDraftSchema,
  TimestampSchema,
  type CreateSignalDraftResult,
  type EntityId,
  type Evidence,
  type MemberActor,
  type PrivateMessage,
  type RequestId,
  type SignalDraft,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  createWitnessError,
  isWitnessError,
  type WitnessErrorCode,
} from "./errors";

export const SIGNAL_DRAFT_PROMPT_VERSION = "signal-draft-v1";

export interface SignalDraftSource {
  readonly evidence: readonly Evidence[];
  readonly message: PrivateMessage;
}

export type SaveSignalDraftResult =
  | Readonly<{ status: "created" | "replay"; draft: SignalDraft }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "denied" }>;

/**
 * The source lookup is actor-bound so guessed message or evidence identifiers
 * return null without exposing raw content or record existence.
 */
export interface SignalDraftStatePort {
  getDraftSource(
    actor: MemberActor,
    privateMessageId: EntityId,
    evidenceIds: readonly EntityId[],
  ): SignalDraftSource | null | Promise<SignalDraftSource | null>;

  saveSignalDraft(
    actor: MemberActor,
    draft: SignalDraft,
  ): SaveSignalDraftResult | Promise<SaveSignalDraftResult>;
}

export interface SafeWitnessLogEntry {
  readonly operation: "CreateSignalDraft";
  readonly outcome: "draft_created" | "needs_human_review";
  readonly requestId: RequestId;
  readonly actorId: EntityId;
  readonly resourceId: EntityId;
}

export interface WitnessLogger {
  write(entry: SafeWitnessLogEntry): void;
}

export interface SignalDraftServiceDependencies {
  readonly createdAt?: () => Timestamp;
  readonly draftIdGenerator?: () => EntityId;
  readonly logger?: WitnessLogger;
  readonly state: SignalDraftStatePort;
}

export interface SignalDraftService {
  createSignalDraft(
    actor: unknown,
    request: unknown,
  ): Promise<CreateSignalDraftResult>;
}

const parseInput = <Output>(
  schema: ZodType<Output>,
  input: unknown,
  code: WitnessErrorCode,
): Output => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw createWitnessError(code);
  }

  return parsed.data;
};

const parseActor = (input: unknown): MemberActor =>
  parseInput(MemberActorSchema, input, "unauthenticated");

const executeSafely = async <Result>(
  work: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await work();
  } catch (error) {
    if (isWitnessError(error)) {
      throw error;
    }

    throw createWitnessError("internal_failure");
  }
};

const isActorOwnedSource = (
  actor: MemberActor,
  message: PrivateMessage,
  evidence: readonly Evidence[],
  requestedEvidenceIds: readonly EntityId[],
): boolean => {
  const evidenceIds = evidence.map(({ id }) => id);

  return (
    message.authorId === actor.memberId &&
    message.spaceId === actor.spaceId &&
    message.visibility.memberId === actor.memberId &&
    evidence.length === requestedEvidenceIds.length &&
    new Set(requestedEvidenceIds).size === requestedEvidenceIds.length &&
    requestedEvidenceIds.every((id) => evidenceIds.includes(id)) &&
    evidence.every(
      (item) =>
        item.spaceId === actor.spaceId &&
        item.speakerId === actor.memberId &&
        item.state === "available" &&
        item.visibility.memberId === actor.memberId,
    )
  );
};

const currentTimestamp = (
  createdAt: (() => Timestamp) | undefined,
): Timestamp =>
  parseInput(
    TimestampSchema,
    createdAt?.() ?? new Date().toISOString(),
    "internal_failure",
  );

export const createSignalDraftService = (
  dependencies: SignalDraftServiceDependencies,
): SignalDraftService => {
  const draftIdGenerator = dependencies.draftIdGenerator ?? randomUUID;

  const createSignalDraft: SignalDraftService["createSignalDraft"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        CreateSignalDraftRequestSchema,
        requestInput,
        "invalid_request",
      );

      if (request.promptVersion !== SIGNAL_DRAFT_PROMPT_VERSION) {
        throw createWitnessError("invalid_request");
      }

      const sourceInput = await dependencies.state.getDraftSource(
        actor,
        request.privateMessageId,
        request.evidenceIds,
      );

      if (sourceInput === null) {
        throw createWitnessError("not_found");
      }

      const message = parseInput(
        PrivateMessageSchema,
        sourceInput.message,
        "internal_failure",
      );
      const evidence = sourceInput.evidence.map((item) =>
        parseInput(EvidenceSchema, item, "internal_failure"),
      );

      if (!isActorOwnedSource(actor, message, evidence, request.evidenceIds)) {
        throw createWitnessError("not_found");
      }

      if (message.content !== FIXTURE_PRIVATE_MESSAGE.content) {
        dependencies.logger?.write({
          actorId: actor.memberId,
          operation: "CreateSignalDraft",
          outcome: "needs_human_review",
          requestId: request.requestId,
          resourceId: request.privateMessageId,
        });
        throw createWitnessError("needs_human_review");
      }

      const draft = parseInput(
        SignalDraftSchema,
        {
          candidateDomainId: FIXTURE_SIGNAL_DRAFT.candidateDomainId,
          confidence: FIXTURE_SIGNAL_DRAFT.confidence,
          createdAt: message.createdAt,
          evidenceIds: request.evidenceIds,
          id: parseInput(
            EntityIdSchema,
            draftIdGenerator(),
            "internal_failure",
          ),
          kind: FIXTURE_SIGNAL_DRAFT.kind,
          missingInfo: FIXTURE_SIGNAL_DRAFT.missingInfo,
          promptVersion: SIGNAL_DRAFT_PROMPT_VERSION,
          proposedConclusion: FIXTURE_SIGNAL_DRAFT.proposedConclusion,
          redactedExcerpt: FIXTURE_SIGNAL_DRAFT.redactedExcerpt,
          source: "fixture",
          sourceMessageId: message.id,
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          updatedAt: currentTimestamp(dependencies.createdAt),
          version: 0,
        },
        "internal_failure",
      );
      const persisted = await dependencies.state.saveSignalDraft(actor, draft);

      if (persisted.status === "conflict") {
        throw createWitnessError("conflict");
      }

      if (persisted.status === "denied") {
        throw createWitnessError("not_found");
      }

      const metadata = parseInput(
        AIExecutionMetadataSchema,
        {
          attempts: 1,
          contentLogged: false,
          inputTokens: 0,
          latencyMs: 0,
          outputTokens: 0,
          promptVersion: SIGNAL_DRAFT_PROMPT_VERSION,
          providerOutcome: "fixture",
          purpose: "signal_draft",
          requestId: request.requestId,
        },
        "internal_failure",
      );
      const result = parseInput(
        CreateSignalDraftResultSchema,
        {
          draft: persisted.draft,
          metadata,
          status: "draft_created",
        },
        "internal_failure",
      );

      if (result.status !== "draft_created") {
        throw createWitnessError("internal_failure");
      }

      dependencies.logger?.write({
        actorId: actor.memberId,
        operation: "CreateSignalDraft",
        outcome: "draft_created",
        requestId: request.requestId,
        resourceId: result.draft.id,
      });

      return result;
    });

  return Object.freeze({ createSignalDraft });
};
