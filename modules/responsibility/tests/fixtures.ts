import {
  FIXTURE_CONSENT,
  FIXTURE_DOMAIN,
  FIXTURE_EVIDENCE,
  FIXTURE_MEMBERS,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SIGNAL_DRAFT,
  FIXTURE_SPACE,
  FIXTURE_TASK,
  FIXTURE_TIMES,
  type Clock,
} from "../../../packages/contracts/src/index";
import {
  ResponsibilityReportSnapshotSchema,
  ResponsibilitySourceContextSchema,
  type ResponsibilityReportSnapshot,
  type ResponsibilitySourceContext,
} from "../src/index";

export const FIXED_CLOCK: Clock = {
  now: () => new Date(FIXTURE_TIMES.periodEnd),
};

export const fixtureMembers = () =>
  [FIXTURE_MEMBERS.primary, FIXTURE_MEMBERS.partner, FIXTURE_MEMBERS.subject];

export const fixtureSourceContext = (): ResponsibilitySourceContext =>
  ResponsibilitySourceContextSchema.parse({
    actorMember: FIXTURE_MEMBERS.primary,
    consent: FIXTURE_CONSENT,
    draft: FIXTURE_SIGNAL_DRAFT,
    evidence: [FIXTURE_EVIDENCE],
    members: fixtureMembers(),
    signal: FIXTURE_SHARED_SIGNAL,
    space: FIXTURE_SPACE,
    speaker: FIXTURE_MEMBERS.subject,
  });

export const fixtureReportSnapshot = (): ResponsibilityReportSnapshot =>
  ResponsibilityReportSnapshotSchema.parse({
    actorMember: FIXTURE_MEMBERS.primary,
    domains: [FIXTURE_DOMAIN],
    members: fixtureMembers(),
    sources: [fixtureSourceContext()],
    space: FIXTURE_SPACE,
    tasks: [{ sourceSignalId: FIXTURE_SHARED_SIGNAL.id, task: FIXTURE_TASK }],
  });
