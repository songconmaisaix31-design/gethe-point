import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";

const contractsModulePath = "../../src/contracts.ts";
const { Channels, DemoActionSchema, Roles } = (await import(
  contractsModulePath
)) as typeof import("../../src/contracts");

const StageOwnerSchema = z.string().nullable();
const TaskSchema = z
  .object({
    id: z.string(),
    domainId: z.string(),
    title: z.string(),
    status: z.enum(["open", "completed"]),
    futureReminderOwnerId: z.string().nullable(),
    discoveredBy: StageOwnerSchema,
    deadlineKeptBy: StageOwnerSchema,
    scheduledBy: StageOwnerSchema,
    executedBy: StageOwnerSchema,
    followedUpBy: StageOwnerSchema,
  })
  .strict();

const FixtureSchema = z.object({
  fixtureId: z.literal("household_four_minute"),
  now: z.string().datetime(),
  truth: z.object({
    mode: z.literal("fixture"),
    label: z.string().min(1),
    robotEnabled: z.literal(false),
  }),
  members: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      role: z.enum(Roles),
      capacity: z.enum(["available", "limited"]),
    }),
  ),
  familyMessages: z.array(z.object({ id: z.string(), speakerId: z.string(), text: z.string() })),
  evidence: z.array(
    z.object({
      id: z.string(),
      speakerId: z.string(),
      occurredAt: z.string().datetime(),
      text: z.string(),
      visibility: z.enum(["self", "space", "care_related"]),
      deleted: z.boolean(),
    }),
  ),
  signals: z.array(
    z.object({
      id: z.string(),
      evidenceId: z.string(),
      summary: z.string(),
      status: z.literal("confirmed"),
    }),
  ),
  discussionOnlyEvidenceIds: z.array(z.string()),
  domains: z.array(z.object({ id: z.string(), ownerId: z.string().nullable() }).passthrough()),
  tasks: z.array(TaskSchema),
  report: z.object({ neutralSummary: z.string() }).passthrough(),
  handover: z.object({
    id: z.string(),
    domainId: z.string(),
    fromMemberId: z.string(),
    toMemberId: z.string(),
    state: z.literal("blocked"),
    missingItems: z.tuple([z.literal("last_report")]),
    confirmedBy: z.tuple([]),
    version: z.literal(0),
  }),
  careRule: z.object({
    id: z.string(),
    subjectId: z.string(),
    state: z.literal("draft"),
    acknowledgementTimeoutSeconds: z.literal(60),
    escalationMemberIds: z.tuple([z.string(), z.string()]),
    version: z.literal(0),
    activationRequiresActorId: z.string(),
  }).passthrough(),
  notificationExpectations: z.object({
    initial: z.tuple([]),
    trigger: z.array(z.object({ recipientId: z.string(), channel: z.enum(Channels), status: z.string() })),
    duplicateStatus: z.literal("deduplicated"),
    escalationOrder: z.tuple([z.string(), z.string()]),
  }),
  expectedRoleEvidenceIds: z.record(z.enum(Roles), z.array(z.string())),
  expectedBurdenCount: z.object({ beforeHandover: z.literal(7), afterHandover: z.literal(2) }),
});

async function loadFixture() {
  const json: unknown = JSON.parse(
    await readFile(new URL("../../fixtures/household.json", import.meta.url), "utf8"),
  );
  return FixtureSchema.parse(json);
}

test("fixture is deterministic and covers the bounded household story", async () => {
  const fixture = await loadFixture();

  assert.deepEqual(fixture.members.map(({ role }) => role), Roles);
  assert.equal(fixture.familyMessages.length, 3);
  assert.equal(fixture.domains.length, 3);
  assert.equal(fixture.signals.length, 8);
  assert.equal(fixture.discussionOnlyEvidenceIds.length, 2);
  assert.equal(fixture.tasks.length, 8);
  assert.equal(fixture.truth.robotEnabled, false);
  assert.deepEqual(fixture.notificationExpectations.escalationOrder, [
    "member_partner",
    "member_primary",
  ]);
});

test("self-only evidence is absent from both non-speaker projections", async () => {
  const fixture = await loadFixture();
  const privateId = "evidence_subject_private";

  assert.ok(fixture.expectedRoleEvidenceIds.subject.includes(privateId));
  assert.ok(!fixture.expectedRoleEvidenceIds.primary.includes(privateId));
  assert.ok(!fixture.expectedRoleEvidenceIds.partner.includes(privateId));
  assert.equal(
    fixture.evidence.find(({ id }) => id === privateId)?.visibility,
    "self",
  );
});

test("all five responsibility stages are persisted and report wording stays neutral", async () => {
  const fixture = await loadFixture();
  const stages = [
    "discoveredBy",
    "deadlineKeptBy",
    "scheduledBy",
    "executedBy",
    "followedUpBy",
  ] as const;

  for (const task of fixture.tasks) {
    for (const stage of stages) assert.ok(Object.hasOwn(task, stage));
  }

  assert.doesNotMatch(fixture.report.neutralSummary, /懒|不负责|拖累|排名|评分|诊断/);
});

test("fixture actions conform to the frozen public action contract", () => {
  const actions: readonly unknown[] = [
    { type: "share_evidence", evidenceId: "evidence_subject_private", visibility: "space" },
    { type: "add_handover_info", handoverId: "handover_health", item: "last_report" },
    { type: "confirm_handover", handoverId: "handover_health", actorId: "member_primary", expectedVersion: 1 },
    { type: "confirm_handover", handoverId: "handover_health", actorId: "member_partner", expectedVersion: 2 },
    { type: "activate_care_rule", careRuleId: "care_rule_medicine", actorId: "member_subject", expectedVersion: 0 },
    { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" },
    { type: "advance_demo_clock", seconds: 60 },
    { type: "acknowledge_care", careEventId: "care_event_medicine", actorId: "member_subject" },
  ];

  for (const action of actions) assert.doesNotThrow(() => DemoActionSchema.parse(action));
});
