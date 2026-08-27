import {
  EvidenceProvenanceSchema,
  MemberSchema,
  SharedSignalSchema,
  SpaceSchema,
  TaskSchema,
  type LLMProviderResult,
  type MemberActor,
} from "../../../packages/contracts/src/index";

import { PersistedEvidenceSnapshotSchema } from "../../responsibility";
import {
  DomainSuggestionContextSchema,
  DomainSuggestionRequestSchema,
  type DomainSuggestionContext,
  type DomainSuggestionRequest,
} from "../src";

export const ids = Object.freeze({
  space: "10000000-0000-4000-8000-000000000001",
  primary: "10000000-0000-4000-8000-000000000002",
  partner: "10000000-0000-4000-8000-000000000003",
  domain: "10000000-0000-4000-8000-000000000004",
  task: "10000000-0000-4000-8000-000000000005",
  signal: "10000000-0000-4000-8000-000000000006",
  evidence: "10000000-0000-4000-8000-000000000007",
  consent: "10000000-0000-4000-8000-000000000008",
  request: "10000000-0000-4000-8000-000000000009",
  confirmRequest: "10000000-0000-4000-8000-000000000010",
  generatedDomain: "10000000-0000-4000-8000-000000000011",
});

export const createdAt = "2026-08-28T08:00:00.000Z";
export const draftReceipt =
  "draft_receipt_000000000000000000000000000001";

export const actor: MemberActor = {
  kind: "member",
  memberId: ids.primary,
  spaceId: ids.space,
  role: "primary",
  authentication: "verified_session",
};

export const partnerActor: MemberActor = {
  kind: "member",
  memberId: ids.partner,
  spaceId: ids.space,
  role: "partner",
  authentication: "verified_session",
};

export const primaryMember = MemberSchema.parse({
  id: ids.primary,
  spaceId: ids.space,
  role: "primary",
  displayName: "Lin",
  status: "active",
  joinedAt: createdAt,
  analysisConsent: "enabled",
  createdAt,
  updatedAt: createdAt,
  version: 4,
});

export const baseContext = (): DomainSuggestionContext => {
  const evidence = PersistedEvidenceSnapshotSchema.parse({
    id: ids.evidence,
    spaceId: ids.space,
    sourceType: "agent_dm",
    speakerId: ids.primary,
    occurredAt: createdAt,
    state: "available",
    version: 2,
  });
  const signal = SharedSignalSchema.parse({
    id: ids.signal,
    spaceId: ids.space,
    speakerId: ids.primary,
    consentDecisionId: ids.consent,
    redactedExcerpt: "The follow-up appointment needs scheduling.",
    conclusion: "A follow-up appointment needs ownership.",
    purpose: "responsibility",
    visibility: { kind: "space" },
    provenance: [
      EvidenceProvenanceSchema.parse({
        evidenceId: evidence.id,
        sourceType: evidence.sourceType,
        speakerId: evidence.speakerId,
        occurredAt: evidence.occurredAt,
        state: evidence.state,
      }),
    ],
    evidenceState: "available",
    createdAt,
    updatedAt: createdAt,
    version: 3,
  });
  const task = TaskSchema.parse({
    id: ids.task,
    spaceId: ids.space,
    domainId: ids.domain,
    title: "Schedule the follow-up appointment",
    dueAt: null,
    status: "open",
    reviewState: "current",
    visibility: { kind: "space" },
    evidenceIds: [evidence.id],
    discoveredBy: ids.primary,
    deadlineKeptBy: ids.primary,
    scheduledBy: ids.primary,
    executedBy: ids.primary,
    followedUpBy: ids.primary,
    createdAt,
    updatedAt: createdAt,
    version: 5,
  });

  return DomainSuggestionContextSchema.parse({
    space: SpaceSchema.parse({
      id: ids.space,
      spaceId: ids.space,
      name: "Fixture family",
      createdBy: ids.primary,
      status: "active",
      createdAt,
      updatedAt: createdAt,
      version: 6,
    }),
    actorMember: primaryMember,
    members: [primaryMember],
    tasks: [task],
    signals: [{ signal, sourceKind: "potential_task" }],
    evidence: [evidence],
  });
};

export const request = (): DomainSuggestionRequest => {
  const context = baseContext();
  return DomainSuggestionRequestSchema.parse({
    requestId: ids.request,
    spaceId: ids.space,
    expectedSpaceVersion: context.space.version,
    expectedActorVersion: context.actorMember.version,
    tasks: context.tasks.map(({ id, version }) => ({ id, version })),
    signals: context.signals.map(({ signal: { id, version } }) => ({
      id,
      version,
    })),
    evidence: context.evidence.map(({ id, version }) => ({ id, version })),
    promptVersion: "domain-v2",
    timeoutMs: 100,
  });
};

export const validProviderResult = (): LLMProviderResult => ({
  status: "completed",
  completion: {
    output: {
      name: "Recent health follow-up",
      nextAction: "Confirm the appointment date",
    },
    latencyMs: 7,
    usage: { inputTokens: 20, outputTokens: 10 },
  },
});
