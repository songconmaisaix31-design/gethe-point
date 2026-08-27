import type {
  Conversation,
  EntityId,
  Member,
  MemberActor,
  PrivateMessage,
  SharedVisibility,
  Space,
} from "../../../packages/contracts/src/index";
import type {
  ConversationEvidenceView,
  ConversationTransaction,
  DraftSourceSnapshot,
  StoredSignalDraft,
} from "./store";

export type AccessErrorCode = "forbidden" | "not_found";

export interface AuthorizedMemberContext {
  readonly space: Space;
  readonly member: Member;
}

export type AccessResult<Result> =
  | Readonly<{ status: "ready"; value: Result }>
  | Readonly<{ status: "error"; code: AccessErrorCode }>;

export const authorizeMember = async (
  transaction: ConversationTransaction,
  actor: MemberActor,
  requireAnalysisConsent: boolean,
): Promise<AccessResult<AuthorizedMemberContext>> => {
  const space = await transaction.findSpace(actor.spaceId);
  const member = await transaction.findMember(actor.spaceId, actor.memberId);

  if (
    space?.status !== "active" ||
    member?.status !== "active" ||
    member.role !== actor.role ||
    (requireAnalysisConsent && member.analysisConsent !== "enabled")
  ) {
    return { code: "forbidden", status: "error" };
  }

  return {
    status: "ready",
    value: { member, space },
  };
};

export interface DraftSourceRequest {
  readonly privateMessageId: EntityId;
  readonly evidenceIds: readonly EntityId[];
}

export interface AuthorizedDraftSources {
  readonly message: PrivateMessage;
  readonly conversation: Conversation;
  readonly evidence: readonly ConversationEvidenceView[];
  readonly privateInputs: readonly string[];
  readonly snapshot: DraftSourceSnapshot;
}

export const loadAuthorizedDraftSources = async (
  transaction: ConversationTransaction,
  actor: MemberActor,
  request: Readonly<DraftSourceRequest>,
  requireAnalysisConsent: boolean,
): Promise<AccessResult<AuthorizedDraftSources>> => {
  const authorization = await authorizeMember(
    transaction,
    actor,
    requireAnalysisConsent,
  );

  if (authorization.status === "error") {
    return authorization;
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

  const conversation = await transaction.findConversation(
    actor.spaceId,
    message.conversationId,
  );

  if (
    conversation?.type !== "agent_dm" ||
    !conversation.participantMemberIds.includes(actor.memberId)
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

  return {
    status: "ready",
    value: {
      conversation,
      evidence,
      message,
      privateInputs: [
        message.content,
        ...evidence.map((view) => view.rawContent),
      ],
      snapshot: {
        conversationId: conversation.id,
        conversationVersion: conversation.version,
        evidence: evidence.map((view) => ({
          id: view.evidence.id,
          version: view.evidence.version,
        })),
        memberVersion: authorization.value.member.version,
        messageId: message.id,
        messageVersion: message.version,
        spaceVersion: authorization.value.space.version,
      },
    },
  };
};

export const sourceSnapshotsMatch = (
  expected: Readonly<DraftSourceSnapshot>,
  current: Readonly<DraftSourceSnapshot>,
): boolean =>
  expected.spaceVersion === current.spaceVersion &&
  expected.memberVersion === current.memberVersion &&
  expected.conversationId === current.conversationId &&
  expected.conversationVersion === current.conversationVersion &&
  expected.messageId === current.messageId &&
  expected.messageVersion === current.messageVersion &&
  expected.evidence.length === current.evidence.length &&
  expected.evidence.every((item, index) => {
    const currentItem = current.evidence[index];

    return currentItem?.id === item.id && currentItem.version === item.version;
  });

export const loadCurrentStoredDraftSources = (
  transaction: ConversationTransaction,
  actor: MemberActor,
  stored: Readonly<StoredSignalDraft>,
): Promise<AccessResult<AuthorizedDraftSources>> =>
  loadAuthorizedDraftSources(
    transaction,
    actor,
    {
      evidenceIds: stored.draft.evidenceIds,
      privateMessageId: stored.draft.sourceMessageId,
    },
    false,
  );

export const validateSharedVisibility = async (
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

export const isSharedVisibilityReadableBy = (
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
        visibility.subjectId === memberId ||
        visibility.memberIds.includes(memberId)
      );
  }
};
