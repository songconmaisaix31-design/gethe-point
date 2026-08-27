import type {
  Member,
  MemberActor,
  ResponsibilityStage,
  SharedVisibility,
  Task,
} from "../../../packages/contracts/src/index";

import {
  RESPONSIBILITY_STAGES,
  canMemberReadVisibility,
  hasUniqueIds,
  sharedVisibilitiesMatch,
  type PersistedEvidenceSnapshot,
  type VersionGuardEntry,
} from "../../responsibility";
import type {
  DomainSuggestionContext,
  DomainSuggestionGuard,
  DomainSuggestionRequest,
  DomainSuggestionSelection,
} from "./model";

export const MAX_PROVIDER_INPUT_BYTES = 8_000;

export type DomainContextFailureCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "stale_version"
  | "evidence_missing";

export type DomainContextValidation =
  | Readonly<{
      ok: true;
      guard: DomainSuggestionGuard;
      visibility: SharedVisibility;
      redactedInput: string;
    }>
  | Readonly<{ ok: false; code: DomainContextFailureCode }>;

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  hasUniqueIds(left) &&
  hasUniqueIds(right) &&
  left.every((id) => right.includes(id));

const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids)];

const referencesMatch = (
  expected: readonly VersionGuardEntry[],
  actual: readonly VersionGuardEntry[],
): boolean => {
  if (!sameIds(expected.map(({ id }) => id), actual.map(({ id }) => id))) {
    return false;
  }
  const actualById = new Map(actual.map((entry) => [entry.id, entry.version]));
  return expected.every(
    ({ id, version }) => actualById.get(id) === version,
  );
};

const guardEntry = ({ id, version }: VersionGuardEntry): VersionGuardEntry => ({
  id,
  version,
});

const sortedGuardEntries = (
  records: readonly VersionGuardEntry[],
): VersionGuardEntry[] =>
  records.map(guardEntry).sort((left, right) => left.id.localeCompare(right.id));

const requiredTaskMemberIds = (tasks: readonly Task[]): string[] =>
  uniqueIds(
    tasks.flatMap((task) =>
      RESPONSIBILITY_STAGES.flatMap((stage: ResponsibilityStage) => {
        const memberId = task[stage];
        return memberId === null ? [] : [memberId];
      }),
    ),
  );

const provenanceMatchesEvidence = (
  context: DomainSuggestionContext,
  evidenceById: ReadonlyMap<string, PersistedEvidenceSnapshot>,
): boolean =>
  context.signals.every(({ signal }) => {
    const provenanceIds = signal.provenance.map(({ evidenceId }) => evidenceId);
    return (
      hasUniqueIds(provenanceIds) &&
      signal.provenance.every((provenance) => {
        const evidence = evidenceById.get(provenance.evidenceId);
        return (
          evidence?.state === "available" &&
          provenance.state === "available" &&
          signal.speakerId === provenance.speakerId &&
          provenance.speakerId === evidence.speakerId &&
          provenance.sourceType === evidence.sourceType &&
          provenance.occurredAt === evidence.occurredAt
        );
      })
    );
  });

const sourceMembersAreCurrent = (
  members: readonly Member[],
  requiredMemberIds: readonly string[],
  spaceId: string,
): boolean => {
  if (!sameIds(members.map(({ id }) => id), requiredMemberIds)) {
    return false;
  }
  return members.every(
    (member) =>
      member.spaceId === spaceId &&
      member.status === "active" &&
      member.analysisConsent === "enabled",
  );
};

const commonVisibility = (
  context: DomainSuggestionContext,
): SharedVisibility | undefined => {
  const [firstTask] = context.tasks;
  if (firstTask === undefined) {
    return undefined;
  }
  const visibilities = [
    ...context.tasks.map(({ visibility }) => visibility),
    ...context.signals.map(({ signal }) => signal.visibility),
  ];
  return visibilities.every((visibility) =>
    sharedVisibilitiesMatch(firstTask.visibility, visibility),
  )
    ? firstTask.visibility
    : undefined;
};

const providerPayload = (context: DomainSuggestionContext): string =>
  JSON.stringify({
    signals: context.signals.map(({ signal }, index) => ({
      ref: `signal-${String(index + 1)}`,
      excerpt: signal.redactedExcerpt,
      sourceTypes: [
        ...new Set(signal.provenance.map(({ sourceType }) => sourceType)),
      ].sort(),
    })),
  });

const persistentIdentifiers = (context: DomainSuggestionContext): string[] =>
  uniqueIds([
    context.space.id,
    context.space.createdBy,
    ...context.members.map(({ id }) => id),
    ...context.tasks.flatMap((task) => [
      task.id,
      task.domainId,
      ...task.evidenceIds,
      ...RESPONSIBILITY_STAGES.flatMap((stage) => {
        const memberId = task[stage];
        return memberId === null ? [] : [memberId];
      }),
    ]),
    ...context.signals.flatMap(({ signal }) => [
      signal.id,
      signal.speakerId,
      signal.consentDecisionId,
      ...signal.provenance.map(({ evidenceId }) => evidenceId),
    ]),
    ...context.evidence.flatMap((evidence) => [evidence.id, evidence.speakerId]),
  ]);

