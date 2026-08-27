import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  DraftCareRuleSchema,
  type Clock,
  type DraftCareRule,
  type MemberActor,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  createCareService,
  isCareOperationError,
  type CareService,
} from "../src/index";
import { createMemoryCareRepository } from "./memory-repository";

const IDS = {
  evidence: "00000000-0000-4000-8000-000000000010",
  partner: "00000000-0000-4000-8000-000000000003",
  primary: "00000000-0000-4000-8000-000000000001",
  rule: "00000000-0000-4000-8000-000000000020",
  space: "00000000-0000-4000-8000-000000000000",
  subject: "00000000-0000-4000-8000-000000000002",
} as const;

const AT = {
  confirm: "2026-08-27T07:00:00.000Z",
  firstEscalation: "2026-08-27T08:01:00.000Z",
  notify: "2026-08-27T08:00:00.000Z",
  scheduleTick: "2026-08-27T07:30:00.000Z",
  secondEscalation: "2026-08-27T08:02:00.000Z",
  unresolved: "2026-08-27T08:04:00.000Z",
} as const satisfies Readonly<Record<string, Timestamp>>;

const ACTORS = {
  partner: {
    authentication: "fixture_demo",
    kind: "member",
    memberId: IDS.partner,
    role: "partner",
    spaceId: IDS.space,
  },
  primary: {
    authentication: "fixture_demo",
    kind: "member",
    memberId: IDS.primary,
    role: "primary",
    spaceId: IDS.space,
  },
  scheduler: {
    authentication: "internal_service",
    kind: "system",
    service: "care_scheduler",
    spaceId: IDS.space,
  },
  subject: {
    authentication: "fixture_demo",
    kind: "member",
    memberId: IDS.subject,
    role: "subject",
    spaceId: IDS.space,
  },
} as const satisfies Readonly<Record<string, MemberActor | object>>;

