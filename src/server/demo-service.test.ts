import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { createDemoDatabase, type DemoDatabase } from "./database.ts";
// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { createDemoService, type DemoService } from "./demo-service.ts";

const openDatabases: DemoDatabase[] = [];

function fixture(): { readonly database: DemoDatabase; readonly service: DemoService } {
  const database = createDemoDatabase();
  openDatabases.push(database);
  return { database, service: createDemoService(database) };
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof Error && "code" in error && error.code === code;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

describe("consented evidence", () => {
  test("keeps direct-message evidence self-only until the speaker shares it", async () => {
    const { service } = fixture();

    assert.equal(
      service
        .getState({ role: "primary" })
        .evidence.some((item) => item.id === "evidence_subject_private"),
      false,
    );
    assert.equal(
      service
        .getState({ role: "subject" })
        .evidence.some((item) => item.id === "evidence_subject_private"),
      true,
    );

    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "share_evidence",
          evidenceId: "evidence_subject_private",
          visibility: "space",
        },
      ),
      hasCode("forbidden"),
    );

    await service.execute(
      { role: "subject" },
      {
        type: "share_evidence",
        evidenceId: "evidence_subject_private",
        visibility: "self",
      },
    );
    assert.equal(
      service
        .getState({ role: "primary" })
        .signals.some((item) => item.evidenceId === "evidence_subject_private"),
      false,
    );

    await service.execute(
      { role: "subject" },
      {
        type: "share_evidence",
        evidenceId: "evidence_subject_private",
        visibility: { members: ["member_primary"] },
      },
    );
    assert.equal(
      service
        .getState({ role: "primary" })
        .signals.some((item) => item.evidenceId === "evidence_subject_private"),
      true,
    );
    assert.equal(
      service
        .getState({ role: "partner" })
        .evidence.some((item) => item.id === "evidence_subject_private"),
      false,
    );
    assert.equal(
      service
        .getState({ role: "subject" })
        .evidence.some((item) => item.id === "evidence_subject_private"),
      true,
    );
  });

  test("deletion excludes affected work without rolling ownership back", async () => {
    const { service } = fixture();
    await service.execute(
      { role: "primary" },
      {
        type: "delete_evidence",
        evidenceId: "evidence_health_deadline",
        actorId: "member_primary",
      },
    );

    const state = service.getState({ role: "primary" });
    assert.equal(state.evidence.find((item) => item.id === "evidence_health_deadline")?.text, "[deleted]");
    assert.equal(state.signals.find((item) => item.evidenceId === "evidence_health_deadline")?.status, "needs_review");
    assert.equal(state.domains.find((item) => item.id === "domain_health")?.status, "needs_review");
    assert.equal(state.report.tasks.some((item) => item.id === "task_health_booking"), false);
    assert.equal(state.report.excludedNeedsReviewCount, 1);
  });
});

describe("responsibility and handover", () => {
  test("persists all five neutral responsibility stages", () => {
    const { service } = fixture();
    const report = service.getState({ role: "primary" }).report;
    const task = report.tasks.find((item) => item.id === "task_health_booking");

    assert.deepEqual(task, {
      id: "task_health_booking",
      domainId: "domain_health",
      title: "挂市三院骨科复查号",
      status: "open",
      futureReminderOwnerId: "member_primary",
      discoveredBy: "member_primary",
      deadlineKeptBy: "member_primary",
      scheduledBy: "member_primary",
      executedBy: "member_primary",
      followedUpBy: "member_primary",
    });
    assert.equal(report.title, "本周家庭责任记录");
  });

  test("blocks incomplete and stale handovers, then transfers owner and reminders atomically", async () => {
    const { database, service } = fixture();
    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "confirm_handover",
          handoverId: "handover_health",
          actorId: "member_primary",
          expectedVersion: 0,
        },
      ),
      hasCode("conflict"),
    );

    await service.execute(
      { role: "primary" },
      {
        type: "add_handover_info",
        handoverId: "handover_health",
        item: "last_report",
      },
    );
    await service.execute(
      { role: "primary" },
      {
        type: "confirm_handover",
        handoverId: "handover_health",
        actorId: "member_primary",
        expectedVersion: 1,
      },
    );
    await assert.rejects(
      service.execute(
        { role: "partner" },
        {
          type: "confirm_handover",
          handoverId: "handover_health",
          actorId: "member_partner",
          expectedVersion: 1,
        },
      ),
      hasCode("conflict"),
    );

    const beforeAcceptance = database
      .prepare("SELECT owner_id FROM domains WHERE id = 'domain_health'")
      .get() as { readonly owner_id: string };
    assert.equal(beforeAcceptance.owner_id, "member_primary");

    await service.execute(
      { role: "partner" },
      {
        type: "confirm_handover",
        handoverId: "handover_health",
        actorId: "member_partner",
        expectedVersion: 2,
      },
    );

    const accepted = service
      .getState({ role: "primary" })
      .handovers.find((item) => item.id === "handover_health");
    assert.equal(accepted?.state, "accepted");
    assert.deepEqual(accepted?.confirmedBy, ["member_primary", "member_partner"]);
    const ownership = database
      .prepare(
        `SELECT domains.owner_id, tasks.future_reminder_owner_id
         FROM domains JOIN tasks ON tasks.domain_id = domains.id
         WHERE domains.id = 'domain_health' AND tasks.id = 'task_health_booking'`,
      )
      .get() as {
      readonly owner_id: string;
      readonly future_reminder_owner_id: string;
    };
    assert.equal(ownership.owner_id, "member_partner");
    assert.equal(ownership.future_reminder_owner_id, "member_partner");
  });
});

