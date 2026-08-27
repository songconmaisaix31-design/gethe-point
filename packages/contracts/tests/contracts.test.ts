import { describe, expect, it } from "vitest";

import packageManifest from "../package.json";
import {
  ACCESSIBILITY_CONTRACT,
  AcknowledgeCareEventRequestSchema,
  AcknowledgedCareEventSchema,
  ADR_COMMAND_NAMES,
  ADR_QUERY_NAMES,
  AI_ATTEMPT_POLICY,
  ALL_OPERATION_CONTRACTS,
  AuditChangeSchema,
  AuditEntrySchema,
  AUTHORIZATION_MATRIX,
  AuthorizationActionSchema,
  CARE_COMMAND_TIME_POLICY,
  CARE_STATES,
  CARE_TERMINAL_STATES,
  CARE_TRANSITION_TABLE,
  CareEventSchema,
  CareResolutionSchema,
  ClosedCareEventSchema,
  COMMAND_CONTRACTS,
  ContractErrorSchema,
  DELETION_MATRIX,
  DecideConsentRequestSchema,
  DeleteSpaceRequestSchema,
  DomainEventSchema,
  FAIL_CLOSED_INPUT_EXAMPLES,
  FIXED_SCREEN_CONTRACTS,
  FIXTURE_ACKNOWLEDGED_CARE_EVENT,
  FIXTURE_CARE_RESOLUTION_AUDIT_ENTRY,
  FIXTURE_CLOSED_CARE_EVENT,
  FIXTURE_HANDLED_CARE_EVENT,
  FIXTURE_LEGACY_CLOSED_CARE_EVENT,
  FIXTURE_LEGACY_HANDLED_CARE_EVENT,
  FIXTURE_SCREENSHOT_MANIFEST,
  FIXTURE_TRUTH_LABELS,
  FixedScreenContractSchema,
  HANDOVER_COMPLETENESS_COMMAND_NAMES,
  HANDOVER_STATES,
  HANDOVER_TERMINAL_STATES,
  HANDOVER_TRANSITION_TABLE,
  HandoverSchema,
  ConfirmHandoverFromResultSchema,
  HandleCareEventRequestSchema,
  HandleCareEventResolutionSchema,
  HandleCareEventResultSchema,
  HandledCareEventSchema,
  NEEDS_HUMAN_REVIEW_EXAMPLE,
  NeedsHumanReviewSchema,
  OPERATION_EXAMPLES,
  QUERY_CONTRACTS,
  REPRESENTATIVE_ERROR_EXAMPLES,
  REQUIRED_OPERATION_UI_STATES,
  REQUIRED_VIEWPORTS,
  ScreenshotScenarioSchema,
  SharedSignalSchema,
  TaskSchema,
  TimeRangeSchema,
  TimestampSchema,
  UI_STATE_VOCABULARY,
  UI_TOKENS,
  ViewportSchema,
  compareTimestamps,
  contractJsonSchemas,
} from "@we-remember/contracts";

