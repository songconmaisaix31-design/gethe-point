import { describe, expect, it } from "vitest";

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
} from "../../contracts/src/index";

import {
  createMemoryMvpCorePersistence,
  createMvpCoreHarness,
  MVP_CORE_FIXTURE,
  MVP_CORE_SCENARIO_ID,
  MvpCoreCommandResponseSchema,
} from "../src";

const command = (
  role: "primary" | "partner" | "subject",
  action:
    | "read_private_message"
    | "share_private_message"
    | "record_share_consent"
    | "record_no_consent"
    | "publish_consented_signal"
    | "generate_report"
    | "supply_handover_info"
    | "confirm_handover_from"
    | "confirm_handover_to",
  targetId?: string,
): Readonly<Record<string, string>> => ({
  scenarioId: MVP_CORE_SCENARIO_ID,
  role,
  command: action,
  ...(targetId === undefined ? {} : { targetId }),
});

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

    expect(MVP_CORE_FIXTURE.display.truthBadges).toEqual([
      "Fixture",
      "Local Demo",
      "Not Production Acceptance",
    ]);
    expect(MVP_CORE_FIXTURE.display.fictionalNotice).toContain("均为虚构");
    expect(new Set(MVP_CORE_FIXTURE.members.map(({ role }) => role))).toEqual(
      new Set(["primary", "partner", "subject"]),
    );
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

  it("fixes all five stage owners, one missing result, one reminder, and Style A depth", () => {
    expect(Object.values(MVP_CORE_FIXTURE.responsibility.stageOwners)).not.toContain(null);
    expect(MVP_CORE_FIXTURE.responsibility.stageOwners).toEqual({
      discoveredBy: MVP_CORE_FIXTURE.actors.subject.memberId,
      deadlineKeptBy: MVP_CORE_FIXTURE.actors.primary.memberId,
      scheduledBy: MVP_CORE_FIXTURE.actors.primary.memberId,
      executedBy: MVP_CORE_FIXTURE.actors.partner.memberId,
      followedUpBy: MVP_CORE_FIXTURE.actors.primary.memberId,
    });
    expect(MVP_CORE_FIXTURE.handover.blocked.missingInfo).toHaveLength(1);
    expect(MVP_CORE_FIXTURE.handover.blocked.missingInfo[0].id).toBe(
      MVP_CORE_FIXTURE.handover.supplyAction.resolvedItem.missingInfoId,
    );
    expect(MVP_CORE_FIXTURE.handover.supplyAction.operation).toBe("SupplyHandoverInfo");
    expect(MVP_CORE_FIXTURE.reminder.initialOwnerId).toBe(
      MVP_CORE_FIXTURE.responsibility.domain.ownerId,
    );
    expect(Date.parse(MVP_CORE_FIXTURE.reminder.scheduledFor)).toBeGreaterThan(
      Date.parse(MVP_CORE_FIXTURE.eventTimeline.acceptedAt),
    );
    expect(MVP_CORE_FIXTURE.layoutAcceptance.subjectViewport).toEqual({
      id: "mobile",
      width: 390,
      height: 844,
    });
    expect(MVP_CORE_FIXTURE.layoutAcceptance.desktopViewport).toEqual({
      id: "desktop",
      width: 1440,
      height: 900,
    });
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.cardVerticalPaddingPx).toEqual({
      minimum: 16,
      maximum: 20,
    });
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.responsibilityMinimumHeightPx).toBeGreaterThan(
      200,
    );
    expect(MVP_CORE_FIXTURE.layoutAcceptance.styleA.handoverMinimumHeightPx).toBeGreaterThan(250);
  });
});

