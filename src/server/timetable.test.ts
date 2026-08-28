import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

// @ts-expect-error Node's native TypeScript runner requires an explicit extension.
import { AgentQueryRequestSchema, DemoActionSchema } from "../contracts.ts";
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

describe("timetable contracts and seed", () => {
  test("rejects unknown fields and out-of-contract values", () => {
    assert.equal(
      DemoActionSchema.safeParse({
        type: "create_timetable_item",
        ownerId: "member_subject",
        title: "晚间用药",
        startsAt: "2026-08-29T19:00:00+08:00",
        durationMinutes: 30,
        category: "care",
        unexpected: true,
      }).success,
      false,
    );
    assert.equal(
      AgentQueryRequestSchema.safeParse({
        targetMemberId: "member_subject",
        message: " ",
      }).success,
      false,
    );
  });

  test("seeds six canonical items across every member and category", () => {
    const { database } = fixture();
    const rows = database
      .prepare("SELECT owner_id, category FROM timetable_items")
      .all() as unknown as readonly {
        readonly owner_id: string;
        readonly category: string;
      }[];

    assert.equal(rows.length, 6);
    assert.deepEqual(
      [...new Set(rows.map((item) => item.owner_id))].sort(),
      ["member_partner", "member_primary", "member_subject"],
    );
    assert.deepEqual(
      [...new Set(rows.map((item) => item.category))].sort(),
      ["care", "family", "responsibility"],
    );
  });
});

describe("timetable persistence and authorization", () => {
  test("persists a valid create and reset restores the canonical seed", async () => {
    const { database, service } = fixture();
    const created = await service.execute(
      { role: "primary" },
      {
        type: "create_timetable_item",
        ownerId: "member_subject",
        title: "  晚间复查用药  ",
        startsAt: "2026-08-29T19:00:00+08:00",
        durationMinutes: 30,
        category: "care",
        domainId: "domain_health",
      },
    );
    const item = created.timetableItems.find(
      (candidate) => candidate.title === "晚间复查用药",
    );
    assert.ok(item);
    assert.equal(item.ownerId, "member_subject");
    assert.equal(item.visibility, "household");
    assert.equal(item.endsAt, "2026-08-29T11:30:00.000Z");

    const reloaded = createDemoService(database).getState({ role: "primary" });
    assert.equal(
      reloaded.timetableItems.some((candidate) => candidate.id === item.id),
      true,
    );

    const reset = service.reset({ role: "primary" });
    assert.equal(reset.timetableItems.length, 6);
    assert.equal(
      reset.timetableItems.some((candidate) => candidate.id === item.id),
      false,
    );
  });

  test("enforces the Fixture week, valid references, and create roles", async () => {
    const { service } = fixture();
    await assert.rejects(
      service.execute(
        { role: "subject" },
        {
          type: "create_timetable_item",
          ownerId: "member_partner",
          title: "越权安排",
          startsAt: "2026-08-29T09:00:00+08:00",
          durationMinutes: 30,
          category: "care",
        },
      ),
      hasCode("forbidden"),
    );
    await assert.rejects(
      service.execute(
        { role: "partner" },
        {
          type: "create_timetable_item",
          ownerId: "member_subject",
          title: "越权责任",
          startsAt: "2026-08-29T09:00:00+08:00",
          durationMinutes: 30,
          category: "responsibility",
        },
      ),
      hasCode("forbidden"),
    );
    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "create_timetable_item",
          ownerId: "member_primary",
          title: "无效领域",
          startsAt: "2026-08-29T09:00:00+08:00",
          durationMinutes: 30,
          category: "family",
          domainId: "domain_missing",
        },
      ),
      hasCode("invalid_request"),
    );
    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "create_timetable_item",
          ownerId: "member_primary",
          title: "超出固定周",
          startsAt: "2026-08-30T23:45:00+08:00",
          durationMinutes: 30,
          category: "family",
          domainId: "domain_home",
        },
      ),
      hasCode("invalid_request"),
    );
  });

  test("allows only the current owner to complete a planned item", async () => {
    const { service } = fixture();
    await assert.rejects(
      service.execute(
        { role: "primary" },
        {
          type: "complete_timetable_item",
          itemId: "timetable_family_dinner",
        },
      ),
      hasCode("forbidden"),
    );

    const completed = await service.execute(
      { role: "partner" },
      {
        type: "complete_timetable_item",
        itemId: "timetable_family_dinner",
      },
    );
    const item = completed.timetableItems.find(
      (candidate) => candidate.id === "timetable_family_dinner",
    );
    assert.equal(item?.status, "completed");
    assert.equal(item?.canComplete, false);

    await assert.rejects(
      service.execute(
        { role: "partner" },
        {
          type: "complete_timetable_item",
          itemId: "timetable_family_dinner",
        },
      ),
      hasCode("conflict"),
    );
  });
});

describe("Fixture member Agent", () => {
  test("is read-only and routes supported Chinese intents deterministically", () => {
    const { database, service } = fixture();
    const before = database
      .prepare("SELECT * FROM timetable_items ORDER BY id")
      .all();
    const response = service.queryAgent(
      { role: "subject" },
      { targetMemberId: "member_subject", message: "我的用药和健康安排" },
    );
    const after = database
      .prepare("SELECT * FROM timetable_items ORDER BY id")
      .all();

    assert.equal(response.intent, "help");
    assert.equal(response.engine, "fixture_intent_router");
    assert.deepEqual(before, after);

    const hinted = service.queryAgent(
      { role: "subject" },
      {
        targetMemberId: "member_subject",
        message: "请帮我看看",
        intentHint: "care",
      },
    );
    assert.equal(hinted.intent, "care");
    assert.deepEqual(hinted.referencedItemIds, ["timetable_medicine", "timetable_walk"]);
  });

  test("target selection never expands the caller's role-safe projection", () => {
    const { service } = fixture();
    const ownerView = service.queryAgent(
      { role: "primary" },
      { targetMemberId: "member_primary", message: "日程安排" },
    );
    const otherView = service.queryAgent(
      { role: "partner" },
      { targetMemberId: "member_primary", message: "日程安排" },
    );

    assert.deepEqual(ownerView.referencedItemIds, [
      "timetable_school_form",
      "timetable_health_booking",
    ]);
    assert.deepEqual(otherView.referencedItemIds, []);
    assert.equal(otherView.text.includes("腿又疼了"), false);
  });

  test("rejects an unknown target member without exposing data", () => {
    const { service } = fixture();
    assert.throws(
      () =>
        service.queryAgent(
          { role: "primary" },
          { targetMemberId: "member_missing", message: "日程" },
        ),
      hasCode("not_found"),
    );
  });
});
