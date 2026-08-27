import type {
  ConsentDecision,
  ContractErrorCode,
  EntityId,
  Member,
  MemberActor,
  SharedVisibility,
} from "../../../packages/contracts/src/index";

import type {
  ConfirmationState,
  ConsentAuthorizationState,
  DraftSourceState,
  MessageCreationState,
  PrivateEvidenceRecord,
} from "./persistence";

export type ConversationDenialCode = Extract<
  ContractErrorCode,
  | "conflict"
  | "consent_invalid"
  | "consent_required"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "stale_version"
  | "visibility_denied"
>;

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const sameMetadata = (
  left: Readonly<{
    id: EntityId;
    spaceId: EntityId;
    createdAt: string;
    updatedAt: string;
    version: number;
  }>,
  right: Readonly<{
    id: EntityId;
    spaceId: EntityId;
    createdAt: string;
    updatedAt: string;
    version: number;
  }>,
): boolean =>
  left.id === right.id &&
  left.spaceId === right.spaceId &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version;

const sameMember = (left: Member, right: Member): boolean =>
  sameMetadata(left, right) &&
  left.role === right.role &&
  left.displayName === right.displayName &&
  left.status === right.status &&
  left.joinedAt === right.joinedAt &&
  left.analysisConsent === right.analysisConsent;

export const visibilityMemberIds = (
  visibility: SharedVisibility,
): readonly EntityId[] => {
  if (visibility.kind === "space") {
    return [];
  }

  return visibility.kind === "care_related"
    ? [...new Set([visibility.subjectId, ...visibility.memberIds])]
    : [...new Set(visibility.memberIds)];
};

const sameVisibility = (
  left: SharedVisibility,
  right: SharedVisibility,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "space" && right.kind === "space") {
    return true;
  }
  if (left.kind === "members" && right.kind === "members") {
    return sameStringArray(left.memberIds, right.memberIds);
  }
  if (left.kind === "care_related" && right.kind === "care_related") {
    return (
      left.subjectId === right.subjectId &&
      sameStringArray(left.memberIds, right.memberIds)
    );
  }
  return false;
};

const hasExactActiveVisibilityMembers = (
  spaceId: EntityId,
  visibility: SharedVisibility,
  members: readonly Member[],
): boolean => {
  const expectedIds = visibilityMemberIds(visibility);
  const actualIds = new Set(members.map((member) => member.id));

  return (
    actualIds.size === expectedIds.length &&
    expectedIds.every((memberId) => actualIds.has(memberId)) &&
    members.every(
      (member) => member.spaceId === spaceId && member.status === "active",
    )
  );
};

const actorIsCurrent = (
  actor: MemberActor,
  member: Member,
): boolean =>
  member.id === actor.memberId &&
  member.spaceId === actor.spaceId &&
  member.role === actor.role &&
  member.status === "active";

export const authorizeMessageCreation = (
  actor: MemberActor,
  state: MessageCreationState | undefined,
): ConversationDenialCode | undefined => {
  if (state === undefined) {
    return "not_found";
  }
  if (state.space.id !== actor.spaceId || state.space.status !== "active") {
    return "forbidden";
  }
  if (!actorIsCurrent(actor, state.actorMember)) {
    return "forbidden";
  }
  if (
    state.conversation.spaceId !== actor.spaceId ||
    state.conversation.type !== "agent_dm" ||
    state.conversation.participantMemberIds.length !== 1 ||
    state.conversation.participantMemberIds[0] !== actor.memberId
  ) {
    return "not_found";
  }
  return undefined;
};

const authorizeEvidence = (
  actor: MemberActor,
  sourceMessageId: EntityId,
  records: readonly PrivateEvidenceRecord[],
): ConversationDenialCode | undefined => {
  if (records.length === 0) {
    return "not_found";
  }

  return records.every(
    (record) =>
      record.evidence.spaceId === actor.spaceId &&
      record.evidence.speakerId === actor.memberId &&
      record.evidence.visibility.memberId === actor.memberId &&
      record.evidence.state === "available" &&
      record.sourceMessageId === sourceMessageId,
  )
    ? undefined
    : "not_found";
};

export const authorizeDraftSource = (
  actor: MemberActor,
  state: DraftSourceState | undefined,
  expectedEvidenceIds: readonly EntityId[],
): ConversationDenialCode | undefined => {
  const creationDenial = authorizeMessageCreation(actor, state);
  if (creationDenial !== undefined || state === undefined) {
    return creationDenial;
  }
  if (state.actorMember.analysisConsent !== "enabled") {
    return "forbidden";
  }
  if (
    state.message.spaceId !== actor.spaceId ||
    state.message.conversationId !== state.conversation.id ||
    state.message.authorId !== actor.memberId ||
    state.message.visibility.memberId !== actor.memberId
  ) {
    return "not_found";
  }
  if (
    state.evidence.length !== expectedEvidenceIds.length ||
    state.evidence.some(
      (record, index) => record.evidence.id !== expectedEvidenceIds[index],
    )
  ) {
    return "not_found";
  }
  return authorizeEvidence(actor, state.message.id, state.evidence);
};

