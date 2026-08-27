import type {
  Domain,
  EntityId,
  Member,
  MemberActor,
  ResponsibilityAttribution,
  SharedVisibility,
  Task,
} from "../../../packages/contracts/src/index";

import { createResponsibilityError } from "./errors";
import type {
  ReadyResponsibilityDraft,
  ResponsibilitySourceContext,
  ResponsibilitySourceGuard,
  VersionGuardEntry,
} from "./model";
import {
  canReadSharedVisibility,
  doesNotWidenVisibility,
} from "./visibility";

const idsAreExact = (
  left: readonly EntityId[],
  right: readonly EntityId[],
): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((id) => rightSet.has(id))
  );
};

const visibilityIsExact = (
  left: SharedVisibility,
  right: SharedVisibility,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "space":
      return true;
    case "members":
      return (
        right.kind === "members" &&
        idsAreExact(left.memberIds, right.memberIds)
      );
    case "care_related":
      return (
        right.kind === "care_related" &&
        left.subjectId === right.subjectId &&
        idsAreExact(left.memberIds, right.memberIds)
      );
  }
};

const uniqueMembers = (members: readonly Member[]): boolean =>
  new Set(members.map(({ id }) => id)).size === members.length;

const findActiveMember = (
  members: readonly Member[],
  memberId: EntityId,
  spaceId: EntityId,
): Member | undefined =>
  members.find(
    ({ id, spaceId: memberSpaceId, status }) =>
      id === memberId && memberSpaceId === spaceId && status === "active",
  );

const memberFactsMatch = (left: Member, right: Member): boolean =>
  left.id === right.id &&
  left.spaceId === right.spaceId &&
  left.createdAt === right.createdAt &&
  left.updatedAt === right.updatedAt &&
  left.version === right.version &&
  left.role === right.role &&
  left.displayName === right.displayName &&
  left.status === right.status &&
  left.joinedAt === right.joinedAt &&
  left.analysisConsent === right.analysisConsent;

const attributionIds = (
  attribution: ResponsibilityAttribution,
): readonly EntityId[] =>
  [
    attribution.discoveredBy,
    attribution.deadlineKeptBy,
    attribution.scheduledBy,
    attribution.executedBy,
    attribution.followedUpBy,
  ].filter((memberId): memberId is EntityId => memberId !== null);

export const taskAttribution = (
  task: Task,
): ResponsibilityAttribution => ({
  discoveredBy: task.discoveredBy,
  deadlineKeptBy: task.deadlineKeptBy,
  scheduledBy: task.scheduledBy,
  executedBy: task.executedBy,
  followedUpBy: task.followedUpBy,
});

export const attributionUsesActiveMembers = (
  attribution: ResponsibilityAttribution,
  members: readonly Member[],
  spaceId: EntityId,
): boolean =>
  attributionIds(attribution).every(
    (memberId) => findActiveMember(members, memberId, spaceId) !== undefined,
  );

export const validateActorAndSpace = (
  actor: MemberActor,
  context: Pick<ResponsibilitySourceContext, "actorMember" | "members" | "space">,
): void => {
  if (
    context.space.id !== actor.spaceId ||
    context.space.spaceId !== actor.spaceId ||
    context.space.status !== "active"
  ) {
    throw createResponsibilityError("not_found");
  }

  if (!uniqueMembers(context.members)) {
    throw createResponsibilityError("internal_failure");
  }

  const actorMember = findActiveMember(
    context.members,
    actor.memberId,
    actor.spaceId,
  );

  if (
    actorMember === undefined ||
    context.actorMember.id !== actor.memberId ||
    context.actorMember.spaceId !== actor.spaceId ||
    context.actorMember.status !== "active" ||
    context.actorMember.role !== actor.role ||
    actorMember.role !== actor.role ||
    !memberFactsMatch(context.actorMember, actorMember)
  ) {
    throw createResponsibilityError("forbidden");
  }
};