describe("MVP core testkit behavior", () => {
  it("completes consent, report, handover, owner transfer, reminder transfer, and reload", () => {
    const persistence = createMemoryMvpCorePersistence();
    const harness = createMvpCoreHarness(persistence);

    const consent = harness.execute(command("subject", "record_share_consent"));
    expect(consent).toMatchObject({ ok: true, state: { consent: "shared", sharedRows: 0 } });

    const signal = harness.execute(command("subject", "publish_consented_signal"));
    expect(signal).toMatchObject({ ok: true, state: { sharedRows: 1, sharedWriteCount: 1 } });

    const report = harness.execute(command("primary", "generate_report"));
    expect(report).toMatchObject({ ok: true, state: { reportRows: 5 } });
    if (!report.ok) {
      throw new Error("Expected the canonical report to be generated");
    }
    expect(report.result.report).toEqual(MVP_CORE_FIXTURE.responsibility.report);

    const initial = harness.snapshot();
    expect(initial).toMatchObject({
      handover: { status: "blocked", fromConfirmed: false, toConfirmed: false },
      domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
    });

    const supplied = harness.execute(command("primary", "supply_handover_info"));
    expect(supplied).toMatchObject({
      ok: true,
      state: {
        handover: { status: "awaiting_confirmations" },
        domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      },
    });

    const sourceConfirmed = harness.execute(command("primary", "confirm_handover_from"));
    expect(sourceConfirmed).toMatchObject({
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

    const recipientConfirmed = harness.execute(command("partner", "confirm_handover_to"));
    expect(recipientConfirmed).toMatchObject({
      ok: true,
      state: {
        handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
        domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      },
    });

    expect(harness.reload().snapshot()).toEqual(recipientConfirmed.state);
  });

  it("keeps shared writes at zero when the subject does not consent", () => {
    const harness = createMvpCoreHarness();

    expect(harness.execute(command("subject", "record_no_consent"))).toMatchObject({
      ok: true,
      state: { consent: "discarded", sharedRows: 0, sharedWriteCount: 0 },
    });
    expect(harness.execute(command("subject", "publish_consented_signal"))).toMatchObject({
      ok: false,
      code: "consent_required",
      state: { sharedRows: 0, sharedWriteCount: 0 },
    });
  });

  it("leaves owner and reminder unchanged while blocked or one-sided", () => {
    const blockedHarness = createMvpCoreHarness();
    const blocked = blockedHarness.execute(command("primary", "confirm_handover_from"));
    expect(blocked).toMatchObject({
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
    oneSidedHarness.execute(command("primary", "supply_handover_info"));
    const oneSided = oneSidedHarness.execute(command("primary", "confirm_handover_from"));
    expect(oneSided).toMatchObject({
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

  it("accepts atomically when the source is the second confirmer", () => {
    const harness = createMvpCoreHarness();
    harness.execute(command("primary", "supply_handover_info"));

    const recipientFirst = harness.execute(command("partner", "confirm_handover_to"));
    expect(recipientFirst).toMatchObject({
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

    const sourceSecond = harness.execute(command("primary", "confirm_handover_from"));
    expect(sourceSecond).toMatchObject({
      ok: true,
      state: {
        handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
        domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
        reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      },
    });
  });

  it("does not enumerate a guessed subject message to the partner", () => {
    const harness = createMvpCoreHarness();
    const rawText = MVP_CORE_FIXTURE.privateConversation.message.content;
    const guessedId = MVP_CORE_FIXTURE.privateConversation.message.id;

    const read = harness.execute(command("partner", "read_private_message", guessedId));
    const share = harness.execute(command("partner", "share_private_message", guessedId));

    expect(read).toMatchObject({ ok: false, code: "not_found" });
    expect(share).toMatchObject({ ok: false, code: "not_found" });
    expect(JSON.stringify([read, share])).not.toContain(rawText);
    expect(harness.snapshot()).toMatchObject({
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  it("blocks unknown and tampered scenarios with zero writes", () => {
    const harness = createMvpCoreHarness();
    const unknown = harness.execute({
      scenarioId: "mvp-core-tampered",
      role: "subject",
      command: "record_share_consent",
    });
    const tampered = harness.execute({
      scenarioId: MVP_CORE_SCENARIO_ID,
      role: "subject",
      command: "record_share_consent",
      actorId: MVP_CORE_FIXTURE.actors.primary.memberId,
      spaceId: MVP_CORE_FIXTURE.ids.space,
      content: "client supplied content must never be trusted",
    });

    expect(MvpCoreCommandResponseSchema.parse(unknown)).toMatchObject({
      ok: false,
      code: "unknown_scenario",
      state: { writeCount: 0, sharedRows: 0 },
    });
    expect(MvpCoreCommandResponseSchema.parse(tampered)).toMatchObject({
      ok: false,
      code: "invalid_request",
      state: { writeCount: 0, sharedRows: 0 },
    });
    expect(harness.snapshot()).toMatchObject({
      revision: 0,
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });
});