const sameEvidence = (
  left: PrivateEvidenceRecord,
  right: PrivateEvidenceRecord,
): boolean =>
  sameMetadata(left.evidence, right.evidence) &&
  left.evidence.sourceType === right.evidence.sourceType &&
  left.evidence.speakerId === right.evidence.speakerId &&
  left.evidence.occurredAt === right.evidence.occurredAt &&
  left.evidence.rawRef === right.evidence.rawRef &&
  left.evidence.visibility.memberId === right.evidence.visibility.memberId &&
  left.evidence.state === right.evidence.state &&
  left.sourceMessageId === right.sourceMessageId &&
  left.rawContent === right.rawContent;

const sameEvidenceSet = (
  left: readonly PrivateEvidenceRecord[],
  right: readonly PrivateEvidenceRecord[],
): boolean =>
  left.length === right.length &&
  left.every((record) => {
    const comparison = right.find(
      (candidate) => candidate.evidence.id === record.evidence.id,
    );
    return comparison !== undefined && sameEvidence(record, comparison);
  });

export const draftSourceIsUnchanged = (
  initial: DraftSourceState,
  current: DraftSourceState,
): boolean =>
  sameMetadata(initial.space, current.space) &&
  initial.space.name === current.space.name &&
  initial.space.createdBy === current.space.createdBy &&
  initial.space.status === current.space.status &&
  sameMember(initial.actorMember, current.actorMember) &&
  sameMetadata(initial.conversation, current.conversation) &&
  initial.conversation.type === current.conversation.type &&
  sameStringArray(
    initial.conversation.participantMemberIds,
    current.conversation.participantMemberIds,
  ) &&
  sameMetadata(initial.message, current.message) &&
  initial.message.conversationId === current.message.conversationId &&
  initial.message.authorId === current.message.authorId &&
  initial.message.clientMessageId === current.message.clientMessageId &&
  initial.message.content === current.message.content &&
  initial.message.occurredAt === current.message.occurredAt &&
  initial.message.visibility.memberId === current.message.visibility.memberId &&
  sameEvidenceSet(initial.evidence, current.evidence);

export const authorizeConsentDecision = (
  actor: MemberActor,
  state: ConsentAuthorizationState | undefined,
  visibility: SharedVisibility | null,
  authoritativeNow: string,
  decidedAt: string,
  expiresAt: string | null,
): ConversationDenialCode | undefined => {
  if (state === undefined) {
    return "not_found";
  }
  if (state.space.id !== actor.spaceId || state.space.status !== "active") {
    return "forbidden";
  }
  if (!actorIsCurrent(actor, state.actorMember)) {
    return "forbidden";
  }
  if (
    state.draft.spaceId !== actor.spaceId ||
    state.draft.speakerId !== actor.memberId
  ) {
    return "not_found";
  }
  if (state.existingDecision !== undefined) {
    return "consent_invalid";
  }
  const evidenceDenial = authorizeEvidence(
    actor,
    state.draft.sourceMessageId,
    state.evidence,
  );
  if (evidenceDenial !== undefined) {
    return "consent_invalid";
  }
  if (
    visibility !== null &&
    !hasExactActiveVisibilityMembers(
      actor.spaceId,
      visibility,
      state.visibilityMembers,
    )
  ) {
    return "visibility_denied";
  }
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(authoritativeNow)) {
    return "consent_invalid";
  }
  if (Date.parse(decidedAt) > Date.parse(authoritativeNow)) {
    return "consent_invalid";
  }
  return undefined;
};

const authorizeConsent = (
  actor: MemberActor,
  consent: ConsentDecision,
  draftId: EntityId,
  authoritativeNow: string,
): ConversationDenialCode | undefined => {
  if (
    consent.spaceId !== actor.spaceId ||
    consent.signalDraftId !== draftId ||
    consent.speakerId !== actor.memberId
  ) {
    return "consent_invalid";
  }
  if (consent.recordState === "discarded") {
    return "consent_required";
  }
  if (consent.recordState !== "active") {
    return "consent_invalid";
  }
  if (
    consent.expiresAt !== null &&
    Date.parse(consent.expiresAt) <= Date.parse(authoritativeNow)
  ) {
    return "consent_invalid";
  }
  return undefined;
};