const providerInputIsSafe = (
  redactedInput: string,
  context: DomainSuggestionContext,
): boolean =>
  new TextEncoder().encode(redactedInput).byteLength <=
    MAX_PROVIDER_INPUT_BYTES &&
  persistentIdentifiers(context).every(
    (identifier) => !redactedInput.includes(identifier),
  );

export const selectionFromRequest = (
  request: DomainSuggestionRequest,
): DomainSuggestionSelection => ({
  spaceId: request.spaceId,
  expectedSpaceVersion: request.expectedSpaceVersion,
  expectedActorVersion: request.expectedActorVersion,
  tasks: request.tasks,
  signals: request.signals,
  evidence: request.evidence,
});

export const validateDomainSuggestionContext = (
  context: DomainSuggestionContext,
  actor: MemberActor,
  selection: DomainSuggestionSelection,
): DomainContextValidation => {
  if (
    actor.spaceId !== selection.spaceId ||
    context.space.id !== actor.spaceId ||
    context.actorMember.id !== actor.memberId ||
    context.actorMember.spaceId !== actor.spaceId ||
    context.actorMember.role !== actor.role
  ) {
    return { ok: false, code: "not_found" };
  }
  if (
    context.space.version !== selection.expectedSpaceVersion ||
    context.actorMember.version !== selection.expectedActorVersion ||
    !referencesMatch(selection.tasks, context.tasks) ||
    !referencesMatch(
      selection.signals,
      context.signals.map(({ signal }) => signal),
    ) ||
    !referencesMatch(selection.evidence, context.evidence)
  ) {
    return { ok: false, code: "stale_version" };
  }
  if (context.space.status !== "active") {
    return { ok: false, code: "not_found" };
  }

  const allInSpace =
    context.members.every(({ spaceId }) => spaceId === actor.spaceId) &&
    context.tasks.every(({ spaceId }) => spaceId === actor.spaceId) &&
    context.signals.every(
      ({ signal }) => signal.spaceId === actor.spaceId,
    ) &&
    context.evidence.every(({ spaceId }) => spaceId === actor.spaceId);
  if (!allInSpace) {
    return { ok: false, code: "not_found" };
  }

  const requiredMemberIds = uniqueIds([
    actor.memberId,
    ...context.signals.map(({ signal }) => signal.speakerId),
    ...requiredTaskMemberIds(context.tasks),
  ]);
  if (
    !sourceMembersAreCurrent(context.members, requiredMemberIds, actor.spaceId) ||
    context.actorMember.status !== "active" ||
    context.actorMember.analysisConsent !== "enabled" ||
    !context.members.some(
      ({ id, version }) =>
        id === context.actorMember.id && version === context.actorMember.version,
    )
  ) {
    return { ok: false, code: "forbidden" };
  }

  const evidenceById = new Map(
    context.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const selectedEvidenceIds = selection.evidence.map(({ id }) => id);
  const taskEvidenceIds = uniqueIds(
    context.tasks.flatMap(({ evidenceIds }) => evidenceIds),
  );
  const signalEvidenceIds = uniqueIds(
    context.signals.flatMap(({ signal }) =>
      signal.provenance.map(({ evidenceId }) => evidenceId),
    ),
  );
  if (
    !sameIds(taskEvidenceIds, selectedEvidenceIds) ||
    !sameIds(signalEvidenceIds, selectedEvidenceIds)
  ) {
    return { ok: false, code: "not_found" };
  }
  if (
    context.evidence.some(({ state }) => state !== "available") ||
    !provenanceMatchesEvidence(context, evidenceById)
  ) {
    return { ok: false, code: "evidence_missing" };
  }

  const visibility = commonVisibility(context);
  if (
    visibility === undefined ||
    !canMemberReadVisibility(visibility, actor.memberId) ||
    context.tasks.some(
      (task) =>
        task.reviewState !== "current" ||
        task.status === "cancelled" ||
        !hasUniqueIds(task.evidenceIds) ||
        !canMemberReadVisibility(task.visibility, actor.memberId),
    ) ||
    context.signals.some(
      ({ signal, sourceKind }) =>
        sourceKind !== "potential_task" ||
        signal.purpose !== "responsibility" ||
        signal.evidenceState !== "available" ||
        !canMemberReadVisibility(signal.visibility, actor.memberId),
    )
  ) {
    return { ok: false, code: "forbidden" };
  }

  const redactedInput = providerPayload(context);
  if (!providerInputIsSafe(redactedInput, context)) {
    return { ok: false, code: "invalid_request" };
  }

  return {
    ok: true,
    visibility,
    redactedInput,
    guard: {
      space: guardEntry(context.space),
      actorMember: guardEntry(context.actorMember),
      members: sortedGuardEntries(context.members),
      tasks: sortedGuardEntries(context.tasks),
      signals: sortedGuardEntries(
        context.signals.map(({ signal }) => signal),
      ),
      evidence: sortedGuardEntries(context.evidence),
    },
  };
};

const guardKey = (guard: DomainSuggestionGuard): string =>
  JSON.stringify({
    space: guard.space,
    actorMember: guard.actorMember,
    members: sortedGuardEntries(guard.members),
    tasks: sortedGuardEntries(guard.tasks),
    signals: sortedGuardEntries(guard.signals),
    evidence: sortedGuardEntries(guard.evidence),
  });

export const domainSuggestionGuardsMatch = (
  left: DomainSuggestionGuard,
  right: DomainSuggestionGuard,
): boolean => guardKey(left) === guardKey(right);
