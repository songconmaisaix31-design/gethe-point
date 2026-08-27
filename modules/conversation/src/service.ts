import { randomUUID } from "node:crypto";

import { z, type ZodType } from "zod";

import {
  ConversationSchema,
  CreatePrivateMessageRequestSchema,
  CreatePrivateMessageResultSchema,
  EntityIdSchema,
  EvidenceSchema,
  GetPrivateConversationRequestSchema,
  GetPrivateConversationResultSchema,
  MemberActorSchema,
  PrivateMessageSchema,
  RequestIdSchema,
  TimestampSchema,
  type CreatePrivateMessageResult,
  type EntityId,
  type GetPrivateConversationResult,
  type MemberActor,
  type PrivateMessage,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  createConversationError,
  isConversationError,
  type ConversationErrorCode,
} from "./errors";
import type {
  ConversationLogger,
  ConversationStatePort,
  SafeConversationLogEntry,
} from "./ports";

export const GetPrivateMessageRequestSchema = z.strictObject({
  requestId: RequestIdSchema,
  privateMessageId: EntityIdSchema,
});

export type GetPrivateMessageRequest = z.infer<
  typeof GetPrivateMessageRequestSchema
>;

export const GetPrivateMessageResultSchema = z.strictObject({
  status: z.literal("ready"),
  message: PrivateMessageSchema,
});

export type GetPrivateMessageResult = z.infer<
  typeof GetPrivateMessageResultSchema
>;

export interface ConversationServiceDependencies {
  readonly evidenceIdGenerator?: () => EntityId;
  readonly logger?: ConversationLogger;
  readonly messageIdGenerator?: () => EntityId;
  readonly rawReferenceFor?: (evidenceId: EntityId) => string;
  readonly recordedAt?: () => Timestamp;
  readonly state: ConversationStatePort;
}

export interface ConversationService {
  createPrivateMessage(
    actor: unknown,
    request: unknown,
  ): Promise<CreatePrivateMessageResult>;

  getPrivateConversation(
    actor: unknown,
    request: unknown,
  ): Promise<GetPrivateConversationResult>;

  getPrivateMessage(
    actor: unknown,
    request: unknown,
  ): Promise<GetPrivateMessageResult>;
}

const parseInput = <Output>(
  schema: ZodType<Output>,
  input: unknown,
  code: ConversationErrorCode,
): Output => {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw createConversationError(code);
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
    if (isConversationError(error)) {
      throw error;
    }

    throw createConversationError("internal_failure");
  }
};

const entityId = (generate: () => EntityId): EntityId =>
  parseInput(EntityIdSchema, generate(), "internal_failure");

const recordedTimestamp = (
  recordedAt: (() => Timestamp) | undefined,
): Timestamp =>
  parseInput(
    TimestampSchema,
    recordedAt?.() ?? new Date().toISOString(),
    "internal_failure",
  );

const isSelfOnlyConversation = (
  actor: MemberActor,
  conversation: ReturnType<typeof ConversationSchema.parse>,
): boolean =>
  conversation.spaceId === actor.spaceId &&
  conversation.type === "agent_dm" &&
  conversation.participantMemberIds.length === 1 &&
  conversation.participantMemberIds[0] === actor.memberId;

const writeLog = (
  logger: ConversationLogger | undefined,
  entry: SafeConversationLogEntry,
): void => {
  logger?.write(entry);
};