const requestId = (sequence: number): string =>
  `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const idempotencyKey = (sequence: number): string =>
  `idem_care_test_${String(sequence).padStart(4, "0")}`;

const draftRule = (): DraftCareRule =>
  DraftCareRuleSchema.parse({
    ackTimeoutSec: 60,
    confirmedAt: null,
    confirmedBy: null,
    createdAt: AT.confirm,
    createdFromEvidenceId: IDS.evidence,
    escalationChain: [
      {
        action: "notify",
        delaySec: 60,
        level: 1,
        targetMemberIds: [IDS.partner],
      },
      {
        action: "request_in_person_check",
        delaySec: 120,
        level: 2,
        targetMemberIds: [IDS.primary],
      },
    ],
    id: IDS.rule,
    primaryCaregiverId: IDS.primary,
    requireAck: true,
    schedule: { at: AT.notify, kind: "one_time" },
    spaceId: IDS.space,
    status: "draft",
    subjectId: IDS.subject,
    terminalBehavior: "unresolved_after_chain",
    title: "Morning check",
    updatedAt: AT.confirm,
    version: 0,
  });

const createMutableClock = (initial: Timestamp) => {
  let current = initial;
  const clock: Clock = { now: () => new Date(current) };
  return {
    clock,
    set: (timestamp: Timestamp) => {
      current = timestamp;
    },
  };
};

const createHarness = () => {
  const memory = createMemoryCareRepository({
    activeMemberIds: [IDS.primary, IDS.subject, IDS.partner],
    availableEvidenceIds: [IDS.evidence],
    careRules: [draftRule()],
  });
  const mutableClock = createMutableClock(AT.confirm);
  return {
    ...memory,
    ...mutableClock,
    service: createCareService({
      clock: mutableClock.clock,
      repository: memory.repository,
    }),
  };
};

const confirmRule = async (service: CareService) =>
  service.ConfirmCareRule(ACTORS.primary, {
    ackTimeoutSec: 60,
    confirmedAt: AT.confirm,
    escalationChain: draftRule().escalationChain,
    expectedVersion: 0,
    idempotencyKey: idempotencyKey(1),
    careRuleId: IDS.rule,
    requestId: requestId(1),
    requireAck: true,
    schedule: { at: AT.notify, kind: "one_time" },
    terminalBehavior: "unresolved_after_chain",
  });

const tick = async (
  service: CareService,
  observedAt: Timestamp,
  sequence: number,
) =>
  service.TickCareScheduler(ACTORS.scheduler, {
    batchSize: 20,
    idempotencyKey: idempotencyKey(sequence),
    observedAt,
    requestId: requestId(sequence),
  });

const prepareEscalatedLevelOne = async () => {
  const harness = createHarness();
  await confirmRule(harness.service);
  harness.set(AT.scheduleTick);
  const scheduled = await tick(harness.service, AT.scheduleTick, 2);
  const eventId = scheduled.events[0]?.id;
  expect(eventId).toBeDefined();
  harness.set(AT.notify);
  await tick(harness.service, AT.notify, 3);
  harness.set(AT.firstEscalation);
  await tick(harness.service, AT.firstEscalation, 4);
  const escalated = await tick(
    harness.service,
    AT.firstEscalation,
    5,
  );
  expect(escalated.events[0]?.state).toBe("escalated");
  return { ...harness, eventId: eventId ?? "" };
};

describe("deterministic care service", () => {
  it("does not schedule or escalate an unconfirmed draft", async () => {
    const harness = createHarness();
    harness.set(AT.notify);

    const result = await tick(harness.service, AT.notify, 10);

    expect(result.events).toEqual([]);
    expect(result.notificationIntents).toEqual([]);
    expect(harness.snapshot().careEvents).toHaveLength(0);
    expect(harness.snapshot().careRules[0]?.status).toBe("draft");
  });

  it("persists one scheduled occurrence and makes an exact tick replay inert", async () => {
    const harness = createHarness();
    await confirmRule(harness.service);
    harness.set(AT.scheduleTick);

    const first = await tick(harness.service, AT.scheduleTick, 2);
    const replay = await tick(harness.service, AT.scheduleTick, 2);

    expect(first.replayed).toBe(false);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.state).toBe("scheduled");
    expect(replay.replayed).toBe(true);
    expect(replay.events[0]?.id).toBe(first.events[0]?.id);
    expect(harness.snapshot().careEvents).toHaveLength(1);

    harness.set(AT.notify);
    const notified = await tick(harness.service, AT.notify, 3);
    expect(notified.events[0]?.state).toBe("notified");
    expect(notified.notificationIntents).toMatchObject([
      {
        escalationLevel: 0,
        status: "pending",
        targetMemberId: IDS.subject,
      },
    ]);
  });

  it("replays acknowledgement and closes without an escalation", async () => {
    const harness = createHarness();
    await confirmRule(harness.service);
    harness.set(AT.scheduleTick);
    const scheduled = await tick(harness.service, AT.scheduleTick, 2);
    harness.set(AT.notify);
    await tick(harness.service, AT.notify, 3);
    const acknowledgedAt = "2026-08-27T08:00:30.000Z";
    harness.set(acknowledgedAt);
    const request = {
      acknowledgedAt,
      careEventId: scheduled.events[0]?.id,
      expectedVersion: 1,
      idempotencyKey: idempotencyKey(4),
      requestId: requestId(4),
    };

    const acknowledged = await harness.service.AcknowledgeCareEvent(
      ACTORS.subject,
      request,
    );
    const replay = await harness.service.AcknowledgeCareEvent(
      ACTORS.subject,
      request,
    );

    expect(acknowledged.careEvent.state).toBe("acknowledged");
    expect(replay.careEvent).toEqual(acknowledged.careEvent);
    expect(harness.snapshot().careEvents).toHaveLength(1);
    harness.set("2026-08-27T08:02:00.000Z");
    const closed = await tick(
      harness.service,
      "2026-08-27T08:02:00.000Z",
      5,
    );
    expect(closed.events[0]?.state).toBe("closed");
    expect(closed.notificationIntents).toEqual([]);
    expect(harness.snapshot().careEvents[0]?.escalationLevel).toBe(0);
  });

  it("uses every confirmed escalation level and ends visibly unresolved", async () => {
    const harness = await prepareEscalatedLevelOne();
    const levelOne = harness.snapshot().careEvents[0];
    expect(levelOne?.state).toBe("escalated");
    expect(levelOne?.escalationLevel).toBe(1);

    harness.set("2026-08-27T08:01:59.000Z");
    const tooEarly = await tick(
      harness.service,
      "2026-08-27T08:01:59.000Z",
      6,
    );
    expect(tooEarly.events).toEqual([]);

    harness.set(AT.secondEscalation);
    const levelTwo = await tick(
      harness.service,
      AT.secondEscalation,
      7,
    );
    expect(levelTwo.events[0]).toMatchObject({
      escalationLevel: 2,
      state: "escalated",
    });
    expect(levelTwo.notificationIntents).toMatchObject([
      { escalationLevel: 2, targetMemberId: IDS.primary },
    ]);

    harness.set("2026-08-27T08:03:59.000Z");
    expect(
      (await tick(harness.service, "2026-08-27T08:03:59.000Z", 8)).events,
    ).toEqual([]);
    harness.set(AT.unresolved);
    const unresolved = await tick(harness.service, AT.unresolved, 9);
    expect(unresolved.events[0]).toMatchObject({
      escalationLevel: 2,
      state: "unresolved",
      unresolvedAt: AT.unresolved,
    });
  });

  it("allows only the current escalation recipient to handle, then closes", async () => {
    const harness = await prepareEscalatedLevelOne();
    const handledAt = "2026-08-27T08:01:10.000Z";
    harness.set(handledAt);
    const request = {
      careEventId: harness.eventId,
      expectedVersion: 3,
      handledAt,
      idempotencyKey: idempotencyKey(20),
      requestId: requestId(20),
      resolution: "in_person_check_started",
    };

    await expect(
      harness.service.HandleCareEvent(ACTORS.primary, request),
    ).rejects.toSatisfy(
      (error: unknown) => isCareOperationError(error) && error.code === "forbidden",
    );
    const handled = await harness.service.HandleCareEvent(
      ACTORS.partner,
      request,
    );
    const replay = await harness.service.HandleCareEvent(
      ACTORS.partner,
      request,
    );
    expect(handled.careEvent.state).toBe("handled");
    expect(replay).toEqual(handled);

    harness.set("2026-08-27T08:01:11.000Z");
    const closed = await tick(
      harness.service,
      "2026-08-27T08:01:11.000Z",
      21,
    );
    expect(closed.events[0]?.state).toBe("closed");
  });

  it("keeps wall-clock waits and LLM dependencies out of production care code", async () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceFiles = (await readdir(sourceDirectory)).filter((file) =>
      file.endsWith(".ts"),
    );
    const source = (
      await Promise.all(
        sourceFiles.map((file) => readFile(new URL(file, sourceDirectory), "utf8")),
      )
    ).join("\n");

    expect(source).not.toMatch(/\bLLMProvider\b|\bsetTimeout\b|Date\.now\s*\(/u);
  });
});
