import type {
  MemberActor,
  SharedVisibility,
} from "../../../packages/contracts/src/index";

const sortedMemberIds = (memberIds: readonly string[]): readonly string[] =>
  [...memberIds].sort((left, right) => left.localeCompare(right));

/**
 * Checks only a shared-record visibility predicate. Callers must independently
 * establish that the actor is an active member of the record's space.
 */
export const canMemberReadVisibility = (
  actor: MemberActor,
  visibility: SharedVisibility,
): boolean => {
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

/**
 * Domain suggestions require one exact shared scope so confirmation cannot
 * silently widen a narrower source fact.
 */
export const sharedVisibilitiesMatch = (
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
        JSON.stringify(sortedMemberIds(left.memberIds)) ===
          JSON.stringify(sortedMemberIds(right.memberIds))
      );
    case "care_related":
      return (
        right.kind === "care_related" &&
        left.subjectId === right.subjectId &&
        JSON.stringify(sortedMemberIds(left.memberIds)) ===
          JSON.stringify(sortedMemberIds(right.memberIds))
      );
  }
};
