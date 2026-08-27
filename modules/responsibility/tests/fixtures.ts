import type {
  Domain,
  Member,
  MemberActor,
  SharedSignal,
  SignalDraft,
  Task,
} from "../../../packages/contracts/src/index";
import type {
  ResponsibilityDomainFact,
  ResponsibilitySignalLink,
  ResponsibilityTaskFact,
} from "../src/index";

export const IDS = {
  space: "00000000-0000-4000-8000-000000000001",
  otherSpace: "00000000-0000-4000-8000-000000000002",
  primary: "00000000-0000-4000-8000-000000000010",
  partner: "00000000-0000-4000-8000-000000000011",
  subject: "00000000-0000-4000-8000-000000000012",
  task: "00000000-0000-4000-8000-000000000020",
  taskDiscussion: "00000000-0000-4000-8000-000000000021",
  taskMissing: "00000000-0000-4000-8000-000000000022",
  taskReview: "00000000-0000-4000-8000-000000000023",
  taskHidden: "00000000-0000-4000-8000-000000000024",
  evidence: "00000000-0000-4000-8000-000000000030",
  draft: "00000000-0000-4000-8000-000000000040",
  signal: "00000000-0000-4000-8000-000000000050",
  consent: "00000000-0000-4000-8000-000000000060",
  message: "00000000-0000-4000-8000-000000000070",
  domain: "00000000-0000-4000-8000-000000000080",
  audit: "00000000-0000-4000-8000-000000000090",
  request: "00000000-0000-4000-8000-000000000100",
} as const;

export const TIMES = {
  before: "2026-08-26T23:00:00.000Z",
  start: "2026-08-27T00:00:00.000Z",
  activity: "2026-08-27T01:00:00.000Z",
  generated: "2026-08-27T02:00:00.000Z",
  end: "2026-08-27T03:00:00.000Z",
} as const;

export const actor: MemberActor = {
  kind: "member",
  memberId: IDS.primary,
  spaceId: IDS.space,
  role: "primary",
  authentication: "verified_session",
};

export const members: readonly [Member, Member, Member] = [
  {
    id: IDS.primary,
    spaceId: IDS.space,
    createdAt: TIMES.before,
    updatedAt: TIMES.before,
    version: 0,
    role: "primary",
    displayName: "Member A",
    status: "active",
    joinedAt: TIMES.before,
    analysisConsent: "enabled",
  },
  {
    id: IDS.partner,
    spaceId: IDS.space,
    createdAt: TIMES.before,
    updatedAt: TIMES.before,
    version: 0,
    role: "partner",
    displayName: "Member B",
    status: "active",
    joinedAt: TIMES.before,
    analysisConsent: "enabled",
  },
  {
    id: IDS.subject,
    spaceId: IDS.space,
    createdAt: TIMES.before,
    updatedAt: TIMES.before,
    version: 0,
    role: "subject",
    displayName: "Member C",
    status: "active",
    joinedAt: TIMES.before,
    analysisConsent: "enabled",
  },
];

export const createDraft = (
  overrides: Partial<SignalDraft> = {},
): SignalDraft => ({
  id: IDS.draft,
  spaceId: IDS.space,
  createdAt: TIMES.before,
  updatedAt: TIMES.before,
  version: 0,
  speakerId: IDS.primary,
  sourceMessageId: IDS.message,
  evidenceIds: [IDS.evidence],
  kind: "potential_task",
  redactedExcerpt: "A redacted responsibility fact.",
  proposedConclusion: "A responsibility item was recorded.",
  candidateDomainId: null,
  confidence: 1,
  missingInfo: [],
  promptVersion: "fixture-v1",
  source: "fixture",
  ...overrides,
});

export const createSignal = (
  overrides: Partial<SharedSignal> = {},
): SharedSignal => ({
  id: IDS.signal,
  spaceId: IDS.space,
  createdAt: TIMES.before,
  updatedAt: TIMES.before,
  version: 0,
  speakerId: IDS.primary,
  consentDecisionId: IDS.consent,
  redactedExcerpt: "A redacted responsibility fact.",
  conclusion: "A responsibility item was confirmed.",
  purpose: "responsibility",
  visibility: { kind: "space" },
  provenance: [
    {
      evidenceId: IDS.evidence,
      sourceType: "family_group",
      speakerId: IDS.primary,
      occurredAt: TIMES.before,
      state: "available",
    },
  ],
  evidenceState: "available",
  ...overrides,
});

export const createSourceLink = (
  overrides: Readonly<{
    draft?: SignalDraft;
    signal?: SharedSignal | null;
  }> = {},
): ResponsibilitySignalLink => ({
  draft: overrides.draft ?? createDraft(),
  signal: overrides.signal === undefined ? createSignal() : overrides.signal,
});

export const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: IDS.task,
  spaceId: IDS.space,
  createdAt: TIMES.before,
  updatedAt: TIMES.activity,
  version: 0,
  domainId: IDS.domain,
  title: "Arrange medication refill",
  dueAt: null,
  status: "completed",
  reviewState: "current",
  visibility: { kind: "space" },
  evidenceIds: [IDS.evidence],
  discoveredBy: IDS.subject,
  deadlineKeptBy: IDS.primary,
  scheduledBy: IDS.primary,
  executedBy: IDS.partner,
  followedUpBy: IDS.primary,
  ...overrides,
});

export const createTaskFact = (
  overrides: Readonly<{
    task?: Task;
    sourceLinks?: readonly ResponsibilitySignalLink[];
  }> = {},
): ResponsibilityTaskFact => ({
  task: overrides.task ?? createTask(),
  sourceLinks: [...(overrides.sourceLinks ?? [createSourceLink()])],
});

export const createDomain = (overrides: Partial<Domain> = {}): Domain => ({
  id: IDS.domain,
  spaceId: IDS.space,
  createdAt: TIMES.before,
  updatedAt: TIMES.activity,
  version: 0,
  name: "Medication refills",
  ownerId: null,
  status: "active",
  nextAction: null,
  visibility: { kind: "space" },
  evidenceIds: [IDS.evidence],
  ...overrides,
});

export const createDomainFact = (
  overrides: Readonly<{
    domain?: Domain;
    sourceLinks?: readonly ResponsibilitySignalLink[];
  }> = {},
): ResponsibilityDomainFact => ({
  domain: overrides.domain ?? createDomain(),
  sourceLinks: [...(overrides.sourceLinks ?? [createSourceLink()])],
});
