import type {
  EntityId,
  Member,
  SharedVisibility,
} from "../../../packages/contracts/src/index";

const activeMemberIds = (members: readonly Member[]): Set<EntityId> =>
  new Set(
    members
      .filter(({ status }) => status === "active")
      .map(({ id }) => id),
  );

export const visibilityAudience = (
  visibility: SharedVisibility,
  members: readonly Member[],
): ReadonlySet<EntityId> => {
  switch (visibility.kind) {
    case "space":
      return activeMemberIds(members);
    case "members":
    case "care_related":
      return new Set(visibility.memberIds);
  }
};

export const canReadSharedVisibility = (
  memberId: EntityId,
  visibility: SharedVisibility,
  members: readonly Member[],
): boolean => visibilityAudience(visibility, members).has(memberId);

export const doesNotWidenVisibility = (
  candidate: SharedVisibility,
  source: SharedVisibility,
  members: readonly Member[],
): boolean => {
  const candidateAudience = visibilityAudience(candidate, members);
  const sourceAudience = visibilityAudience(source, members);

  return [...candidateAudience].every((memberId) =>
    sourceAudience.has(memberId),
  );
};