const pairKey = (from: string, to: string) => `${from}->${to}`;

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const red = channels[0] ?? 0;
  const green = channels[1] ?? 0;
  const blue = channels[2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

describe("public operation source", () => {
  it("contains every ADR operation and only the two documented completion commands", () => {
    const commandNames = COMMAND_CONTRACTS.map(({ name }) => name);
    const queryNames = QUERY_CONTRACTS.map(({ name }) => name);

    expect(commandNames).toHaveLength(20);
    expect(new Set(commandNames).size).toBe(commandNames.length);
    expect(commandNames).toEqual([
      ...ADR_COMMAND_NAMES,
      ...HANDOVER_COMPLETENESS_COMMAND_NAMES,
    ]);
    expect(queryNames).toEqual(ADR_QUERY_NAMES);
    expect(ALL_OPERATION_CONTRACTS).toHaveLength(28);
  });

  it("validates actor, request, and result examples through every public operation", () => {
    for (const contract of ALL_OPERATION_CONTRACTS) {
      const example = OPERATION_EXAMPLES[contract.name];
      expect(
        contract.actorSchema.safeParse(example.actor).success,
        `${contract.name} actor`,
      ).toBe(true);
      expect(
        contract.requestSchema.safeParse(example.request).success,
        `${contract.name} request`,
      ).toBe(true);
      expect(
        contract.resultSchema.safeParse(example.result).success,
        `${contract.name} result`,
      ).toBe(true);
      expect(contract.errorCodes.length).toBeGreaterThan(0);
      for (const code of contract.errorCodes) {
        expect(ContractErrorSchema.shape.code.safeParse(code).success).toBe(true);
      }
      const disallowedCode = ContractErrorSchema.shape.code.options.find(
        (code) => !contract.errorCodes.some((allowed) => allowed === code),
      );
      expect(disallowedCode).toBeDefined();
      if (disallowedCode !== undefined) {
        expect(
          contract.errorSchema.safeParse({
            code: disallowedCode,
            requestId: "00000000-0000-4000-8000-000000000101",
            message: "Safe error.",
            retryable: false,
          }).success,
        ).toBe(false);
      }
    }
  });

  it("exports only the package root and keeps deep modules private", () => {
    expect(packageManifest.name).toBe("@we-remember/contracts");
    expect(Object.keys(packageManifest.exports)).toEqual(["."]);
    expect(packageManifest.exports["."]).toBe("./src/index.ts");
  });
});

describe("exact timestamp ordering", () => {
  it("orders every supported precision and offset without narrowing TimestampSchema", () => {
    const acceptedTimestamps = [
      "0000-01-01T00:00Z",
      "0000-02-29T23:59:59.1+23:59",
      "2025-12-31T23:15Z",
      "2026-01-01T00:15:00+01:00",
      "2026-08-27T20:01:00.000998Z",
      "2026-08-27T20:01:00.000999Z",
      "2026-08-27T20:01:00.123456789012345678901Z",
      "2026-08-27T15:01-05:00",
      "2026-08-28T04:01:00.000000000+08:00",
    ] as const;

    for (const timestamp of acceptedTimestamps) {
      expect(TimestampSchema.safeParse(timestamp).success, timestamp).toBe(true);
    }

    expect(
      compareTimestamps(
        "2026-08-27T20:01:00.000998Z",
        "2026-08-27T20:01:00.000999Z",
      ),
    ).toBe(-1);
    expect(
      compareTimestamps(
        "2026-08-27T20:01:00.000999Z",
        "2026-08-27T20:01:00.000998Z",
      ),
    ).toBe(1);
    expect(
      compareTimestamps(
        "2026-08-27T20:01:00.123456789012345678901Z",
        "2026-08-27T20:01:00.123456789012345678902Z",
      ),
    ).toBe(-1);
    expect(
      compareTimestamps(
        "2024-02-29T23:59:59.999999999999999999Z",
        "2024-03-01T00:00Z",
      ),
    ).toBe(-1);
    expect(
      compareTimestamps(
        "0000-01-01T00:00+23:59",
        "0000-01-01T00:00Z",
      ),
    ).toBe(-1);
    expect(
      compareTimestamps(
        "0000-02-29T23:59:59.999999999999Z",
        "0000-03-01T00:00Z",
      ),
    ).toBe(-1);
  });

  it("compares equivalent instants equally across syntax variants", () => {
    expect(
      compareTimestamps(
        "2026-08-27T20:01Z",
        "2026-08-27T20:01:00.000000000000Z",
      ),
    ).toBe(0);
    expect(
      compareTimestamps(
        "2026-08-27T20:01:00.1Z",
        "2026-08-27T20:01:00.100000000000000Z",
      ),
    ).toBe(0);
    expect(
      compareTimestamps(
        "2026-08-27T20:01Z",
        "2026-08-28T04:01:00.000+08:00",
      ),
    ).toBe(0);
    expect(
      compareTimestamps(
        "2026-08-27T20:01Z",
        "2026-08-27T15:01-05:00",
      ),
    ).toBe(0);
    expect(
      compareTimestamps(
        "0000-01-01T00:00Z",
        "0000-01-01T01:00+01:00",
      ),
    ).toBe(0);
    expect(
      compareTimestamps(
        "2026-01-01T00:15:00+01:00",
        "2025-12-31T23:15Z",
      ),
    ).toBe(0);
  });

  it("accepts a positive sub-millisecond range and rejects equal endpoints", () => {
    expect(
      TimeRangeSchema.safeParse({
        startAt: "2026-08-27T20:01:00.000000000000000001Z",
        endAt: "2026-08-27T20:01:00.000000000000000002Z",
      }).success,
    ).toBe(true);
    expect(
      TimeRangeSchema.safeParse({
        startAt: "2026-08-27T20:01Z",
        endAt: "2026-08-28T04:01:00.000000+08:00",
      }).success,
    ).toBe(false);
    expect(
      TimeRangeSchema.safeParse({
        startAt: "2026-08-27T20:01:00.1Z",
        endAt: "2026-08-27T20:01:00.100000Z",
      }).success,
    ).toBe(false);
  });
});

describe("strict schemas and fail-closed examples", () => {
  it("requires all five responsibility keys in the single Task schema", () => {
    expect(TaskSchema.safeParse(OPERATION_EXAMPLES.CorrectTaskAttribution.result).success).toBe(
      false,
    );
    expect(
      TaskSchema.safeParse(
        OPERATION_EXAMPLES.CorrectTaskAttribution.result.task,
      ).success,
    ).toBe(true);
    expect(
      TaskSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.taskMissingResponsibilityField,
      ).success,
    ).toBe(false);

    const taskJsonSchema = contractJsonSchemas.entities.Task as {
      readonly required?: readonly string[];
    };
    expect(taskJsonSchema.required).toEqual(
      expect.arrayContaining([
        "discoveredBy",
        "deadlineKeptBy",
        "scheduledBy",
        "executedBy",
        "followedUpBy",
      ]),
    );
  });

  it("rejects self visibility for a shared consent and raw content on shared signals", () => {
    expect(
      DecideConsentRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.sharedConsentWithSelfVisibility,
      ).success,
    ).toBe(false);

    const signalWithRawContent = {
      ...OPERATION_EXAMPLES.ConfirmSignal.result.signal,
      rawContent: "must not cross the boundary",
    };
    expect(SharedSignalSchema.safeParse(signalWithRawContent).success).toBe(false);
  });

  it("rejects incomplete accepted handovers, unknown care states, and body authority", () => {
    expect(
      HandoverSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.acceptedHandoverMissingRecipientConfirmation,
      ).success,
    ).toBe(false);
    expect(
      ConfirmHandoverFromResultSchema.safeParse({
        status: "confirmation_recorded",
        handover: OPERATION_EXAMPLES.SupplyHandoverInfo.result.handover,
      }).success,
    ).toBe(false);
    expect(
      OPERATION_EXAMPLES.GetCareInbox.result.events.length,
    ).toBeGreaterThan(0);
    expect(
      OPERATION_EXAMPLES.GetCareInbox.result.events[0]?.state,
    ).toBe("notified");
    expect(
      ALL_OPERATION_CONTRACTS.find(
        ({ name }) => name === "TickCareScheduler",
      )?.resultSchema.safeParse({
        status: "processed",
        replayed: false,
        events: [FAIL_CLOSED_INPUT_EXAMPLES.unknownCareState],
        notificationIntents: [],
      }).success,
    ).toBe(false);
    expect(
      ALL_OPERATION_CONTRACTS.find(
        ({ name }) => name === "CreatePrivateMessage",
      )?.requestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.requestWithUnknownAuthorityField,
      ).success,
    ).toBe(false);
  });

  it("requires exact destructive confirmation before a space deletion request is valid", () => {
    const validRequest = OPERATION_EXAMPLES.DeleteSpace.request;
    expect(DeleteSpaceRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(
      DeleteSpaceRequestSchema.safeParse({
        ...validRequest,
        typedSpaceName: "另一个空间",
      }).success,
    ).toBe(false);
  });

  it("uses one server-clock instant and rejects caller care timestamps", () => {
    expect(
      AcknowledgeCareEventRequestSchema.safeParse(
        OPERATION_EXAMPLES.AcknowledgeCareEvent.request,
      ).success,
    ).toBe(true);
    expect(
      HandleCareEventRequestSchema.safeParse(
        OPERATION_EXAMPLES.HandleCareEvent.request,
      ).success,
    ).toBe(true);
    expect(
      AcknowledgeCareEventRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.acknowledgementWithCallerTimestamp,
      ).success,
    ).toBe(false);
    expect(
      HandleCareEventRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.handlingWithCallerTimestamp,
      ).success,
    ).toBe(false);
    expect(
      AcknowledgedCareEventSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.timelyAcknowledgementAtDeadline,
      ).success,
    ).toBe(false);

    const preciseTimelyAcknowledgement = {
      ...FIXTURE_ACKNOWLEDGED_CARE_EVENT,
      acknowledgementDeadline: "2026-08-27T20:01:00.000999Z",
      acknowledgedAt: "2026-08-27T20:01:00.000998Z",
      timedOutAt: null,
      escalationLevel: 0,
      escalatedAt: null,
    } as const;
    expect(
      AcknowledgedCareEventSchema.safeParse(preciseTimelyAcknowledgement).success,
    ).toBe(true);
    expect(
      AcknowledgedCareEventSchema.safeParse({
        ...preciseTimelyAcknowledgement,
        acknowledgedAt: preciseTimelyAcknowledgement.acknowledgementDeadline,
      }).success,
    ).toBe(false);
    expect(
      AcknowledgedCareEventSchema.safeParse({
        ...preciseTimelyAcknowledgement,
        acknowledgedAt: "2026-08-27T20:01:00.001Z",
      }).success,
    ).toBe(false);
    expect(
      AcknowledgedCareEventSchema.safeParse({
        ...preciseTimelyAcknowledgement,
        acknowledgedAt: "2026-08-27T20:01:00.001Z",
        timedOutAt: preciseTimelyAcknowledgement.acknowledgementDeadline,
        escalationLevel: 1,
        escalatedAt: "2026-08-27T20:01:00.001Z",
      }).success,
    ).toBe(true);

    expect(CARE_COMMAND_TIME_POLICY).toMatchObject({
      commandNames: ["AcknowledgeCareEvent", "HandleCareEvent"],
      source: "Clock.now",
      sample: "once_per_execution",
      callerTimestampFields: [],
      acknowledgement: {
        timelyWhen: "now < acknowledgementDeadline",
        timedOutWhen: "now >= acknowledgementDeadline",
      },
    });
    expect(CARE_COMMAND_TIME_POLICY.authoritativeFor).toEqual(
      expect.arrayContaining([
        "transition_decision",
        "acknowledgement_deadline_comparison",
        "persisted_transition_timestamp",
        "idempotency_claim_timestamp",
        "domain_event_timestamp",
        "audit_timestamp",
      ]),
    );
  });

  it("bounds persisted care resolution and keeps it content-free in audit", () => {
    expect(
      HandledCareEventSchema.safeParse(FIXTURE_HANDLED_CARE_EVENT).success,
    ).toBe(true);
    expect(
      ClosedCareEventSchema.safeParse(FIXTURE_CLOSED_CARE_EVENT).success,
    ).toBe(true);
    expect(CareEventSchema.safeParse(FIXTURE_CLOSED_CARE_EVENT).success).toBe(true);
    expect(FIXTURE_CLOSED_CARE_EVENT.resolution).toBe(
      FIXTURE_HANDLED_CARE_EVENT.resolution,
    );

    expect(
      HandledCareEventSchema.safeParse(FIXTURE_LEGACY_HANDLED_CARE_EVENT).success,
    ).toBe(true);
    expect(
      ClosedCareEventSchema.safeParse(FIXTURE_LEGACY_CLOSED_CARE_EVENT).success,
    ).toBe(true);
    expect(CareResolutionSchema.safeParse("legacy_unknown").success).toBe(true);
    expect(HandleCareEventResolutionSchema.safeParse("legacy_unknown").success).toBe(
      false,
    );
    expect(
      HandleCareEventRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.handlingMissingResolution,
      ).success,
    ).toBe(false);
    expect(
      HandleCareEventRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.handlingWithInvalidResolution,
      ).success,
    ).toBe(false);
    expect(
      HandleCareEventRequestSchema.safeParse(
        FAIL_CLOSED_INPUT_EXAMPLES.handlingWithLegacyResolution,
      ).success,
    ).toBe(false);
    expect(
      HandleCareEventResultSchema.safeParse({
        status: "handled",
        careEvent: FIXTURE_LEGACY_HANDLED_CARE_EVENT,
      }).success,
    ).toBe(false);
    expect(
      ClosedCareEventSchema.safeParse({
        ...FIXTURE_CLOSED_CARE_EVENT,
        resolution: null,
      }).success,
    ).toBe(false);

    expect(
      AuditEntrySchema.safeParse(FIXTURE_CARE_RESOLUTION_AUDIT_ENTRY).success,
    ).toBe(true);
    expect(
      AuditChangeSchema.safeParse({
        field: "resolution",
        before: { kind: "resolution", value: null },
        after: { kind: "state", value: "free-form care content" },
      }).success,
    ).toBe(false);
    expect(
      AuditChangeSchema.safeParse({
        field: "resolution",
        before: { kind: "resolution", value: null },
        after: { kind: "resolution", value: "free_form_resolution" },
      }).success,
    ).toBe(false);
  });

  it("validates safe errors and the bounded human-review fallback", () => {
    for (const error of Object.values(REPRESENTATIVE_ERROR_EXAMPLES)) {
      expect(ContractErrorSchema.safeParse(error).success).toBe(true);
      expect(JSON.stringify(error)).not.toContain("明天下午");
    }
    expect(NeedsHumanReviewSchema.safeParse(NEEDS_HUMAN_REVIEW_EXAMPLE).success).toBe(
      true,
    );
    expect(AI_ATTEMPT_POLICY.maxAttempts).toBe(2);
    expect(AI_ATTEMPT_POLICY.maxRetries).toBe(1);
    expect(AI_ATTEMPT_POLICY.fallback).toBe("needs_human_review");
    expect(AI_ATTEMPT_POLICY.consequentialMutationAllowed).toBe(false);
    expect(NEEDS_HUMAN_REVIEW_EXAMPLE.consequentialMutationAllowed).toBe(false);
  });

  it("keeps private content out of domain-event payloads", () => {
    const invalidEvent = {
      eventId: "00000000-0000-4000-8000-000000000201",
      eventType: "private_message.created",
      spaceId: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-08-27T08:00:00+08:00",
      actor: {
        kind: "member",
        memberId: "00000000-0000-4000-8000-000000000004",
        spaceId: "00000000-0000-4000-8000-000000000001",
        role: "subject",
      },
      correlationId: "00000000-0000-4000-8000-000000000202",
      causationId: null,
      idempotencyKey: null,
      payload: {
        messageId: "00000000-0000-4000-8000-000000000011",
        conversationId: "00000000-0000-4000-8000-000000000010",
        authorId: "00000000-0000-4000-8000-000000000004",
        rawContent: "private content",
      },
    };
    expect(DomainEventSchema.safeParse(invalidEvent).success).toBe(false);
  });
});

