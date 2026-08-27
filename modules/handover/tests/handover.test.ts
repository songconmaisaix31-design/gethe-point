import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AcceptedHandoverSchema,
  ProposeHandoverResultSchema,
  type EntityId,
  type Handover,
  type HandoverExpiryActor,
  type HandoverServiceActor,
  type MemberActor,
  type ProposeHandoverRequest,
  type ProposeHandoverResult,
} from "../../../packages/contracts/src/index";
import {
  createHandoverError,
  createHandoverService,
  isHandoverError,
  type AtomicHandoverAcceptanceInput,
  type AtomicHandoverAcceptancePort,
  type AtomicHandoverAcceptanceResult,
  type HandoverProposalContext,
  type HandoverStateMutationResult,
  type HandoverStatePort,
} from "../src/index";

const ids = {
  domain: randomUUID(),
  evidence: randomUUID(),
  evidenceA: randomUUID(),
  evidenceB: randomUUID(),
  from: randomUUID(),
  missingA: randomUUID(),
  missingB: randomUUID(),
  reminderActive: randomUUID(),
  reminderPaused: randomUUID(),
  space: randomUUID(),
  to: randomUUID(),
} satisfies Readonly<Record<string, EntityId>>;

const fromActor: MemberActor = {
  authentication: "fixture_demo",
  kind: "member",
  memberId: ids.from,
  role: "primary",
  spaceId: ids.space,
};

const toActor: MemberActor = {
  authentication: "fixture_demo",
  kind: "member",
  memberId: ids.to,
  role: "partner",
  spaceId: ids.space,
};

const acceptanceActor: HandoverServiceActor = {
  authentication: "internal_service",
  kind: "system",
  service: "handover_service",
  spaceId: ids.space,
};

const expiryActor: HandoverExpiryActor = {
  authentication: "internal_service",
  kind: "system",
  service: "handover_expiry_service",
  spaceId: ids.space,
};

const idempotencyKey = (label: string): string =>
  `${label}:0000000000000001`;

const proposalRequest = (
  missingInfo: ProposeHandoverRequest["missingInfo"],
): ProposeHandoverRequest => ({
  domainId: ids.domain,
  expectedDomainVersion: 0,
  expiresAt: "2026-08-28T00:00:00.000Z",
  idempotencyKey: idempotencyKey(`proposal-${randomUUID()}`),
  missingInfo,
  packet: {
    constraints: ["Use the confirmed vendor window."],
    contacts: [],
    evidenceIds: [ids.evidence],
    history: ["The fictional household renews this every month."],
    knownInformation: ["The renewal is due monthly."],
    nextAction: "Confirm the next service date.",
    scope: "Manage the fictional household service account.",
  },
  requestId: randomUUID(),
  toMemberId: ids.to,
});

interface DomainState {
  readonly futureTaskOwnerId: EntityId;
  readonly id: EntityId;
  readonly ownerId: EntityId;
  readonly spaceId: EntityId;
  readonly version: number;
}

interface ReminderState {
  readonly domainId: EntityId;
  readonly id: EntityId;
  readonly ownerMemberId: EntityId;
  readonly status: "active" | "paused";
}

