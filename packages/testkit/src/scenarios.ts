import {
  ALL_OPERATION_CONTRACTS,
  FIXTURE_TRUTH_LABELS,
  MemberActorSchema,
  NEEDS_HUMAN_REVIEW_EXAMPLE,
  type AuthenticationEvidence,
  type MemberActor,
  type MemberRole,
  type OperationName,
} from "../../contracts/src/index";

import {
  createContractFixtureAdapter,
  type OperationFixtureCase,
} from "./contract-adapter";
import {
  createGoldenFixture,
  type EvidenceLevel,
  type GoldenFixture,
} from "./golden-fixture";

export const ACCEPTANCE_OUTCOMES = [
  "success",
  "blocked",
  "denied",
  "needs_human_review",
  "failed",
] as const;
export type AcceptanceOutcome = (typeof ACCEPTANCE_OUTCOMES)[number];

export interface AcceptanceScenario {
  readonly id: string;
  readonly operation: OperationName;
  readonly kind: "command" | "query";
  readonly actorRole: MemberRole | "system";
  readonly authenticationEvidence:
    | AuthenticationEvidence
    | "internal_service";
  readonly evidenceLevel: EvidenceLevel | null;
  readonly expectedOutcome: AcceptanceOutcome;
  readonly responseKind: "result" | "error";
  readonly actor: unknown;
  readonly request: unknown;
  readonly response: unknown;
  readonly fixtureLabels: typeof FIXTURE_TRUTH_LABELS;
  readonly requiredFacts: readonly string[];
}

export interface AuthenticationScenario {
  readonly id: string;
  readonly role: MemberRole;
  readonly authentication: AuthenticationEvidence;
  readonly actor: MemberActor;
}

export interface DemoSpineStep {
  readonly sequence: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly id:
    | "family-context"
    | "private-consent-share"
    | "responsibility-report"
    | "handover-blocked"
    | "handover-accepted"
    | "care-escalation"
    | "primary-home-after";
  readonly expectedOutcome: "success" | "blocked";
  readonly operationNames: readonly OperationName[];
  readonly entityIds: readonly string[];
  readonly requiredFacts: readonly string[];
}

const contractFor = (operation: OperationName) => {
  const contract = ALL_OPERATION_CONTRACTS.find(
    (candidate) => candidate.name === operation,
  );

  if (contract === undefined) {
    throw new RangeError(`Missing contract for ${operation}.`);
  }

  return contract;
};

const actorFacts = (fixtureCase: OperationFixtureCase) =>
  fixtureCase.actor.kind === "member"
    ? {
        actorRole: fixtureCase.actor.role,
        authenticationEvidence: fixtureCase.actor.authentication,
      }
    : {
        actorRole: "system" as const,
        authenticationEvidence: fixtureCase.actor.authentication,
      };

const OPERATION_EVIDENCE_LEVELS: Partial<
  Readonly<Record<OperationName, EvidenceLevel>>
> = Object.freeze({
  CreatePrivateMessage: "raw_private",
  GetPrivateConversation: "raw_private",
  ConfirmSignal: "shared_redacted",
  GetVisibleSharedSignals: "shared_redacted",
  GetDomainWithEvidence: "provenance_only",
  DeleteEvidence: "deleted_missing",
});

const evidenceLevelFor = (operation: OperationName): EvidenceLevel | null =>
  OPERATION_EVIDENCE_LEVELS[operation] ?? null;

const successScenarioFrom = (
  fixtureCase: OperationFixtureCase,
): AcceptanceScenario =>
  Object.freeze({
    id: `operation:${fixtureCase.operation}:success`,
    operation: fixtureCase.operation,
    kind: fixtureCase.kind,
    ...actorFacts(fixtureCase),
    evidenceLevel: evidenceLevelFor(fixtureCase.operation),
    expectedOutcome: "success",
    responseKind: "result",
    actor: fixtureCase.actor,
    request: fixtureCase.request,
    response: fixtureCase.result,
    fixtureLabels: FIXTURE_TRUTH_LABELS,
    requiredFacts: [
      "actor_contract_valid",
      "request_contract_valid",
      "result_contract_valid",
    ],
  });

const scenarioFromCase = (
  fixtureCase: OperationFixtureCase,
  overrides: Pick<
    AcceptanceScenario,
    | "id"
    | "expectedOutcome"
    | "responseKind"
    | "response"
    | "evidenceLevel"
    | "requiredFacts"
  >,
): AcceptanceScenario =>
  Object.freeze({
    operation: fixtureCase.operation,
    kind: fixtureCase.kind,
    ...actorFacts(fixtureCase),
    actor: fixtureCase.actor,
    request: fixtureCase.request,
    fixtureLabels: FIXTURE_TRUTH_LABELS,
    ...overrides,
  });