describe("deterministic care", () => {
  test("requires activation and treats equality at the deadline as timed out", async () => {
    const { database, service } = fixture();
    await assert.rejects(
      service.execute(
        { role: "subject" },
        { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
      ),
      hasCode("conflict"),
    );
    await service.execute(
      { role: "subject" },
      {
        type: "activate_care_rule",
        careRuleId: "care_rule_medicine",
        actorId: "member_subject",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "subject" },
      { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    );
    await service.execute(
      { role: "subject" },
      { type: "advance_demo_clock", seconds: 60 },
    );

    assert.equal(
      service.getState({ role: "subject" }).careEvents[0]?.state,
      "escalated",
    );
    const recipients = database
      .prepare(
        `SELECT recipient_id FROM notification_logs
         WHERE logical_event_id = 'care_event_1_escalation'
         ORDER BY id`,
      )
      .all()
      .map((item) => (item as { readonly recipient_id: string }).recipient_id);
    assert.deepEqual(recipients, ["member_partner", "member_primary"]);
  });

  test("allows the subject to acknowledge strictly before the deadline", async () => {
    const { service } = fixture();
    await service.execute(
      { role: "subject" },
      {
        type: "activate_care_rule",
        careRuleId: "care_rule_medicine",
        actorId: "member_subject",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "subject" },
      { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    );
    await service.execute(
      { role: "subject" },
      {
        type: "acknowledge_care",
        careEventId: "care_event_1",
        actorId: "member_subject",
      },
    );
    const event = service.getState({ role: "subject" }).careEvents[0];
    assert.equal(event?.state, "closed");
    assert.equal(event?.acknowledgedAt, "2026-08-28T12:00:00.000Z");
    assert.equal(event?.closedAt, "2026-08-28T12:00:00.000Z");
  });

  test("allows only the subject to close an escalated event after deadline equality", async () => {
    const { service } = fixture();
    await service.execute(
      { role: "subject" },
      {
        type: "activate_care_rule",
        careRuleId: "care_rule_medicine",
        actorId: "member_subject",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "subject" },
      { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    );
    await service.execute(
      { role: "subject" },
      { type: "advance_demo_clock", seconds: 60 },
    );
    await assert.rejects(
      service.execute(
        { role: "partner" },
        {
          type: "acknowledge_care",
          careEventId: "care_event_1",
          actorId: "member_partner",
        },
      ),
      hasCode("forbidden"),
    );
    await service.execute(
      { role: "subject" },
      {
        type: "acknowledge_care",
        careEventId: "care_event_1",
        actorId: "member_subject",
      },
    );

    const event = service.getState({ role: "subject" }).careEvents[0];
    assert.equal(event?.state, "closed");
    assert.equal(event?.acknowledgedAt, "2026-08-28T12:01:00.000Z");
  });

  test("deduplicates the same logical notification in the bounded window", async () => {
    const { database, service } = fixture();
    await service.execute(
      { role: "subject" },
      {
        type: "activate_care_rule",
        careRuleId: "care_rule_medicine",
        actorId: "member_subject",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "subject" },
      { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    );
    await service.execute(
      { role: "subject" },
      { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    );

    const statuses = service
      .getState({ role: "subject" })
      .notificationLogs.filter(
        (item) => item.logicalEventId === "care_event_1" && item.channel === "app",
      )
      .map((item) => item.status);
    assert.deepEqual(statuses, ["shown_in_app", "deduplicated"]);
    const eventCount = database
      .prepare("SELECT COUNT(*) AS count FROM care_events")
      .get() as { readonly count: number };
    assert.equal(eventCount.count, 1);
  });
});

test("reset restores the exact Fixture state", async () => {
  const { service } = fixture();
  const initial = service.getState({ role: "primary" });
  await service.execute(
    { role: "primary" },
    {
      type: "add_handover_info",
      handoverId: "handover_health",
      item: "last_report",
    },
  );
  assert.deepEqual(service.reset({ role: "primary" }), initial);
  assert.throws(() => service.reset({ role: "partner" }), hasCode("forbidden"));
});
