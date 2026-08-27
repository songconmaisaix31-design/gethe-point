import type { SharedVisibility } from "../../../packages/contracts/src/index";

export const hasUniqueIds = (ids: readonly string[]): boolean =>
  new Set(ids).size === ids.length;

export const canMemberReadVisibility = (
  visibility: SharedVisibility,
  memberId: string,
): boolean => {
  switch (visibility.kind) {
    case "space":
      return true;
    case "members":
      return (
        hasUniqueIds(visibility.memberIds) &&
        visibility.memberIds.includes(memberId)
      );
    case "care_related":
      return (
        hasUniqueIds(visibility.memberIds) &&
        (visibility.subjectId === memberId ||
          visibility.memberIds.includes(memberId))
      );
  }
};

const visibilityKey = (visibility: SharedVisibility): string => {
  switch (visibility.kind) {
    case "space":
      return "space";
    case "members":
      return `members:${[...visibility.memberIds].sort().join(",")}`;
    case "care_related":
      return `care_related:${visibility.subjectId}:${[
        ...visibility.memberIds,
      ]
        .sort()
        .join(",")}`;
  }
};

export const sharedVisibilitiesMatch = (
  left: SharedVisibility,
  right: SharedVisibility,
): boolean => visibilityKey(left) === visibilityKey(right);
