import {
  DomainSchema,
  EvidenceProvenanceSchema,
  MemberSchema,
  SharedSignalSchema,
  SpaceSchema,
  TaskSchema,
  type MemberActor,
  type ResponsibilityAttribution,
  type SharedSignal,
  type SignalDraftKind,
  type Task,
} from "../../../packages/contracts/src/index";

import {
  AttributionCorrectionContextSchema,
  PersistedEvidenceSnapshotSchema,
  ResponsibilityReportContextSchema,
  type AttributionCorrectionContext,
  type PersistedEvidenceSnapshot,
  type ResponsibilityReportContext,
} from "../src/model";

export const ids = Object.freeze({
  space: "00000000-0000-4000-8000-000000000001",
  primary: "00000000-0000-4000-8000-000000000002",
  partner: "00000000-0000-4000-8000-000000000003",
  subject: "00000000-0000-4000-8000-000000000004",
  domain: "00000000-0000-4000-8000-000000000005",
  task: "00000000-0000-4000-8000-000000000006",
  signal: "00000000-0000-4000-8000-000000000007",
  evidence: "00000000-0000-4000-8000-000000000008",
  consent: "00000000-0000-4000-8000-000000000009",
  request: "00000000-0000-4000-8000-000000000010",
  audit: "00000000-0000-4000-8000-000000000011",
});

export const timestamps = Object.freeze({
  start: "2026-08-24T00:00:00.000Z",
  task: "2026-08-25T08:00:00.000Z",
  now: "2026-08-28T08:00:00.000Z",
  end: "2026-08-31T00:00:00.000Z",
});

export const actor: MemberActor = {
  kind: "member",
  memberId: ids.primary,
  spaceId: ids.space,
  role: "primary",
  authentication: "verified_session",
};

export const primaryMember = MemberSchema.parse({
  id: ids.primary,
  spaceId: ids.space,
  role: "primary",
  displayName: "Lin",
  status: "active",
  joinedAt: timestamps.start,
  analysisConsent: "enabled",
  createdAt: timestamps.start,
  updatedAt: timestamps.start,
  version: 2,
});

export const partnerMember = MemberSchema.parse({
  id: ids.partner,
  spaceId: ids.space,
  role: "partner",
  displayName: "Chen",
  status: "active",
  joinedAt: timestamps.start,
  analysisConsent: "enabled",
  createdAt: timestamps.start,
  updatedAt: timestamps.start,
  version: 2,
});

export const space = SpaceSchema.parse({
  id: ids.space,
  spaceId: ids.space,
  name: "Fixture family",
  createdBy: ids.primary,
  status: "active",
  createdAt: timestamps.start,
  updatedAt: timestamps.start,
  version: 2,
});

export const evidence = PersistedEvidenceSnapshotSchema.parse({
  id: ids.evidence,
  spaceId: ids.space,
  sourceType: "agent_dm",
  speakerId: ids.primary,
  occurredAt: timestamps.task,
  state: "available",
  version: 1,
});

export const domain = DomainSchema.parse({
  id: ids.domain,
  spaceId: ids.space,
  name: "School administration",
  ownerId: null,
  status: "active",
  nextAction: "Confirm the form deadline",
  visibility: { kind: "space" },
  evidenceIds: [ids.evidence],
  createdAt: timestamps.start,
  updatedAt: timestamps.start,
  version: 3,
});

export const makeTask = (
  overrides: Partial<Task> = {},
): Task =>
  TaskSchema.parse({
    id: ids.task,
    spaceId: ids.space,
    domainId: ids.domain,
    title: "Submit the school form",
    dueAt: null,
    status: "open",
    reviewState: "current",
    visibility: { kind: "space" },
    evidenceIds: [ids.evidence],
    discoveredBy: null,
    deadlineKeptBy: null,
    scheduledBy: null,
    executedBy: null,
    followedUpBy: null,
    createdAt: timestamps.task,
    updatedAt: timestamps.task,
    version: 3,
    ...overrides,
  });

export const makeEvidence = (
  id: string,
  overrides: Partial<PersistedEvidenceSnapshot> = {},
): PersistedEvidenceSnapshot =>
  PersistedEvidenceSnapshotSchema.parse({
    ...evidence,
    id,
    ...overrides,
  });

export const makeSignal = (
  id: string,
  evidenceValue: PersistedEvidenceSnapshot,
  overrides: Partial<SharedSignal> = {},
): SharedSignal => {
  const provenance = EvidenceProvenanceSchema.parse({
    evidenceId: evidenceValue.id,
    sourceType: evidenceValue.sourceType,
    speakerId: evidenceValue.speakerId,
    occurredAt: evidenceValue.occurredAt,
    state: evidenceValue.state,
  });
  return SharedSignalSchema.parse({
    id,
    spaceId: ids.space,
    speakerId: evidenceValue.speakerId,
    consentDecisionId: ids.consent,
    redactedExcerpt: "The school form is due this week.",
    conclusion: "A school form needs submission.",
    purpose: "responsibility",
    visibility: { kind: "space" },
    provenance: [provenance],
    evidenceState:
      evidenceValue.state === "available" ? "available" : "evidence_missing",
    createdAt: timestamps.task,
    updatedAt: timestamps.task,
    version: 1,
    ...overrides,
  });
};

export const correctionContext = (
  task: Task = makeTask(),
): AttributionCorrectionContext =>
  AttributionCorrectionContextSchema.parse({
    space,
    actorMember: primaryMember,
    members: [primaryMember, partnerMember],
    domain,
    task,
    evidence: [evidence],
  });

export const concentratedAttribution: ResponsibilityAttribution = {
  discoveredBy: ids.primary,
  deadlineKeptBy: ids.primary,
  scheduledBy: ids.primary,
  executedBy: ids.partner,
  followedUpBy: ids.primary,
};

export const reportContext = (
  attribution: ResponsibilityAttribution = concentratedAttribution,
  sourceKind: SignalDraftKind = "potential_task",
): ResponsibilityReportContext => {
  const task = makeTask(attribution);
  const signal = makeSignal(ids.signal, evidence);
  return ResponsibilityReportContextSchema.parse({
    space,
    actorMember: primaryMember,
    members: [primaryMember, partnerMember],
    domains: [domain],
    tasks: [{ task, sourceSignalIds: [signal.id] }],
    signals: [{ signal, sourceKind }],
    evidence: [evidence],
  });
};