export const createConversationService = (
  dependencies: ConversationServiceDependencies,
): ConversationService => {
  const messageIdGenerator = dependencies.messageIdGenerator ?? randomUUID;
  const evidenceIdGenerator = dependencies.evidenceIdGenerator ?? randomUUID;
  const rawReferenceFor =
    dependencies.rawReferenceFor ??
    ((evidenceId: EntityId): string => `private-evidence://${evidenceId}`);

  const createPrivateMessage: ConversationService["createPrivateMessage"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        CreatePrivateMessageRequestSchema,
        requestInput,
        "invalid_request",
      );
      const [member, conversationInput] = await Promise.all([
        dependencies.state.getMember(actor),
        dependencies.state.getConversation(actor, request.conversationId),
      ]);

      if (member?.status !== "active") {
        throw createConversationError("forbidden");
      }

      if (conversationInput === null) {
        throw createConversationError("not_found");
      }

      const conversation = parseInput(
        ConversationSchema,
        conversationInput,
        "internal_failure",
      );

      if (!isSelfOnlyConversation(actor, conversation)) {
        throw createConversationError("not_found");
      }

      const messageId = entityId(messageIdGenerator);
      const evidenceId = entityId(evidenceIdGenerator);
      const updatedAt = recordedTimestamp(dependencies.recordedAt);
      const message = parseInput(
        PrivateMessageSchema,
        {
          authorId: actor.memberId,
          clientMessageId: request.clientMessageId,
          content: request.content,
          conversationId: request.conversationId,
          createdAt: request.occurredAt,
          id: messageId,
          occurredAt: request.occurredAt,
          spaceId: actor.spaceId,
          updatedAt,
          version: 0,
          visibility: { kind: "self", memberId: actor.memberId },
        },
        "internal_failure",
      );
      const evidence = parseInput(
        EvidenceSchema,
        {
          createdAt: request.occurredAt,
          id: evidenceId,
          occurredAt: request.occurredAt,
          rawRef: rawReferenceFor(evidenceId),
          sourceType: "agent_dm",
          spaceId: actor.spaceId,
          speakerId: actor.memberId,
          state: "available",
          updatedAt,
          version: 0,
          visibility: { kind: "self", memberId: actor.memberId },
        },
        "internal_failure",
      );
      const persisted = await dependencies.state.createPrivateMessage(actor, {
        evidence,
        message,
      });

      if (persisted.status === "conflict") {
        throw createConversationError("conflict");
      }

      if (persisted.status === "denied") {
        throw createConversationError("not_found");
      }

      const result = parseInput(
        CreatePrivateMessageResultSchema,
        { status: "created", message: persisted.context.message },
        "internal_failure",
      );

      writeLog(dependencies.logger, {
        actorId: actor.memberId,
        operation: "CreatePrivateMessage",
        outcome: "created",
        requestId: request.requestId,
        resourceId: result.message.id,
      });

      return result;
    });

  const getPrivateMessage: ConversationService["getPrivateMessage"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        GetPrivateMessageRequestSchema,
        requestInput,
        "invalid_request",
      );
      const context = await dependencies.state.getPrivateMessage(
        actor,
        request.privateMessageId,
      );

      if (context === null) {
        throw createConversationError("not_found");
      }

      const result = parseInput(
        GetPrivateMessageResultSchema,
        { status: "ready", message: context.message },
        "internal_failure",
      );

      writeLog(dependencies.logger, {
        actorId: actor.memberId,
        operation: "GetPrivateMessage",
        outcome: "ready",
        requestId: request.requestId,
        resourceId: request.privateMessageId,
      });

      return result;
    });

  const getPrivateConversation: ConversationService["getPrivateConversation"] = (
    actorInput,
    requestInput,
  ) =>
    executeSafely(async () => {
      const actor = parseActor(actorInput);
      const request = parseInput(
        GetPrivateConversationRequestSchema,
        requestInput,
        "invalid_request",
      );
      const [member, conversationInput, messagesInput] = await Promise.all([
        dependencies.state.getMember(actor),
        dependencies.state.getConversation(actor, request.conversationId),
        dependencies.state.listPrivateMessages(actor, request.conversationId),
      ]);

      if (
        member === null ||
        conversationInput === null ||
        messagesInput === null
      ) {
        throw createConversationError("not_found");
      }

      const conversation = parseInput(
        ConversationSchema,
        conversationInput,
        "internal_failure",
      );

      if (!isSelfOnlyConversation(actor, conversation)) {
        throw createConversationError("not_found");
      }

      const messages = messagesInput.map((message) =>
        parseInput(PrivateMessageSchema, message, "internal_failure"),
      );
      const cursorIndex =
        request.page.cursor === null
          ? -1
          : messages.findIndex(({ id }) => id === request.page.cursor);

      if (request.page.cursor !== null && cursorIndex < 0) {
        throw createConversationError("not_found");
      }

      const startIndex = cursorIndex + 1;
      const pageMessages = messages.slice(
        startIndex,
        startIndex + request.page.limit,
      );
      const hasMore = startIndex + pageMessages.length < messages.length;
      const lastMessage: PrivateMessage | undefined = pageMessages.at(-1);
      const result = parseInput(
        GetPrivateConversationResultSchema,
        {
          status: "ready",
          conversation: {
            conversation,
            messages: pageMessages,
            page: {
              hasMore,
              nextCursor: hasMore ? (lastMessage?.id ?? null) : null,
            },
          },
        },
        "internal_failure",
      );

      writeLog(dependencies.logger, {
        actorId: actor.memberId,
        operation: "GetPrivateConversation",
        outcome: "ready",
        requestId: request.requestId,
        resourceId: request.conversationId,
      });

      return result;
    });

  return Object.freeze({
    createPrivateMessage,
    getPrivateConversation,
    getPrivateMessage,
  });
};
