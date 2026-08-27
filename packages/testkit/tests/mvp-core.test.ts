import {
  ConsentDecisionSchema,
  ConversationSchema,
  DomainSchema,
  HandoverResolvedItemSchema,
  HandoverSchema,
  MemberActorSchema,
  MemberSchema,
  PrivateMessageSchema,
  ResponsibilityReportSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  TaskSchema,
  type MemberRole,
} from "../../contracts/src/index";
import { describe, expect, it } from "vitest";

import {
  createMemoryMvpCorePersistence,
  createMvpCoreHarness,
  issueMvpCoreFixtureSession,
  MVP_CORE_FIXTURE,
  MVP_CORE_SCENARIO_ID,
  MVP_CORE_STYLE_A_CSS_VARIABLES,
  MvpCoreCommandRequestSchema,
  MvpCoreCommandResponseSchema,
  type MvpCoreFixtureSession,
} from "../src";

const issueSession = (role: MemberRole): MvpCoreFixtureSession => {
  const session = issueMvpCoreFixtureSession({
    scenarioId: MVP_CORE_SCENARIO_ID,
    role,
  });
  if (session === undefined) {
    throw new Error(`Expected an issued Fixture session for ${role}`);
  }
  return session;
};

describe("canonical MVP core fixture", () => {
  it("is one internally consistent, visibly fictional three-role graph", () => {
    SpaceSchema.parse(MVP_CORE_FIXTURE.space);
    expect(MVP_CORE_FIXTURE.members).toHaveLength(3);
    for (const member of MVP_CORE_FIXTURE.members) {
      MemberSchema.parse(member);
    }
    for (const actor of Object.values(MVP_CORE_FIXTURE.actors)) {
      if (actor.kind === "member") {
        MemberActorSchema.parse(actor);
      }
    }

    ConversationSchema.parse(MVP_CORE_FIXTURE.privateConversation.conversation);
    PrivateMessageSchema.parse(MVP_CORE_FIXTURE.privateConversation.message);
    SignalDraftSchema.parse(MVP_CORE_FIXTURE.privateConversation.derivedDraft);
    ConsentDecisionSchema.parse(MVP_CORE_FIXTURE.privateConversation.consentDecision);
    SharedSignalSchema.parse(MVP_CORE_FIXTURE.privateConversation.consentedSignal);
    DomainSchema.parse(MVP_CORE_FIXTURE.responsibility.domain);
    TaskSchema.parse(MVP_CORE_FIXTURE.responsibility.task);
    ResponsibilityReportSchema.parse(MVP_CORE_FIXTURE.responsibility.report);
    HandoverSchema.parse(MVP_CORE_FIXTURE.handover.blocked);
    HandoverSchema.parse(MVP_CORE_FIXTURE.handover.awaitingConfirmations);
    HandoverSchema.parse(MVP_CORE_FIXTURE.handover.fromConfirmed);
    HandoverSchema.parse(MVP_CORE_FIXTURE.handover.bothConfirmed);
    HandoverSchema.parse(MVP_CORE_FIXTURE.handover.accepted);
    HandoverResolvedItemSchema.parse(MVP_CORE_FIXTURE.handover.supplyAction.resolvedItem);

    expect(MVP_CORE_FIXTURE.roles).toEqual(["primary", "partner", "subject"]);
    expect(MVP_CORE_FIXTURE.display.truthBadges).toEqual([
      "Fixture",
      "Local Demo",
      "Not Production Acceptance",
    ]);
    expect(MVP_CORE_FIXTURE.display.fictionalNotice).toContain("均为虚构");
    expect(MVP_CORE_FIXTURE.privateConversation.message.authorId).toBe(
      MVP_CORE_FIXTURE.actors.subject.memberId,
    );
    expect(MVP_CORE_FIXTURE.privateConversation.derivedDraft.sourceMessageId).toBe(
      MVP_CORE_FIXTURE.privateConversation.message.id,
    );
    expect(MVP_CORE_FIXTURE.privateConversation.consentedSignal.consentDecisionId).toBe(
      MVP_CORE_FIXTURE.privateConversation.consentDecision.id,
    );
  });

  it("fixes five owners, one blocked item, one reminder, exact action copy, and Style A", () => {
    expect(MVP_CORE_FIXTURE.responsibility.stageOwners).toEqual({
      discoveredBy: MVP_CORE_FIXTURE.actors.subject.memberId,
      deadlineKeptBy: MVP_CORE_FIXTURE.actors.primary.memberId,
      scheduledBy: MVP_CORE_FIXTURE.actors.primary.memberId,
      executedBy: MVP_CORE_FIXTURE.actors.partner.memberId,
      followedUpBy: MVP_CORE_FIXTURE.actors.primary.memberId,
    });
    expect(Object.values(MVP_CORE_FIXTURE.responsibility.stageOwners)).not.toContain(null);
    expect(MVP_CORE_FIXTURE.handover.blocked.missingInfo).toHaveLength(1);
    expect(MVP_CORE_FIXTURE.handover.blocked.missingInfo[0].id).toBe(
      MVP_CORE_FIXTURE.handover.supplyAction.resolvedItem.missingInfoId,
    );
    expect(MVP_CORE_FIXTURE.handover.supplyAction).toMatchObject({
      operation: "SupplyHandoverInfo",
      label: "补齐上次检查结果",
    });
    expect(MVP_CORE_FIXTURE.reminder.initialOwnerId).toBe(
      MVP_CORE_FIXTURE.responsibility.domain.ownerId,
    );
    expect(Date.parse(MVP_CORE_FIXTURE.reminder.scheduledFor)).toBeGreaterThan(
      Date.parse(MVP_CORE_FIXTURE.eventTimeline.acceptedAt),
    );

    expect(MVP_CORE_STYLE_A_CSS_VARIABLES).toEqual({
      "--style-a-background": "#F4F1EA",
      "--style-a-surface": "#FFFFFF",
      "--style-a-text": "#1F1C17",
      "--style-a-primary": "#33513F",
      "--style-a-accent": "#8A5A3B",
      "--style-a-warning": "#9C4E22",
    });
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.cssVariables).toBe(
      MVP_CORE_STYLE_A_CSS_VARIABLES,
    );
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.compactRailMaximumWidthPx).toBe(330);
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.cardVerticalPaddingPx).toEqual({
      minimum: 16,
      maximum: 20,
    });
    for (const card of Object.values(
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards,
    )) {
      expect(card.zones).toEqual(["title", "content", "state", "actions"]);
      expect(card.minimumHeightPx).toBeGreaterThanOrEqual(240);
    }
  });
});