export const createAcceptanceScenarios = (
  fixture: GoldenFixture = createGoldenFixture(),
): readonly AcceptanceScenario[] => {
  const adapter = createContractFixtureAdapter();
  const successScenarios = adapter.listCases().map(successScenarioFrom);
  const blockedCase = adapter.getCase("ProposeHandover");
  const deniedCase = adapter.getCase("GetDomainWithEvidence");
  const reviewCase = adapter.getCase("CreateSignalDraft");

  return Object.freeze([
    ...successScenarios,
    scenarioFromCase(blockedCase, {
      id: "representative:handover-blocked",
      expectedOutcome: "blocked",
      responseKind: "result",
      response: {
        status: "proposal_recorded",
        handover: fixture.handover.blocked,
      },
      evidenceLevel: "provenance_only",
      requiredFacts: [
        "missing_information_visible",
        "domain_owner_unchanged",
        "no_optimistic_transition",
      ],
    }),
    scenarioFromCase(deniedCase, {
      id: "representative:private-evidence-denied",
      expectedOutcome: "denied",
      responseKind: "error",
      response: {
        code: "not_found",
        requestId: "00000000-0000-4000-8000-000000000101",
        message: "The requested record is unavailable.",
        retryable: false,
      },
      evidenceLevel: "denied",
      requiredFacts: ["non_enumerating_error", "no_private_content"],
    }),
    scenarioFromCase(reviewCase, {
      id: "representative:provider-needs-human-review",
      expectedOutcome: "needs_human_review",
      responseKind: "result",
      response: NEEDS_HUMAN_REVIEW_EXAMPLE,
      evidenceLevel: "raw_private",
      requiredFacts: [
        "consequential_mutation_disallowed",
        "content_not_logged",
      ],
    }),
    scenarioFromCase(reviewCase, {
      id: "representative:provider-failed",
      expectedOutcome: "failed",
      responseKind: "error",
      response: {
        code: "provider_unavailable",
        requestId: "00000000-0000-4000-8000-000000000101",
        message: "The drafting provider is unavailable.",
        retryable: true,
      },
      evidenceLevel: "raw_private",
      requiredFacts: ["safe_error", "no_consequential_mutation"],
    }),
  ]);
};

export const assertAcceptanceScenario = (
  scenario: AcceptanceScenario,
): void => {
  const contract = contractFor(scenario.operation);
  contract.actorSchema.parse(scenario.actor);
  contract.requestSchema.parse(scenario.request);

  if (scenario.responseKind === "result") {
    contract.resultSchema.parse(scenario.response);
  } else {
    contract.errorSchema.parse(scenario.response);
  }
};

export const createAuthenticationScenarios = (
  fixture: GoldenFixture = createGoldenFixture(),
): readonly AuthenticationScenario[] => {
  const roles = ["primary", "partner", "subject"] as const;
  const evidenceLevels = ["fixture_demo", "verified_session"] as const;

  return Object.freeze(
    roles.flatMap((role) =>
      evidenceLevels.map((authentication) =>
        Object.freeze({
          id: `authentication:${role}:${authentication}`,
          role,
          authentication,
          actor: MemberActorSchema.parse({
            ...fixture.actors.members[role],
            authentication,
          }),
        }),
      ),
    ),
  );
};

const requireValue = <Value>(
  value: Value | undefined,
  description: string,
): Value => {
  if (value === undefined) {
    throw new Error(`Scenario fixture is missing ${description}.`);
  }

  return value;
};

