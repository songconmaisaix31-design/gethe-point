import {
  issueMvpCoreFixtureSession,
  MVP_CORE_SEAM,
  type MvpCoreFixtureSession,
} from "../../../../../packages/testkit/src/integration-seam";
import { roleForLocalFixtureSessionId } from "../../auth/mvp-core-fixture-session";

/**
 * Reissues the QA-owned branded context only after the integration session
 * allowlist resolves. Cookie data never becomes actor or space data directly.
 */
export const resolveMvpCoreFixtureSession = (
  sessionId: unknown,
): MvpCoreFixtureSession | undefined => {
  const role = roleForLocalFixtureSessionId(sessionId);
  return role === undefined
    ? undefined
    : issueMvpCoreFixtureSession({
        role,
        scenarioId: MVP_CORE_SEAM.sessionSelection.serverScenarioId,
      });
};