describe("complete deterministic transition tables", () => {
  it("covers every handover pair exactly once and denies terminal exits", () => {
    expect(HANDOVER_TRANSITION_TABLE).toHaveLength(
      HANDOVER_STATES.length * HANDOVER_STATES.length,
    );
    expect(
      new Set(
        HANDOVER_TRANSITION_TABLE.map(({ from, to }) => pairKey(from, to)),
      ).size,
    ).toBe(HANDOVER_TRANSITION_TABLE.length);

    for (const terminal of HANDOVER_TERMINAL_STATES) {
      const outgoing = HANDOVER_TRANSITION_TABLE.filter(
        ({ from }) => from === terminal,
      );
      expect(outgoing.every(({ decision }) => decision === "denied")).toBe(true);
    }

    expect(
      HANDOVER_TRANSITION_TABLE.find(
        ({ from, to }) => from === "awaiting_confirmations" && to === "accepted",
      ),
    ).toMatchObject({ decision: "allowed", trigger: "AcceptHandover" });
  });

  it("covers every care pair exactly once and preserves the explicit escalation loop", () => {
    expect(CARE_TRANSITION_TABLE).toHaveLength(
      CARE_STATES.length * CARE_STATES.length,
    );
    expect(
      new Set(CARE_TRANSITION_TABLE.map(({ from, to }) => pairKey(from, to))).size,
    ).toBe(CARE_TRANSITION_TABLE.length);

    for (const terminal of CARE_TERMINAL_STATES) {
      const outgoing = CARE_TRANSITION_TABLE.filter(({ from }) => from === terminal);
      expect(outgoing.every(({ decision }) => decision === "denied")).toBe(true);
    }

    expect(
      CARE_TRANSITION_TABLE.find(
        ({ from, to }) => from === "escalated" && to === "escalated",
      ),
    ).toMatchObject({ decision: "allowed", trigger: "TickCareScheduler" });
    expect(
      CARE_TRANSITION_TABLE.find(
        ({ from, to }) => from === "notified" && to === "acknowledged",
      ),
    ).toMatchObject({
      decision: "allowed",
      trigger: "AcknowledgeCareEvent",
      guard: "actor_is_subject_and_clock_is_strictly_before_deadline",
    });
    expect(
      CARE_TRANSITION_TABLE.find(
        ({ from, to }) => from === "escalated" && to === "acknowledged",
      ),
    ).toMatchObject({
      decision: "allowed",
      guard: "subject_acknowledges_before_terminal_handling",
    });
    expect(
      CARE_TRANSITION_TABLE.find(
        ({ from, to }) => from === "handled" && to === "closed",
      ),
    ).toMatchObject({
      decision: "allowed",
      guard: "handling_audit_is_persisted_and_resolution_is_preserved",
    });
  });
});

