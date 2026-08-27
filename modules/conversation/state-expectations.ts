import { createHash } from "node:crypto";

import type { SharedVisibility } from "../../packages/contracts/src/index";
import type {
  AnalysisContext,
  AnalysisExpectedState,
  ConfirmationContext,
  ConfirmationExpectedState,
  ConsentContext,
  ConsentExpectedState,
  ConversationExpectation,
  EvidenceExpectation,
  MemberExpectation,
  MessageCreationContext,
  MessageCreationExpectedState,
  MessageExpectation,
  SpaceExpectation,
} from "./ports";

const digest = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sortIds = (ids: readonly string[]): string[] =>
  [...ids].sort((left, right) => left.localeCompare(right));

const normalizeVisibility = (
  visibility: SharedVisibility,
): SharedVisibility => {
  switch (visibility.kind) {
    case "space":
      return { kind: "space" };
    case "members":
      return { kind: "members", memberIds: sortIds(visibility.memberIds) };
    case "care_related":
      return {
        kind: "care_related",
        subjectId: visibility.subjectId,
        memberIds: sortIds(visibility.memberIds),
      };
  }
};

const expectSpace = (
  space: MessageCreationContext["space"],
): SpaceExpectation => ({
  id: space.id,
  spaceId: space.spaceId,
  status: space.status,
  version: space.version,
});

const expectMember = (
  member: MessageCreationContext["actor"],
): MemberExpectation => ({
  id: member.id,
  spaceId: member.spaceId,
  status: member.status,
  role: member.role,
  analysisConsent: member.analysisConsent,
  version: member.version,
});

const expectConversation = (
  conversation: MessageCreationContext["conversation"],
): ConversationExpectation => ({
  id: conversation.id,
  spaceId: conversation.spaceId,
  type: conversation.type,
  participantMemberIds: sortIds(conversation.participantMemberIds),
  version: conversation.version,
});

const expectMessage = (context: AnalysisContext): MessageExpectation => ({
  id: context.message.id,
  spaceId: context.message.spaceId,
  conversationId: context.message.conversationId,
  authorId: context.message.authorId,
  visibleToMemberId: context.message.visibility.memberId,
  contentDigest: digest(context.message.content),
  version: context.message.version,
});

const expectEvidence = (
  context: AnalysisContext | ConsentContext,
): readonly EvidenceExpectation[] =>
  [...context.evidence]
    .sort((left, right) =>
      left.evidence.id.localeCompare(right.evidence.id),
    )
    .map(({ evidence, rawContent, sourceMessageId }) => ({
      id: evidence.id,
      spaceId: evidence.spaceId,
      speakerId: evidence.speakerId,
      visibleToMemberId: evidence.visibility.memberId,
      sourceMessageId,
      state: evidence.state,
      rawContentDigest: digest(rawContent),
      version: evidence.version,
    }));

const expectDraft = (context: ConsentContext) => ({
  id: context.draft.id,
  spaceId: context.draft.spaceId,
  speakerId: context.draft.speakerId,
  sourceMessageId: context.draft.sourceMessageId,
  evidenceIds: sortIds(context.draft.evidenceIds),
  kind: context.draft.kind,
  contentDigest: digest(
    JSON.stringify({
      redactedExcerpt: context.draft.redactedExcerpt,
      proposedConclusion: context.draft.proposedConclusion,
      candidateDomainId: context.draft.candidateDomainId,
      confidence: context.draft.confidence,
      missingInfo: context.draft.missingInfo,
      promptVersion: context.draft.promptVersion,
      source: context.draft.source,
    }),
  ),
  version: context.draft.version,
});

export const captureMessageCreationExpectedState = (
  context: MessageCreationContext,
): MessageCreationExpectedState => ({
  space: expectSpace(context.space),
  actor: expectMember(context.actor),
  conversation: expectConversation(context.conversation),
});

export const captureAnalysisExpectedState = (
  context: AnalysisContext,
): AnalysisExpectedState => ({
  ...captureMessageCreationExpectedState(context),
  message: expectMessage(context),
  evidence: expectEvidence(context),
});

export const captureConsentExpectedState = (
  context: ConsentContext,
): ConsentExpectedState => ({
  space: expectSpace(context.space),
  actor: expectMember(context.actor),
  draft: expectDraft(context),
  evidence: expectEvidence(context),
  visibilityMembers: [...context.visibilityMembers]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(expectMember),
});

export const captureConfirmationExpectedState = (
  context: ConfirmationContext,
): ConfirmationExpectedState | undefined => {
  if (context.consent === undefined) {
    return undefined;
  }

  return {
    ...captureConsentExpectedState(context),
    consent: {
      id: context.consent.id,
      spaceId: context.consent.spaceId,
      signalDraftId: context.consent.signalDraftId,
      speakerId: context.consent.speakerId,
      recordState: context.consent.recordState,
      outcome: context.consent.outcome,
      visibility:
        context.consent.visibility === null
          ? null
          : normalizeVisibility(context.consent.visibility),
      expiresAt: context.consent.expiresAt,
      revokedAt: context.consent.revokedAt,
      version: context.consent.version,
    },
  };
};

export const expectedStateMatches = (
  left: object,
  right: object,
): boolean => JSON.stringify(left) === JSON.stringify(right);
