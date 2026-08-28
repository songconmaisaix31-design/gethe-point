import type { Visibility } from "../contracts.ts";

export function canView(
  visibility: Visibility,
  viewerId: string,
  ownerId: string,
): boolean {
  if (visibility === "self") {
    return viewerId === ownerId;
  }

  if (typeof visibility === "object") {
    return viewerId === ownerId || visibility.members.includes(viewerId);
  }

  return true;
}