export const createEvidenceAccessScenarios = (
  fixture: GoldenFixture = createGoldenFixture(),
): readonly AcceptanceScenario[] => {
  const adapter = createContractFixtureAdapter();
  const domainCase = adapter.getCase("GetDomainWithEvidence");
  const sharedCase = adapter.getCase("GetVisibleSharedSignals");
  const domain = requireValue(fixture.domains[0], "domain");
  const task = requireValue(fixture.tasks[0], "task");
  const evidence = requireValue(fixture.evidence[0], "evidence");
  const message = requireValue(
    fixture.messages.find((item) => item.evidenceId === evidence.id),
    "raw evidence message",
  );
  const signal = requireValue(fixture.sharedSignals[0], "shared signal");
  const provenance = requireValue(signal.provenance[0], "evidence provenance");

  const subjectDomainCase: OperationFixtureCase = {
    ...domainCase,
    actor: fixture.actors.members.subject,
  };
  const primaryDomainCase: OperationFixtureCase = {
    ...domainCase,
    actor: fixture.actors.members.primary,
  };

  return Object.freeze([
    scenarioFromCase(subjectDomainCase, {
      id: "evidence:raw-private",
      expectedOutcome: "success",
      responseKind: "result",
      response: {
        status: "ready",
        domain: {
          domain,
          tasks: [task],
          evidence: [
            {
              view: "raw",
              evidence: { evidence, rawContent: message.content },
            },
          ],
        },
      },
      evidenceLevel: "raw_private",
      requiredFacts: ["speaker_only", "raw_content_present"],
    }),
    scenarioFromCase(primaryDomainCase, {
      id: "evidence:provenance-only",
      expectedOutcome: "success",
      responseKind: "result",
      response: {
        status: "ready",
        domain: {
          domain,
          tasks: [task],
          evidence: [{ view: "provenance", evidence: provenance }],
        },
      },
      evidenceLevel: "provenance_only",
      requiredFacts: ["raw_content_absent", "provenance_visible"],
    }),
    scenarioFromCase(sharedCase, {
      id: "evidence:shared-redacted",
      expectedOutcome: "success",
      responseKind: "result",
      response: {
        status: "ready",
        signals: fixture.sharedSignals,
        page: { nextCursor: null, hasMore: false },
      },
      evidenceLevel: "shared_redacted",
      requiredFacts: ["active_consent_required", "redacted_excerpt_only"],
    }),
    scenarioFromCase(primaryDomainCase, {
      id: "evidence:deleted-missing",
      expectedOutcome: "success",
      responseKind: "result",
      response: {
        status: "ready",
        domain: {
          domain: fixture.deletion.domainAfter,
          tasks: [fixture.deletion.taskAfter],
          evidence: [
            {
              view: "provenance",
              evidence: {
                ...provenance,
                state: "deleted",
              },
            },
          ],
        },
      },
      evidenceLevel: "deleted_missing",
      requiredFacts: ["needs_review", "excluded_from_report"],
    }),
    scenarioFromCase(primaryDomainCase, {
      id: "evidence:denied",
      expectedOutcome: "denied",
      responseKind: "error",
      response: {
        code: "not_found",
        requestId: "00000000-0000-4000-8000-000000000101",
        message: "The requested record is unavailable.",
        retryable: false,
      },
      evidenceLevel: "denied",
      requiredFacts: ["non_enumerating_error", "no_existence_disclosure"],
    }),
  ]);
};

export const createDemoSpine = (
  fixture: GoldenFixture = createGoldenFixture(),
): readonly DemoSpineStep[] => {
  const familyMessages = fixture.messages
    .filter((message) => message.sourceType === "family_group")
    .slice(0, 3);
  const privateSignal = requireValue(
    fixture.sharedSignals.find((signal) => signal.purpose === "care_information"),
    "private consent signal",
  );

  return Object.freeze([
    {
      sequence: 1,
      id: "family-context",
      expectedOutcome: "success",
      operationNames: ["GetRoleHome"],
      entityIds: familyMessages.map((message) => message.id),
      requiredFacts: [
        "three_ordinary_family_messages",
        "preexisting_responsibility_split",
        "fixture_labels_visible",
      ],
    },
    {
      sequence: 2,
      id: "private-consent-share",
      expectedOutcome: "success",
      operationNames: [
        "CreatePrivateMessage",
        "CreateSignalDraft",
        "DecideConsent",
        "ConfirmSignal",
      ],
      entityIds: [privateSignal.id, privateSignal.consentDecisionId],
      requiredFacts: [
        "private_by_default",
        "explicit_per_signal_consent",
        "redacted_shared_conclusion",
      ],
    },
    {
      sequence: 3,
      id: "responsibility-report",
      expectedOutcome: "success",
      operationNames: ["GetResponsibilityReport"],
      entityIds: fixture.domains.map((domain) => domain.id),
      requiredFacts: [
        "five_stage_counts",
        "deterministic_neutral_copy",
        "no_score_or_blame",
      ],
    },
    {
      sequence: 4,
      id: "handover-blocked",
      expectedOutcome: "blocked",
      operationNames: ["ProposeHandover"],
      entityIds: [fixture.handover.blocked.id],
      requiredFacts: [
        "missing_information_visible",
        "owner_unchanged",
        "responsibility_not_transferred",
      ],
    },
    {
      sequence: 5,
      id: "handover-accepted",
      expectedOutcome: "success",
      operationNames: [
        "SupplyHandoverInfo",
        "ConfirmHandoverFrom",
        "ConfirmHandoverTo",
        "AcceptHandover",
      ],
      entityIds: [fixture.handover.accepted.id],
      requiredFacts: [
        "both_confirmations_present",
        "new_owner_visible",
        "five_old_reminders_removed",
      ],
    },
    {
      sequence: 6,
      id: "care-escalation",
      expectedOutcome: "success",
      operationNames: [
        "TickCareScheduler",
        "AcknowledgeCareEvent",
        "HandleCareEvent",
      ],
      entityIds: [fixture.care.rule.id, fixture.care.notified.id],
      requiredFacts: [
        "acknowledgement_branch_encoded",
        "timeout_escalation_branch_encoded",
        "handled_closeout_encoded",
        "deterministic_without_llm",
      ],
    },
    {
      sequence: 7,
      id: "primary-home-after",
      expectedOutcome: "success",
      operationNames: ["GetRoleHome"],
      entityIds: fixture.handover.rememberedItemIdsAfter,
      requiredFacts: [
        "remembered_count_before_seven",
        "remembered_count_after_two",
        "fixture_labels_visible",
      ],
    },
  ]);
};