interface Replay<Result> {
  readonly requestHash: string;
  readonly result: Result;
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const replayKey = (input: Readonly<{
  actorKey: string;
  idempotencyKey: string;
  operation: string;
  spaceId: EntityId;
}>): string =>
  `${input.spaceId}:${input.operation}:${input.actorKey}:${input.idempotencyKey}`;

const createHarness = () => {
  let domain: DomainState = {
    futureTaskOwnerId: ids.from,
    id: ids.domain,
    ownerId: ids.from,
    spaceId: ids.space,
    version: 0,
  };
  let reminders: ReminderState[] = [
    {
      domainId: ids.domain,
      id: ids.reminderActive,
      ownerMemberId: ids.from,
      status: "active",
    },
    {
      domainId: ids.domain,
      id: ids.reminderPaused,
      ownerMemberId: ids.from,
      status: "paused",
    },
  ];
  let audits: EntityId[] = [];
  let now = new Date("2026-08-27T08:00:00.000Z");
  let acceptanceCalls = 0;
  let failNextAcceptance = false;
  const handovers = new Map<EntityId, Handover>();
  const proposalReplays = new Map<string, Replay<ProposeHandoverResult>>();
  const transitionReplays = new Map<
    string,
    Replay<HandoverStateMutationResult>
  >();
  const acceptanceReplays = new Map<
    string,
    Replay<AtomicHandoverAcceptanceResult>
  >();

  const proposalContext = (): HandoverProposalContext => ({
    domain: {
      id: domain.id,
      ownerId: domain.ownerId,
      spaceId: domain.spaceId,
      version: domain.version,
    },
    recipient: {
      id: ids.to,
      spaceId: ids.space,
      status: "active",
    },
  });

  const state: HandoverStatePort = {
    getById: ({ handoverId, spaceId }) => {
      const handover = handovers.get(handoverId);
      return Promise.resolve(
        handover?.spaceId === spaceId ? clone(handover) : null,
      );
    },
    propose: (input, plan) => {
      const key = replayKey(input);
      const replay = proposalReplays.get(key);

      if (replay !== undefined) {
        if (replay.requestHash !== input.requestHash) {
          throw createHandoverError("idempotency_conflict");
        }

        return Promise.resolve(clone(replay.result));
      }

      const planned = plan(proposalContext());
      handovers.set(planned.handover.id, clone(planned.handover));
      const result = ProposeHandoverResultSchema.parse(planned.result);
      proposalReplays.set(key, { requestHash: input.requestHash, result });
      return Promise.resolve(clone(result));
    },
    transition: (input, plan) => {
      const key = replayKey(input);
      const replay = transitionReplays.get(key);

      if (replay !== undefined) {
        if (replay.requestHash !== input.requestHash) {
          throw createHandoverError("idempotency_conflict");
        }

        return Promise.resolve(clone(replay.result));
      }

      const current = handovers.get(input.handoverId) ?? null;
      const planned = plan(current === null ? null : clone(current));
      handovers.set(planned.handover.id, clone(planned.handover));
      transitionReplays.set(key, {
        requestHash: input.requestHash,
        result: clone(planned.result),
      });
      return Promise.resolve(clone(planned.result));
    },
  };

  const acceptance: AtomicHandoverAcceptancePort = {
    accept: (actor, input: AtomicHandoverAcceptanceInput) => {
      acceptanceCalls += 1;
      const key = `${actor.spaceId}:AcceptHandover:system:${actor.service}:${input.idempotencyKey}`;
      const replay = acceptanceReplays.get(key);

      if (replay !== undefined) {
        if (replay.requestHash !== input.requestHash) {
          throw createHandoverError("idempotency_conflict");
        }

        return Promise.resolve({
          ...clone(replay.result),
          status: "replayed" as const,
        });
      }

      const handover = handovers.get(input.handoverId);

      if (handover === undefined) {
        throw createHandoverError("not_found");
      }

      if (handover.version !== input.expectedHandoverVersion) {
        throw createHandoverError("stale_version");
      }

      if (
        handover.status !== "awaiting_confirmations" ||
        handover.missingInfo.length > 0
      ) {
        throw createHandoverError(
          handover.status === "accepted"
            ? "transition_denied"
            : "handover_blocked",
        );
      }

      if (
        handover.fromConfirmedAt === null ||
        handover.toConfirmedAt === null
      ) {
        throw createHandoverError("confirmation_required");
      }

      if (
        domain.version !== input.expectedDomainVersion ||
        domain.ownerId !== handover.fromMemberId
      ) {
        throw createHandoverError("stale_version");
      }

      const migratedReminderIds = reminders
        .filter(
          (reminder) =>
            reminder.domainId === domain.id &&
            reminder.ownerMemberId === handover.fromMemberId &&
            reminder.status === "active",
        )
        .map(({ id }) => id);
      const auditEntryId = randomUUID();
      const nextHandover = AcceptedHandoverSchema.parse({
        ...handover,
        acceptedAt: input.acceptedAt,
        status: "accepted",
        terminalAt: input.acceptedAt,
        updatedAt: input.acceptedAt,
        version: handover.version + 1,
      });
      const nextDomain: DomainState = {
        ...domain,
        futureTaskOwnerId: handover.toMemberId,
        ownerId: handover.toMemberId,
        version: domain.version + 1,
      };
      const nextReminders = reminders.map((reminder) =>
        reminder.domainId === domain.id &&
        reminder.ownerMemberId === handover.fromMemberId &&
        reminder.status === "active"
          ? { ...reminder, ownerMemberId: handover.toMemberId }
          : reminder,
      );
      const result: AtomicHandoverAcceptanceResult = {
        auditEntryId,
        domainId: domain.id,
        futureTaskDefaultsUpdated: true,
        handoverId: handover.id,
        migratedReminderIds,
        newOwnerId: handover.toMemberId,
        previousOwnerId: handover.fromMemberId,
        status: "accepted",
      };

      if (failNextAcceptance) {
        failNextAcceptance = false;
        throw createHandoverError("internal_failure");
      }

      handovers.set(nextHandover.id, nextHandover);
      domain = nextDomain;
      reminders = nextReminders;
      audits = [...audits, auditEntryId];
      acceptanceReplays.set(key, {
        requestHash: input.requestHash,
        result: clone(result),
      });
      return Promise.resolve(result);
    },
  };

  return {
    acceptance,
    acceptanceCallCount: () => acceptanceCalls,
    auditIds: () => clone(audits),
    clock: { now: () => new Date(now) },
    domain: () => clone(domain),
    failAcceptanceOnce: () => {
      failNextAcceptance = true;
    },
    getHandover: (id: EntityId) => clone(handovers.get(id)),
    reminders: () => clone(reminders),
    setNow: (value: string) => {
      now = new Date(value);
    },
    state,
  };
};

const expectCode = (code: string) => (error: unknown): boolean =>
  isHandoverError(error) && error.code === code;

describe("handover workflow", () => {
  it("keeps missing information blocked and requires both independent confirmations", async () => {
    const harness = createHarness();
    const service = createHandoverService(harness);
    const proposed = await service.propose(
      fromActor,
      proposalRequest([
        {
          id: ids.missingA,
          label: "Vendor contact",
          reason: "The recipient needs a callable contact.",
        },
        {
          id: ids.missingB,
          label: "Renewal date",
          reason: "The next operational deadline is unknown.",
        },
      ]),
    );

    expect(proposed.handover.status).toBe("blocked");
    await expect(
      service.confirmFrom(fromActor, {
        confirmedAt: "2026-08-27T08:01:00.000Z",
        expectedVersion: 0,
        handoverId: proposed.handover.id,
        idempotencyKey: idempotencyKey("blocked-confirm"),
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("handover_blocked"));

    const partiallySupplied = await service.supplyInformation(fromActor, {
      expectedVersion: 0,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("supply-first"),
      requestId: randomUUID(),
      resolvedItems: [
        {
          evidenceIds: [ids.evidenceA],
          missingInfoId: ids.missingA,
          value: "Use the fictional vendor help desk.",
        },
      ],
    });

    expect(partiallySupplied.handover.status).toBe("blocked");
    expect(partiallySupplied.handover.missingInfo).toHaveLength(1);
    await expect(
      service.confirmTo(toActor, {
        confirmedAt: "2026-08-27T08:02:00.000Z",
        expectedVersion: 1,
        handoverId: proposed.handover.id,
        idempotencyKey: idempotencyKey("partial-confirm"),
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("handover_blocked"));

    const completed = await service.supplyInformation(toActor, {
      expectedVersion: 1,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("supply-second"),
      requestId: randomUUID(),
      resolvedItems: [
        {
          evidenceIds: [ids.evidenceB],
          missingInfoId: ids.missingB,
          value: "The next fictional renewal is September 1.",
        },
      ],
    });

    expect(completed.handover.status).toBe("awaiting_confirmations");
    const fromConfirmationRequest = {
      confirmedAt: "2026-08-27T08:03:00.000Z",
      expectedVersion: 2,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("confirm-from"),
      requestId: randomUUID(),
    };
    const fromConfirmed = await service.confirmFrom(
      fromActor,
      fromConfirmationRequest,
    );
    const replayedFromConfirmation = await service.confirmFrom(
      fromActor,
      fromConfirmationRequest,
    );

    expect(replayedFromConfirmation).toEqual(fromConfirmed);
    expect(fromConfirmed.handover.toConfirmedAt).toBeNull();
    expect(harness.domain().ownerId).toBe(ids.from);
    const acceptanceRequest = {
      expectedDomainVersion: 0,
      expectedHandoverVersion: 3,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("accept-two-party"),
      requestId: randomUUID(),
    };

    await expect(
      service.accept(acceptanceActor, acceptanceRequest),
    ).rejects.toSatisfy(expectCode("confirmation_required"));
    expect(harness.acceptanceCallCount()).toBe(0);
    expect(harness.domain().ownerId).toBe(ids.from);

    const toConfirmed = await service.confirmTo(toActor, {
      confirmedAt: "2026-08-27T08:04:00.000Z",
      expectedVersion: 3,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("confirm-to"),
      requestId: randomUUID(),
    });
    expect(toConfirmed.handover.fromConfirmedAt).not.toBeNull();
    expect(harness.domain().ownerId).toBe(ids.from);

    const readyAcceptanceRequest = {
      ...acceptanceRequest,
      expectedHandoverVersion: 4,
    };
    const accepted = await service.accept(
      acceptanceActor,
      readyAcceptanceRequest,
    );

    expect(accepted.handover.status).toBe("accepted");
    expect(harness.domain()).toMatchObject({
      futureTaskOwnerId: ids.to,
      ownerId: ids.to,
    });
    expect(harness.reminders()).toEqual([
      expect.objectContaining({
        id: ids.reminderActive,
        ownerMemberId: ids.to,
      }),
      expect.objectContaining({
        id: ids.reminderPaused,
        ownerMemberId: ids.from,
      }),
    ]);
    expect(harness.auditIds()).toEqual([accepted.migration.auditEntryId]);
    expect(harness.acceptanceCallCount()).toBe(1);

    harness.setNow("2026-08-27T09:00:00.000Z");
    const replayedAcceptance = await service.accept(
      acceptanceActor,
      readyAcceptanceRequest,
    );

    expect(replayedAcceptance).toEqual(accepted);
    expect(harness.auditIds()).toHaveLength(1);
    expect(harness.acceptanceCallCount()).toBe(2);
    await expect(
      service.decline(toActor, {
        declinedAt: "2026-08-27T09:01:00.000Z",
        expectedVersion: 5,
        handoverId: proposed.handover.id,
        idempotencyKey: idempotencyKey("decline-accepted"),
        reason: "This must not rewrite acceptance.",
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("terminal_state"));
  });

  it("makes declined and expired outcomes terminal", async () => {
    const declinedHarness = createHarness();
    const declinedService = createHandoverService(declinedHarness);
    const proposed = await declinedService.propose(
      fromActor,
      proposalRequest([]),
    );
    const declined = await declinedService.decline(toActor, {
      declinedAt: "2026-08-27T08:10:00.000Z",
      expectedVersion: 0,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("decline-pending"),
      reason: "The recipient cannot take this domain.",
      requestId: randomUUID(),
    });

    expect(declined.handover.status).toBe("declined");
    await expect(
      declinedService.confirmFrom(fromActor, {
        confirmedAt: "2026-08-27T08:11:00.000Z",
        expectedVersion: 1,
        handoverId: proposed.handover.id,
        idempotencyKey: idempotencyKey("confirm-declined"),
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("terminal_state"));
    await expect(
      declinedService.accept(acceptanceActor, {
        expectedDomainVersion: 0,
        expectedHandoverVersion: 1,
        handoverId: proposed.handover.id,
        idempotencyKey: idempotencyKey("accept-declined"),
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("terminal_state"));

    const expiredHarness = createHarness();
    const expiredService = createHandoverService(expiredHarness);
    const blocked = await expiredService.propose(
      fromActor,
      proposalRequest([
        {
          id: ids.missingA,
          label: "Account reference",
          reason: "The recipient needs the reference.",
        },
      ]),
    );

    await expect(
      expiredService.expire(expiryActor, {
        expectedVersion: 0,
        handoverId: blocked.handover.id,
        idempotencyKey: idempotencyKey("expire-early"),
        observedAt: "2026-08-27T23:59:59.000Z",
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("transition_denied"));
    const expired = await expiredService.expire(expiryActor, {
      expectedVersion: 0,
      handoverId: blocked.handover.id,
      idempotencyKey: idempotencyKey("expire-due"),
      observedAt: "2026-08-28T00:00:00.000Z",
      requestId: randomUUID(),
    });

    expect(expired.handover.status).toBe("expired");
    await expect(
      expiredService.expire(expiryActor, {
        expectedVersion: 1,
        handoverId: blocked.handover.id,
        idempotencyKey: idempotencyKey("expire-terminal"),
        observedAt: "2026-08-28T00:01:00.000Z",
        requestId: randomUUID(),
      }),
    ).rejects.toSatisfy(expectCode("terminal_state"));
    expect(expiredHarness.domain().ownerId).toBe(ids.from);
  });

  it("rolls back every ownership effect when atomic acceptance fails", async () => {
    const harness = createHarness();
    const service = createHandoverService(harness);
    const proposed = await service.propose(fromActor, proposalRequest([]));
    await service.confirmFrom(fromActor, {
      confirmedAt: "2026-08-27T08:20:00.000Z",
      expectedVersion: 0,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("atomic-from"),
      requestId: randomUUID(),
    });
    await service.confirmTo(toActor, {
      confirmedAt: "2026-08-27T08:21:00.000Z",
      expectedVersion: 1,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("atomic-to"),
      requestId: randomUUID(),
    });
    const request = {
      expectedDomainVersion: 0,
      expectedHandoverVersion: 2,
      handoverId: proposed.handover.id,
      idempotencyKey: idempotencyKey("atomic-accept"),
      requestId: randomUUID(),
    };

    harness.failAcceptanceOnce();
    await expect(service.accept(acceptanceActor, request)).rejects.toSatisfy(
      expectCode("internal_failure"),
    );
    expect(harness.getHandover(proposed.handover.id)?.status).toBe(
      "awaiting_confirmations",
    );
    expect(harness.domain()).toMatchObject({
      futureTaskOwnerId: ids.from,
      ownerId: ids.from,
    });
    expect(harness.reminders().map(({ ownerMemberId }) => ownerMemberId)).toEqual([
      ids.from,
      ids.from,
    ]);
    expect(harness.auditIds()).toEqual([]);

    const accepted = await service.accept(acceptanceActor, request);
    expect(accepted.handover.status).toBe("accepted");
    expect(harness.domain().ownerId).toBe(ids.to);
    expect(harness.auditIds()).toHaveLength(1);
  });
});