describe("authorization and deletion consistency", () => {
  it("has an allow rule and an explicit default-deny row for every action", () => {
    for (const action of AuthorizationActionSchema.options) {
      const rows = AUTHORIZATION_MATRIX.filter((rule) => rule.action === action);
      expect(rows.some(({ decision }) => decision === "allow"), action).toBe(true);
      expect(
        rows.some(
          ({ decision, relationship }) =>
            decision === "deny" && relationship === "any_other",
        ),
        action,
      ).toBe(true);
    }
  });

  it("freezes mutually consistent deletion effects", () => {
    const evidenceDeletion = DELETION_MATRIX.find(
      ({ operation }) => operation === "delete_evidence",
    );
    expect(evidenceDeletion?.invalidates).toEqual(
      expect.arrayContaining([
        "dependent_signals_to_evidence_missing",
        "dependent_tasks_to_needs_review",
        "dependent_domains_to_needs_review",
        "future_report_inclusion",
      ]),
    );
    expect(evidenceDeletion?.preserves).toEqual(
      expect.arrayContaining(["accepted_handover_history", "current_domain_owner"]),
    );

    const spaceDeletion = DELETION_MATRIX.find(
      ({ operation }) => operation === "delete_space",
    );
    expect(spaceDeletion?.removes).toContain("audit_entries");
    expect(spaceDeletion?.preserves).toEqual([]);
    expect(spaceDeletion?.receipt).toBe("ephemeral_non_content_receipt");
  });
});

