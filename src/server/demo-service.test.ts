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
        .evidence.some((item) => item.id === "evidence_private_pain"),
      false,
    );
    assert.equal(
      service
        .getState({ role: "subject" })
        .evidence.some((item) => item.id === "evidence_private_pain"),
      true,
    );

    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "share_evidence",
          evidenceId: "evidence_private_pain",
          visibility: "space",
        },
      ),
      hasCode("forbidden"),
    );

    await service.execute(
      { role: "subject" },
      {
        type: "share_evidence",
        evidenceId: "evidence_private_pain",
        visibility: "self",
      },
    );
    assert.equal(
      service
        .getState({ role: "primary" })
        .signals.some((item) => item.evidenceId === "evidence_private_pain"),
      false,
    );

    await service.execute(
      { role: "subject" },
      {
        type: "share_evidence",
        evidenceId: "evidence_private_pain",
        visibility: { members: ["member_primary"] },
      },
    );
    assert.equal(
      service
        .getState({ role: "primary" })
        .signals.some((item) => item.evidenceId === "evidence_private_pain"),
      true,
    );
    assert.equal(
      service
        .getState({ role: "partner" })
        .evidence.some((item) => item.id === "evidence_private_pain"),
      false,
    );
    assert.equal(
      service
        .getState({ role: "subject" })
        .evidence.some((item) => item.id === "evidence_private_pain"),
      true,
    );
  });

  test("deletion excludes affected work without rolling ownership back", async () => {
    const { service } = fixture();
    await service.execute(
      { role: "primary" },
      {
        type: "delete_evidence",
        evidenceId: "evidence_appointment",
        actorId: "member_primary",
      },
    );

    const state = service.getState({ role: "primary" });
    assert.equal(state.evidence.find((item) => item.id === "evidence_appointment")?.text, "[deleted]");
    assert.equal(state.signals.find((item) => item.evidenceId === "evidence_appointment")?.status, "needs_review");
    assert.equal(state.domains.find((item) => item.id === "domain_followup")?.status, "needs_review");
    assert.equal(state.report.tasks.some((item) => item.id === "task_followup"), false);
    assert.equal(state.report.excludedNeedsReviewCount, 1);
  });
});

describe("responsibility and handover", () => {
  test("persists all five neutral responsibility stages", () => {
    const { service } = fixture();
    const report = service.getState({ role: "primary" }).report;
    const task = report.tasks.find((item) => item.id === "task_report");

    assert.deepEqual(task, {
      id: "task_report",
      domainId: "domain_followup",
      title: "整理检查资料",
      status: "completed",
      futureReminderOwnerId: null,
      discoveredBy: "member_primary",
      deadlineKeptBy: "member_primary",
      scheduledBy: "member_primary",
      executedBy: "member_primary",
      followedUpBy: "member_partner",
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
          handoverId: "handover_followup",
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
        handoverId: "handover_followup",
        item: "last_report",
      },
    );
    await service.execute(
      { role: "primary" },
      {
        type: "confirm_handover",
        handoverId: "handover_followup",
        actorId: "member_primary",
        expectedVersion: 1,
      },
    );
    await assert.rejects(
      service.execute(
        { role: "partner" },
        {
          type: "confirm_handover",
          handoverId: "handover_followup",
          actorId: "member_partner",
          expectedVersion: 1,
        },
      ),
      hasCode("conflict"),
    );

    const beforeAcceptance = database
      .prepare("SELECT owner_id FROM domains WHERE id = 'domain_followup'")
      .get() as { readonly owner_id: string };
    assert.equal(beforeAcceptance.owner_id, "member_primary");

    await service.execute(
      { role: "partner" },
      {
        type: "confirm_handover",
        handoverId: "handover_followup",
        actorId: "member_partner",
        expectedVersion: 2,
      },
    );

    const accepted = service
      .getState({ role: "primary" })
      .handovers.find((item) => item.id === "handover_followup");
    assert.equal(accepted?.state, "accepted");
    assert.deepEqual(accepted?.confirmedBy, ["member_primary", "member_partner"]);
    const ownership = database
      .prepare(
        `SELECT domains.owner_id, tasks.future_reminder_owner_id
         FROM domains JOIN tasks ON tasks.domain_id = domains.id
         WHERE domains.id = 'domain_followup' AND tasks.id = 'task_followup'`,
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
        { role: "primary" },
        { type: "trigger_care_reminder", careRuleId: "care_medicine" },
      ),
      hasCode("conflict"),
    );
    await service.execute(
      { role: "primary" },
      {
        type: "activate_care_rule",
        careRuleId: "care_medicine",
        actorId: "member_primary",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "primary" },
      { type: "trigger_care_reminder", careRuleId: "care_medicine" },
    );
    await service.execute(
      { role: "primary" },
      { type: "advance_demo_clock", seconds: 30 },
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
    assert.deepEqual(recipients, ["member_primary", "member_partner"]);
  });

  test("allows the subject to acknowledge strictly before the deadline", async () => {
    const { service } = fixture();
    await service.execute(
      { role: "primary" },
      {
        type: "activate_care_rule",
        careRuleId: "care_medicine",
        actorId: "member_primary",
        expectedVersion: 0,
      },
    );
    await service.execute(
      { role: "primary" },
      { type: "trigger_care_reminder", careRuleId: "care_medicine" },
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
    assert.equal(event?.acknowledgedAt, "2026-08-28T09:00:00.000Z");
    assert.equal(event?.closedAt, "2026-08-28T09:00:00.000Z");
  });

  test("deduplicates the same logical notification in the bounded window", async () => {
    const { database, service } = fixture();
    await service.execute(
      { role: "primary" },
      {
        type: "activate_care_rule",
        careRuleId: "care_medicine",
        actorId: "member_primary",
        expectedVersion: 0,
      },
    );
    database
      .prepare(
        `INSERT INTO notification_logs(
          logical_event_id, recipient_id, channel, priority, template_id,
          status, safe_code, occurred_at
        ) VALUES ('care_event_1', 'member_subject', 'app', 'high',
                  'care_reminder', 'shown_in_app', NULL, '2026-08-28T09:00:00.000Z')`,
      )
      .run();
    await service.execute(
      { role: "primary" },
      { type: "trigger_care_reminder", careRuleId: "care_medicine" },
    );

    const statuses = service
      .getState({ role: "subject" })
      .notificationLogs.filter(
        (item) => item.logicalEventId === "care_event_1" && item.channel === "app",
      )
      .map((item) => item.status);
    assert.deepEqual(statuses, ["shown_in_app", "deduplicated"]);
  });
});

test("reset restores the exact Fixture state", async () => {
  const { service } = fixture();
  const initial = service.getState({ role: "primary" });
  await service.execute(
    { role: "primary" },
    {
      type: "add_handover_info",
      handoverId: "handover_followup",
      item: "last_report",
    },
  );
  assert.deepEqual(service.reset({ role: "primary" }), initial);
  assert.throws(() => service.reset({ role: "partner" }), hasCode("forbidden"));
});