export const validateResponsibilitySource = (
  actor: MemberActor,
  context: ResponsibilitySourceContext,
  now: Date,
  requireAnalysisConsent = false,
): void => {
  validateActorAndSpace(actor, context);

  const { consent, draft, evidence, signal, speaker, space } = context;
  const allSameSpace = [
    context.actorMember,
    speaker,
    draft,
    consent,
    signal,
    ...evidence,
    ...context.members,
  ].every(({ spaceId }) => spaceId === actor.spaceId);

  if (!allSameSpace) {
    throw createResponsibilityError("not_found");
  }

  const persistedSpeaker = findActiveMember(
    context.members,
    speaker.id,
    space.id,
  );

  if (
    speaker.id !== signal.speakerId ||
    speaker.id !== draft.speakerId ||
    speaker.status !== "active" ||
    persistedSpeaker === undefined ||
    !memberFactsMatch(speaker, persistedSpeaker)
  ) {
    throw createResponsibilityError("forbidden");
  }

  if (requireAnalysisConsent && speaker.analysisConsent !== "enabled") {
    throw createResponsibilityError("consent_invalid");
  }

  if (draft.kind !== "potential_task" || draft.missingInfo.length > 0) {
    throw createResponsibilityError("needs_human_review");
  }

  if (
    consent.recordState !== "active" ||
    consent.signalDraftId !== draft.id ||
    consent.speakerId !== speaker.id ||
    signal.consentDecisionId !== consent.id ||
    !visibilityIsExact(signal.visibility, consent.visibility) ||
    (consent.expiresAt !== null && Date.parse(consent.expiresAt) <= now.getTime())
  ) {
    throw createResponsibilityError("consent_invalid");
  }

  if (!canReadSharedVisibility(actor.memberId, signal.visibility, context.members)) {
    throw createResponsibilityError("forbidden");
  }

  if (
    signal.evidenceState !== "available" ||
    signal.provenance.some(({ state }) => state !== "available") ||
    evidence.some(({ state }) => state !== "available")
  ) {
    throw createResponsibilityError("evidence_missing");
  }

  const draftEvidenceIds = draft.evidenceIds;
  const signalEvidenceIds = signal.provenance.map(({ evidenceId }) => evidenceId);
  const evidenceIds = evidence.map(({ id }) => id);

  if (
    !idsAreExact(draftEvidenceIds, signalEvidenceIds) ||
    !idsAreExact(signalEvidenceIds, evidenceIds) ||
    signal.provenance.some(({ speakerId }) => speakerId !== speaker.id) ||
    evidence.some(({ speakerId }) => speakerId !== speaker.id) ||
    signal.provenance.some((provenance) => {
      const persistedEvidence = evidence.find(
        ({ id }) => id === provenance.evidenceId,
      );

      return (
        persistedEvidence?.sourceType !== provenance.sourceType ||
        persistedEvidence.speakerId !== provenance.speakerId ||
        persistedEvidence.occurredAt !== provenance.occurredAt ||
        persistedEvidence.state !== provenance.state
      );
    })
  ) {
    throw createResponsibilityError("evidence_missing");
  }
};

const validateDraftVisibility = (
  actor: MemberActor,
  sourceVisibility: SharedVisibility,
  candidateVisibility: SharedVisibility,
  members: readonly Member[],
): void => {
  if (
    !canReadSharedVisibility(actor.memberId, candidateVisibility, members) ||
    !doesNotWidenVisibility(candidateVisibility, sourceVisibility, members)
  ) {
    throw createResponsibilityError("forbidden");
  }
};

export const validateReadyDraft = (
  actor: MemberActor,
  context: ResponsibilitySourceContext,
  draft: ReadyResponsibilityDraft,
): void => {
  const { domain, task } = draft;
  const expectedEvidenceIds = context.evidence.map(({ id }) => id);

  if (
    domain.spaceId !== actor.spaceId ||
    task.spaceId !== actor.spaceId ||
    task.domainId !== domain.id ||
    domain.status !== "active" ||
    task.status === "cancelled" ||
    task.reviewState !== "current" ||
    (context.draft.candidateDomainId !== null &&
      context.draft.candidateDomainId !== domain.id) ||
    !idsAreExact(domain.evidenceIds, expectedEvidenceIds) ||
    !idsAreExact(task.evidenceIds, expectedEvidenceIds)
  ) {
    throw createResponsibilityError("invalid_request");
  }

  validateDraftVisibility(
    actor,
    context.signal.visibility,
    domain.visibility,
    context.members,
  );
  validateDraftVisibility(
    actor,
    context.signal.visibility,
    task.visibility,
    context.members,
  );

  if (
    (domain.ownerId !== null &&
      findActiveMember(context.members, domain.ownerId, actor.spaceId) ===
        undefined) ||
    !attributionUsesActiveMembers(
      taskAttribution(task),
      context.members,
      actor.spaceId,
    )
  ) {
    throw createResponsibilityError("forbidden");
  }
};

const versionEntry = ({ id, version }: VersionGuardEntry): VersionGuardEntry => ({
  id,
  version,
});

const versionEntries = (
  values: readonly VersionGuardEntry[],
): VersionGuardEntry[] =>
  values
    .map(versionEntry)
    .sort(({ id: left }, { id: right }) => left.localeCompare(right));

export const responsibilitySourceGuard = (
  context: ResponsibilitySourceContext,
): ResponsibilitySourceGuard => ({
  actorMember: versionEntry(context.actorMember),
  consent: versionEntry(context.consent),
  draft: versionEntry(context.draft),
  evidence: versionEntries(context.evidence),
  members: versionEntries(context.members),
  signal: versionEntry(context.signal),
  space: versionEntry(context.space),
  speaker: versionEntry(context.speaker),
});

export const domainAndTaskMatchSource = (
  domain: Domain,
  task: Task,
  source: ResponsibilitySourceContext,
): boolean =>
  domain.id === task.domainId &&
  domain.spaceId === source.space.id &&
  task.spaceId === source.space.id &&
  idsAreExact(domain.evidenceIds, source.evidence.map(({ id }) => id)) &&
  idsAreExact(task.evidenceIds, source.evidence.map(({ id }) => id));
