import type { MemberRole } from "./model";

const isMemberRole = (value: unknown): value is MemberRole =>
  value === "subject" || value === "primary" || value === "partner";

/** Query selection is a demo viewport choice, never an authentication fact. */
export const selectFixtureRole = (value: string | readonly string[] | undefined): MemberRole => {
  const candidate = typeof value === "string" ? value : value?.[0];
  return isMemberRole(candidate) ? candidate : "primary";
};
