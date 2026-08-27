import type {
  Conversation,
  EntityId,
  Evidence,
  Member,
  MemberActor,
  PrivateMessage,
  RequestId,
} from "../../../packages/contracts/src/index";

export interface PrivateMessageContext {
  readonly evidence: Evidence;
  readonly message: PrivateMessage;
}

export type CreatePrivateMessageStateResult =
  | Readonly<{
      status: "created" | "replay";
      context: PrivateMessageContext;
    }>
  | Readonly<{ status: "conflict" }>
  | Readonly<{ status: "denied" }>;

/**
 * Keeps raw private content behind actor-bound methods. Implementations must
 * return null instead of revealing whether another member's identifier exists.
 */
export interface ConversationStatePort {
  createPrivateMessage(
    actor: MemberActor,
    context: PrivateMessageContext,
  ): CreatePrivateMessageStateResult | Promise<CreatePrivateMessageStateResult>;

  getConversation(
    actor: MemberActor,
    conversationId: EntityId,
  ): Conversation | null | Promise<Conversation | null>;

  getMember(actor: MemberActor): Member | null | Promise<Member | null>;

  getPrivateMessage(
    actor: MemberActor,
    privateMessageId: EntityId,
  ): PrivateMessageContext | null | Promise<PrivateMessageContext | null>;

  listPrivateMessages(
    actor: MemberActor,
    conversationId: EntityId,
  ):
    | readonly PrivateMessage[]
    | null
    | Promise<readonly PrivateMessage[] | null>;
}

export interface SafeConversationLogEntry {
  readonly operation:
    | "CreatePrivateMessage"
    | "GetPrivateConversation"
    | "GetPrivateMessage";
  readonly outcome: "created" | "ready" | "denied" | "failed";
  readonly requestId: RequestId;
  readonly actorId: EntityId;
  readonly resourceId: EntityId;
}

export interface ConversationLogger {
  write(entry: SafeConversationLogEntry): void;
}
