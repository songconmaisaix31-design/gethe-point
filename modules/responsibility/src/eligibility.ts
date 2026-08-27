import { z } from "zod";

import {
  DomainSchema,
  MemberActorSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  TaskSchema,
  type EntityId,
  type MemberActor,
  type SharedVisibility,
} from "../../../packages/contracts/src/index";

export const ResponsibilitySignalLinkSchema = z.strictObject({
  draft: SignalDraftSchema,
  signal: SharedSignalSchema.nullable(),
});
export type ResponsibilitySignalLink = z.infer<
  typeof ResponsibilitySignalLinkSchema
>;

export const ResponsibilityTaskFactSchema = z.strictObject({
  task: TaskSchema,
  sourceLinks: z.array(ResponsibilitySignalLinkSchema).min(1).max(20),
});
export type ResponsibilityTaskFact = z.infer<
  typeof ResponsibilityTaskFactSchema
>;

export const ResponsibilityDomainFactSchema = z.strictObject({
  domain: DomainSchema,
  sourceLinks: z.array(ResponsibilitySignalLinkSchema).min(1).max(20),
});
export type ResponsibilityDomainFact = z.infer<
  typeof ResponsibilityDomainFactSchema
>;

export type EligibilityFailure =
  | "discussion_only"
  | "evidence_missing"
  | "high_risk"
  | "needs_review"
  | "signal_not_authorized"
  | "signal_not_confirmed"
  | "signal_not_responsibility"
  | "visibility_denied";

export type EligibilityAssessment =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false; reason: EligibilityFailure }>;

export const canReadSharedVisibility = (
  actor: MemberActor,
  recordSpaceId: EntityId,
  visibility: SharedVisibility,
): boolean => {
  if (actor.spaceId !== recordSpaceId) {
    return false;
  }

  switch (visibility.kind) {
    case "space":
      return true;
    case "members":
      return visibility.memberIds.includes(actor.memberId);
    case "care_related":
      return (
        visibility.subjectId === actor.memberId ||
        visibility.memberIds.includes(actor.memberId)
      );
  }
};

const isLinkedSignal = (
  spaceId: EntityId,
  link: ResponsibilitySignalLink,
): boolean =>
  link.signal !== null &&
  link.draft.spaceId === spaceId &&
  link.signal.spaceId === spaceId &&
  link.draft.speakerId === link.signal.speakerId;

export const hasActorVisiblePersistedSignal = (
  actor: MemberActor,
  spaceId: EntityId,
  sourceLinks: readonly ResponsibilitySignalLink[],
): boolean =>
  sourceLinks.some(
    (link) =>
      isLinkedSignal(spaceId, link) &&
      link.signal !== null &&
      canReadSharedVisibility(actor, spaceId, link.signal.visibility),
  );

export const hasActorVisibleResponsibilitySignal = (
  actor: MemberActor,
  spaceId: EntityId,
  sourceLinks: readonly ResponsibilitySignalLink[],
): boolean =>
  sourceLinks.some(
    (link) =>
      link.draft.kind === "potential_task" &&
      isLinkedSignal(spaceId, link) &&
      link.signal !== null &&
      link.signal.purpose === "responsibility" &&
      canReadSharedVisibility(actor, spaceId, link.signal.visibility),
  );

const assessAuthorizedSignal = (
  actor: MemberActor,
  spaceId: EntityId,
  evidenceIds: readonly EntityId[],
  sourceLinks: readonly ResponsibilitySignalLink[],
): EligibilityAssessment => {
  if (sourceLinks.some(({ draft }) => draft.kind === "high_risk")) {
    return { eligible: false, reason: "high_risk" };
  }

  const potentialTaskLinks = sourceLinks.filter(
    ({ draft }) => draft.kind === "potential_task",
  );

  if (potentialTaskLinks.length === 0) {
    return { eligible: false, reason: "discussion_only" };
  }

  const confirmedLinks = potentialTaskLinks.filter((link) =>
    isLinkedSignal(spaceId, link),
  );

  if (confirmedLinks.length === 0) {
    return { eligible: false, reason: "signal_not_confirmed" };
  }

  const responsibilityLinks = confirmedLinks.filter(
    ({ signal }) => signal?.purpose === "responsibility",
  );

  if (responsibilityLinks.length === 0) {
    return { eligible: false, reason: "signal_not_responsibility" };
  }

  const visibleLinks = responsibilityLinks.filter(
    ({ signal }) =>
      signal !== null &&
      canReadSharedVisibility(actor, spaceId, signal.visibility),
  );

  if (visibleLinks.length === 0) {
    return { eligible: false, reason: "signal_not_authorized" };
  }

  const availableLinks = visibleLinks.filter(
    ({ signal }) =>
      signal !== null &&
      signal.evidenceState === "available" &&
      signal.provenance.every(({ state }) => state === "available"),
  );

  if (availableLinks.length === 0) {
    return { eligible: false, reason: "evidence_missing" };
  }

  const authorizedEvidenceIds = new Set<EntityId>();

  for (const { draft, signal } of availableLinks) {
    if (signal !== null) {
      const draftEvidenceIds = new Set(draft.evidenceIds);
      for (const evidence of signal.provenance) {
        if (draftEvidenceIds.has(evidence.evidenceId)) {
          authorizedEvidenceIds.add(evidence.evidenceId);
        }
      }
    }
  }

  if (!evidenceIds.every((evidenceId) => authorizedEvidenceIds.has(evidenceId))) {
    return { eligible: false, reason: "evidence_missing" };
  }

  return { eligible: true };
};

export const assessTaskEligibility = (
  actor: MemberActor,
  fact: ResponsibilityTaskFact,
): EligibilityAssessment => {
  if (
    !canReadSharedVisibility(actor, fact.task.spaceId, fact.task.visibility)
  ) {
    return { eligible: false, reason: "visibility_denied" };
  }

  if (fact.task.reviewState === "needs_review") {
    return { eligible: false, reason: "needs_review" };
  }

  return assessAuthorizedSignal(
    actor,
    fact.task.spaceId,
    fact.task.evidenceIds,
    fact.sourceLinks,
  );
};

export const assessDomainEligibility = (
  actor: MemberActor,
  fact: ResponsibilityDomainFact,
): EligibilityAssessment => {
  if (
    fact.domain.status !== "active" ||
    !canReadSharedVisibility(actor, fact.domain.spaceId, fact.domain.visibility)
  ) {
    return {
      eligible: false,
      reason:
        fact.domain.status === "needs_review"
          ? "needs_review"
          : "visibility_denied",
    };
  }

  return assessAuthorizedSignal(
    actor,
    fact.domain.spaceId,
    fact.domain.evidenceIds,
    fact.sourceLinks,
  );
};

export const parseMemberActor = (input: unknown): MemberActor =>
  MemberActorSchema.parse(input);