describe("JSON Schema and UI fact source", () => {
  it("generates serializable JSON Schema documents for every public operation", () => {
    expect(Object.keys(contractJsonSchemas.operations)).toHaveLength(28);
    for (const contract of ALL_OPERATION_CONTRACTS) {
      const schemas = contractJsonSchemas.operations[contract.name];
      expect(schemas).toBeDefined();
      const serialized = JSON.stringify(schemas);
      expect(serialized).toContain("draft/2020-12/schema");
      expect(serialized.startsWith("{")).toBe(true);
    }
  });

  it("freezes exact fixture truth labels, viewport dimensions, and screen states", () => {
    expect(FIXTURE_TRUTH_LABELS).toEqual({
      data: "演示数据 Fixture",
      account: "用于演示流程，不是账号实况",
      authentication: "演示角色切换，不是生产身份认证",
    });
    expect(REQUIRED_VIEWPORTS).toEqual([
      { id: "mobile", width: 390, height: 844 },
      { id: "desktop", width: 1440, height: 900 },
    ]);
    for (const viewport of REQUIRED_VIEWPORTS) {
      expect(ViewportSchema.safeParse(viewport).success).toBe(true);
    }
    for (const screen of FIXED_SCREEN_CONTRACTS) {
      expect(FixedScreenContractSchema.safeParse(screen).success).toBe(true);
      expect(screen.requiredStates).toEqual(REQUIRED_OPERATION_UI_STATES);
    }
    expect(Object.keys(UI_STATE_VOCABULARY)).toHaveLength(10);
  });

  it("meets the frozen older-subject contrast and target constraints", () => {
    expect(
      contrastRatio(UI_TOKENS.color.textPrimary, UI_TOKENS.color.canvas),
    ).toBeGreaterThanOrEqual(ACCESSIBILITY_CONTRACT.subjectBodyContrastMinimum);
    expect(UI_TOKENS.typography.subjectBodyPx).toBeGreaterThanOrEqual(20);
    expect(UI_TOKENS.typography.subjectHeadingPx).toBeGreaterThanOrEqual(26);
    expect(UI_TOKENS.targetPx.subjectPrimaryMinimum).toBeGreaterThanOrEqual(60);
    expect(ACCESSIBILITY_CONTRACT.acknowledgementMaximumSteps).toBe(1);
    expect(ACCESSIBILITY_CONTRACT.reducedMotionRequired).toBe(true);
  });

  it("validates every frozen screenshot scenario without pretending images exist", () => {
    expect(FIXTURE_SCREENSHOT_MANIFEST).toHaveLength(10);
    for (const scenario of FIXTURE_SCREENSHOT_MANIFEST) {
      expect(ScreenshotScenarioSchema.safeParse(scenario).success).toBe(true);
      expect(scenario.viewports).toEqual(["mobile", "desktop"]);
    }
  });
});