export const authorizeConfirmation = (
  actor: MemberActor,
  state: ConfirmationState | undefined,
  expectedDraftVersion: number,
  authoritativeNow: string,
): ConversationDenialCode | undefined => {
  if (state === undefined) {
    return "not_found";
  }
  if (state.space.id !== actor.spaceId || state.space.status !== "active") {
    return "forbidden";
  }
  if (!actorIsCurrent(actor, state.actorMember)) {
    return "forbidden";
  }
  if (
    state.draft.spaceId !== actor.spaceId ||
    state.draft.speakerId !== actor.memberId ||
    state.sourceMessage.id !== state.draft.sourceMessageId ||
    state.sourceMessage.authorId !== actor.memberId ||
    state.sourceMessage.visibility.memberId !== actor.memberId ||
    state.conversation.id !== state.sourceMessage.conversationId ||
    state.conversation.type !== "agent_dm" ||
    state.conversation.participantMemberIds.length !== 1 ||
    state.conversation.participantMemberIds[0] !== actor.memberId
  ) {
    return "not_found";
  }
  if (state.draft.version !== expectedDraftVersion) {
    return "stale_version";
  }

  const consentDenial = authorizeConsent(
    actor,
    state.consent,
    state.draft.id,
    authoritativeNow,
  );
  if (consentDenial !== undefined) {
    return consentDenial;
  }
  if (state.consent.recordState !== "active") {
    return "consent_invalid";
  }
  const evidenceDenial = authorizeEvidence(
    actor,
    state.draft.sourceMessageId,
    state.evidence,
  );
  if (evidenceDenial !== undefined) {
    return "consent_invalid";
  }
  if (
    !hasExactActiveVisibilityMembers(
      actor.spaceId,
      state.consent.visibility,
      state.visibilityMembers,
    )
  ) {
    return "visibility_denied";
  }
  return undefined;
};

const sameConsent = (
  left: ConsentDecision,
  right: ConsentDecision,
): boolean => {
  if (
    !sameMetadata(left, right) ||
    left.recordState !== right.recordState ||
    left.outcome !== right.outcome ||
    left.signalDraftId !== right.signalDraftId ||
    left.speakerId !== right.speakerId ||
    left.decidedAt !== right.decidedAt ||
    left.expiresAt !== right.expiresAt ||
    left.revokedAt !== right.revokedAt
  ) {
    return false;
  }
  if (left.visibility === null || right.visibility === null) {
    return left.visibility === right.visibility;
  }
  return sameVisibility(left.visibility, right.visibility);
};

export const confirmationStateIsUnchanged = (
  initial: ConfirmationState,
  current: ConfirmationState,
): boolean =>
  draftSourceIsUnchanged(
    {
      actorMember: initial.actorMember,
      conversation: initial.conversation,
      evidence: initial.evidence,
      message: initial.sourceMessage,
      space: initial.space,
    },
    {
      actorMember: current.actorMember,
      conversation: current.conversation,
      evidence: current.evidence,
      message: current.sourceMessage,
      space: current.space,
    },
  ) &&
  sameMetadata(initial.draft, current.draft) &&
  initial.draft.speakerId === current.draft.speakerId &&
  initial.draft.sourceMessageId === current.draft.sourceMessageId &&
  sameStringArray(initial.draft.evidenceIds, current.draft.evidenceIds) &&
  initial.draft.kind === current.draft.kind &&
  initial.draft.redactedExcerpt === current.draft.redactedExcerpt &&
  initial.draft.proposedConclusion === current.draft.proposedConclusion &&
  initial.draft.candidateDomainId === current.draft.candidateDomainId &&
  initial.draft.confidence === current.draft.confidence &&
  sameStringArray(initial.draft.missingInfo, current.draft.missingInfo) &&
  initial.draft.promptVersion === current.draft.promptVersion &&
  initial.draft.source === current.draft.source &&
  sameConsent(initial.consent, current.consent) &&
  initial.visibilityMembers.length === current.visibilityMembers.length &&
  initial.visibilityMembers.every((member) => {
    const comparison = current.visibilityMembers.find(
      (candidate) => candidate.id === member.id,
    );
    return comparison !== undefined && sameMember(member, comparison);
  });

export const canReadSharedVisibility = (
  actorMemberId: EntityId,
  visibility: SharedVisibility,
): boolean => {
  switch (visibility.kind) {
    case "space":
      return true;
    case "members":
      return visibility.memberIds.includes(actorMemberId);
    case "care_related":
      return (
        visibility.subjectId === actorMemberId ||
        visibility.memberIds.includes(actorMemberId)
      );
  }
};
