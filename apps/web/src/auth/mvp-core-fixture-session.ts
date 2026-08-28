import type { MvpCoreFixtureSession } from "../../../../packages/testkit/src/integration-seam";

type MemberRole = MvpCoreFixtureSession["role"];

export const MVP_CORE_FIXTURE_SESSION_COOKIE =
  "mvp_core_fixture_session" as const;
export const MVP_CORE_FIXTURE_SESSION_PATH =
  "/api/fixtures/mvp-core" as const;

const SESSION_ID_BY_ROLE = Object.freeze({
  partner: "mvp-core-local-partner-7d610c66-v1",
  primary: "mvp-core-local-primary-4ab287f1-v1",
  subject: "mvp-core-local-subject-c15e3d92-v1",
} as const satisfies Readonly<Record<MemberRole, string>>);

const isMemberRole = (value: unknown): value is MemberRole =>
  value === "primary" || value === "partner" || value === "subject";

/**
 * Converts the untrusted page selector into one of three server-owned Local
 * Fixture session identifiers. These identifiers are intentionally non-secret
 * and are never production authentication credentials.
 */
export const issueLocalFixtureSessionId = (
  roleInput: unknown,
): string | undefined =>
  isMemberRole(roleInput) ? SESSION_ID_BY_ROLE[roleInput] : undefined;

/** Unknown or modified identifiers do not select a role. */
export const roleForLocalFixtureSessionId = (
  sessionId: unknown,
): MemberRole | undefined => {
  if (typeof sessionId !== "string") {
    return undefined;
  }

  return (Object.entries(SESSION_ID_BY_ROLE) as readonly [MemberRole, string][])
    .find(([, expected]) => expected === sessionId)?.[0];
};