describe("MVP core testkit behavior", () => {
  it("persists consent, report, five owners, handover, owner/reminder transfer, and reload", () => {
    const persistence = createMemoryMvpCorePersistence();
    const harness = createMvpCoreHarness(persistence);
    const subject = issueSession("subject");
    const primary = issueSession("primary");
    const partner = issueSession("partner");

    expect(harness.execute(subject, { command: "record_share_consent" })).toMatchObject({
      ok: true,
      state: { consent: "shared", sharedRows: 0 },
    });
    expect(harness.execute(subject, { command: "publish_consented_signal" })).toMatchObject({
      ok: true,
      state: { sharedRows: 1, sharedWriteCount: 1 },
    });

    const report = harness.execute(primary, { command: "generate_report" });
    expect(report).toMatchObject({ ok: true, state: { reportRows: 5 } });
    if (!report.ok) {
      throw new Error("Expected the canonical report to be generated");
    }
    expect(report.result.report).toEqual(MVP_CORE_FIXTURE.responsibility.report);

    expect(harness.execute(primary, { command: "supply_handover_info" })).toMatchObject({
      ok: true,
      state: {
        handover: { status: "awaiting_confirmations" },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });
    expect(harness.execute(primary, { command: "confirm_handover_from" })).toMatchObject({
      ok: true,
      state: {
        handover: {
          status: "awaiting_confirmations",
          fromConfirmed: true,
          toConfirmed: false,
        },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });

    const accepted = harness.execute(partner, { command: "confirm_handover_to" });
    expect(MvpCoreCommandResponseSchema.parse(accepted)).toMatchObject({
      ok: true,
      state: {
        handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
        responsibilityOwners: MVP_CORE_FIXTURE.responsibility.stageOwners,
        domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
        futureReminderCount: 1,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      },
    });
    expect(harness.reload().snapshot()).toEqual(accepted.state);
  });

  it("keeps shared writes at zero when the subject does not consent", () => {
    const harness = createMvpCoreHarness();
    const subject = issueSession("subject");

    expect(harness.execute(subject, { command: "record_no_consent" })).toMatchObject({
      ok: true,
      state: { consent: "discarded", sharedRows: 0, sharedWriteCount: 0 },
    });
    expect(harness.execute(subject, { command: "publish_consented_signal" })).toMatchObject({
      ok: false,
      code: "consent_required",
      state: { sharedRows: 0, sharedWriteCount: 0 },
    });
  });

  it("leaves owner and reminder unchanged while blocked or one-sided", () => {
    const primary = issueSession("primary");
    const blockedHarness = createMvpCoreHarness();
    expect(blockedHarness.execute(primary, { command: "confirm_handover_from" })).toMatchObject({
      ok: false,
      code: "handover_blocked",
      state: {
        writeCount: 0,
        handover: { status: "blocked", fromConfirmed: false, toConfirmed: false },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });

    const oneSidedHarness = createMvpCoreHarness();
    oneSidedHarness.execute(primary, { command: "supply_handover_info" });
    expect(
      oneSidedHarness.execute(primary, { command: "confirm_handover_from" }),
    ).toMatchObject({
      ok: true,
      state: {
        handover: {
          status: "awaiting_confirmations",
          fromConfirmed: true,
          toConfirmed: false,
        },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });
  });

  it("moves domain and reminder atomically when the source confirms second", () => {
    const harness = createMvpCoreHarness();
    const primary = issueSession("primary");
    const partner = issueSession("partner");
    harness.execute(primary, { command: "supply_handover_info" });

    expect(harness.execute(partner, { command: "confirm_handover_to" })).toMatchObject({
      ok: true,
      state: {
        handover: {
          status: "awaiting_confirmations",
          fromConfirmed: false,
          toConfirmed: true,
        },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });
    expect(harness.execute(primary, { command: "confirm_handover_from" })).toMatchObject({
      ok: true,
      state: {
        handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
        domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      },
    });
  });

  it("denies partner probes and every authority/content tamper with zero writes", () => {
    const harness = createMvpCoreHarness();
    const partner = issueSession("partner");
    const guessedId = MVP_CORE_FIXTURE.privateConversation.message.id;
    const rawText = MVP_CORE_FIXTURE.privateConversation.message.content;

    const responses = [
      harness.execute(partner, { command: "read_private_message", targetId: guessedId }),
      harness.execute(partner, { command: "share_private_message", targetId: guessedId }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        subjectId: MVP_CORE_FIXTURE.actors.subject.memberId,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        subject: MVP_CORE_FIXTURE.actors.subject.memberId,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        role: "subject",
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        actor: MVP_CORE_FIXTURE.actors.subject,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        actorId: MVP_CORE_FIXTURE.actors.subject.memberId,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        space: MVP_CORE_FIXTURE.space.id,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        spaceId: MVP_CORE_FIXTURE.space.id,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        scenario: MVP_CORE_SCENARIO_ID,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        scenarioId: MVP_CORE_SCENARIO_ID,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        content: rawText,
      }),
      harness.execute(partner, {
        command: "read_private_message",
        targetId: guessedId,
        privateText: rawText,
      }),
      harness.execute(partner, {
        command: "record_share_consent",
        targetId: guessedId,
      }),
    ];

    expect(responses[0]).toMatchObject({ ok: false, code: "not_found" });
    expect(responses[1]).toMatchObject({ ok: false, code: "not_found" });
    for (const response of responses.slice(2)) {
      expect(response).toMatchObject({ ok: false, code: "invalid_request" });
    }
    expect(JSON.stringify(responses)).not.toContain(rawText);
    expect(harness.snapshot()).toMatchObject({
      revision: 0,
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  it("requires issued server context and strict command-specific bodies", () => {
    const guessedId = MVP_CORE_FIXTURE.privateConversation.message.id;
    expect(
      MvpCoreCommandRequestSchema.safeParse({
        command: "read_private_message",
        targetId: guessedId,
      }).success,
    ).toBe(true);
    expect(
      MvpCoreCommandRequestSchema.safeParse({ command: "read_private_message" }).success,
    ).toBe(false);
    expect(
      MvpCoreCommandRequestSchema.safeParse({
        command: "generate_report",
        targetId: guessedId,
      }).success,
    ).toBe(false);
    expect(
      MvpCoreCommandRequestSchema.safeParse({
        command: "record_share_consent",
        scenarioId: MVP_CORE_SCENARIO_ID,
        role: "subject",
      }).success,
    ).toBe(false);

    expect(
      issueMvpCoreFixtureSession({
        scenarioId: "mvp-core-tampered",
        role: "subject",
      }),
    ).toBeUndefined();
    expect(
      issueMvpCoreFixtureSession({
        scenarioId: MVP_CORE_SCENARIO_ID,
        role: "subject",
        actorId: MVP_CORE_FIXTURE.actors.subject.memberId,
      }),
    ).toBeUndefined();

    const harness = createMvpCoreHarness();
    const forgedSession = {
      scenarioId: MVP_CORE_SCENARIO_ID,
      role: "subject",
      actorId: MVP_CORE_FIXTURE.actors.subject.memberId,
      spaceId: MVP_CORE_FIXTURE.space.id,
    };
    expect(
      harness.execute(forgedSession, { command: "record_share_consent" }),
    ).toMatchObject({
      ok: false,
      code: "invalid_session",
      state: { writeCount: 0 },
    });
  });
});
