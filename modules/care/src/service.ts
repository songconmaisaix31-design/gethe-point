import {
  AcknowledgeCareEventRequestSchema,
  AcknowledgeCareEventResultSchema,
  AuditEntrySchema,
  CareSchedulerActorSchema,
  ConfirmCareRuleRequestSchema,
  ConfirmCareRuleResultSchema,
  HandleCareEventRequestSchema,
  HandleCareEventResultSchema,
  MemberActorSchema,
  TickCareSchedulerRequestSchema,
  TickCareSchedulerResultSchema,
  type AcknowledgeCareEventResult,
  type Actor,
  type AuditEntry,
  type CareEvent,
  type CareRule,
  type Clock,
  type ConfirmCareRuleResult,
  type HandleCareEventResult,
  type IdempotencyKey,
  type MemberActor,
  type TickCareSchedulerResult,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  assertNotFuture,
  clockReading,
  deterministicUuid,
  requestHash,
  scheduleOccurrencesForTick,
  timestampMillis,
} from "./deterministic";
import {
  type CareRepository,
  type CareTransaction,
  throwCareOperationError,
} from "./repository";
import {
  acknowledgeCareEventState,
  activateCareRule,
  advanceCareEvent,
  assertConfirmableCareFacts,
  createScheduledCareEvent,
  handleCareEventState,
  hydrateNotificationIntentIds,
  notificationIntentsForAdvance,
  replayedNotificationIntents,
  requiredRecipientsForNextTransition,
} from "./state-machine";

export interface CareServiceDependencies {
  readonly clock: Clock;
  readonly repository: CareRepository;
}

export interface CareService {
  ConfirmCareRule(
    actor: unknown,
    request: unknown,
  ): Promise<ConfirmCareRuleResult>;
  TickCareScheduler(
    actor: unknown,
    request: unknown,
  ): Promise<TickCareSchedulerResult>;
  AcknowledgeCareEvent(
    actor: unknown,
    request: unknown,
  ): Promise<AcknowledgeCareEventResult>;
  HandleCareEvent(
    actor: unknown,
    request: unknown,
  ): Promise<HandleCareEventResult>;
}

const actorReference = (actor: Actor): AuditEntry["actor"] =>
  actor.kind === "member"
    ? {
        kind: "member",
        memberId: actor.memberId,
        role: actor.role,
        spaceId: actor.spaceId,
      }
    : {
        kind: "system",
        service: actor.service,
        spaceId: actor.spaceId,
      };

const careVisibilityMemberIds = (
  rule: CareRule,
  actor: Actor,
): readonly string[] => {
  const candidates = [
    rule.subjectId,
    ...(actor.kind === "member" ? [actor.memberId] : []),
    rule.primaryCaregiverId,
    ...rule.escalationChain.flatMap((step) => step.targetMemberIds),
  ];
  return [...new Set(candidates)].slice(0, 3);
};

const auditId = (
  operation: string,
  idempotencyKey: IdempotencyKey,
  targetId: string,
  afterVersion: number,
): string =>
  deterministicUuid(
    `care-audit:${operation}:${idempotencyKey}:${targetId}:${String(afterVersion)}`,
  );

const createRuleConfirmationAudit = (
  actor: MemberActor,
  rule: CareRule,
  idempotencyKey: IdempotencyKey,
  occurredAt: Timestamp,
): AuditEntry =>
  AuditEntrySchema.parse({
    action: "care_rule_confirmed",
    actor: actorReference(actor),
    afterVersion: rule.version,
    beforeVersion: rule.version - 1,
    changes: [
      {
        after: { kind: "state", value: "active" },
        before: { kind: "state", value: "draft" },
        field: "status",
      },
    ],
    id: auditId("ConfirmCareRule", idempotencyKey, rule.id, rule.version),
    occurredAt,
    retention: "until_space_deleted",
    spaceId: rule.spaceId,
    targetId: rule.id,
    targetType: "care_rule",
    visibility: {
      kind: "care_related",
      memberIds: careVisibilityMemberIds(rule, actor),
      subjectId: rule.subjectId,
    },
  });

const createEventTransitionAudit = (
  actor: Actor,
  rule: CareRule,
  previous: CareEvent,
  next: CareEvent,
  operation: string,
  idempotencyKey: IdempotencyKey,
  occurredAt: Timestamp,
): AuditEntry => {
  const changes: AuditEntry["changes"] = [
    {
      after: { kind: "state", value: next.state },
      before: { kind: "state", value: previous.state },
      field: "status",
    },
    ...(previous.escalationLevel === next.escalationLevel
      ? []
      : [
          {
            after: { kind: "count" as const, value: next.escalationLevel },
            before: {
              kind: "count" as const,
              value: previous.escalationLevel,
            },
            field: "escalationLevel" as const,
          },
        ]),
  ];
  return AuditEntrySchema.parse({
    action: "care_event_transitioned",
    actor: actorReference(actor),
    afterVersion: next.version,
    beforeVersion: previous.version,
    changes,
    id: auditId(operation, idempotencyKey, next.id, next.version),
    occurredAt,
    retention: "until_space_deleted",
    spaceId: next.spaceId,
    targetId: next.id,
    targetType: "care_event",
    visibility: {
      kind: "care_related",
      memberIds: careVisibilityMemberIds(rule, actor),
      subjectId: rule.subjectId,
    },
  });
};

const parseMemberActor = (input: unknown): MemberActor => {
  const parsed = MemberActorSchema.safeParse(input);
  if (!parsed.success) {
    return throwCareOperationError("unauthenticated");
  }
  return parsed.data;
};

const eventOrder = (left: CareEvent, right: CareEvent): number =>
  timestampMillis(left.scheduledFor) - timestampMillis(right.scheduledFor) ||
  left.id.localeCompare(right.id);

const confirmCareRule = async (
  dependencies: CareServiceDependencies,
  rawActor: unknown,
  rawRequest: unknown,
): Promise<ConfirmCareRuleResult> => {
  const actor = parseMemberActor(rawActor);
  const parsedRequest = ConfirmCareRuleRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    return throwCareOperationError("invalid_request");
  }
  const request = parsedRequest.data;
  const clock = clockReading(dependencies.clock);
  assertNotFuture(request.confirmedAt, clock.milliseconds);
  assertConfirmableCareFacts(request.schedule, request.escalationChain);

  const execution = await dependencies.repository.executeIdempotent({
    actor,
    claimedAt: request.confirmedAt,
    idempotencyKey: request.idempotencyKey,
    operation: "ConfirmCareRule",
    parseResult: (value) => ConfirmCareRuleResultSchema.parse(value),
    requestHash: requestHash(request),
    work: async (transaction) => {
      const rule = await transaction.getCareRuleForUpdate(request.careRuleId);
      if (rule === null) {
        return throwCareOperationError("not_found");
      }
      if (
        actor.memberId !== rule.subjectId &&
        actor.memberId !== rule.primaryCaregiverId
      ) {
        return throwCareOperationError("forbidden");
      }
      if (rule.status !== "draft") {
        return throwCareOperationError("transition_denied");
      }
      if (rule.version !== request.expectedVersion) {
        return throwCareOperationError("stale_version");
      }
      if (timestampMillis(request.confirmedAt) < timestampMillis(rule.createdAt)) {
        return throwCareOperationError("invalid_request");
      }
      if (!(await transaction.isEvidenceAvailable(rule.createdFromEvidenceId))) {
        return throwCareOperationError("evidence_missing");
      }
      const confirmedMemberIds = [
        rule.subjectId,
        rule.primaryCaregiverId,
        ...request.escalationChain.flatMap((step) => step.targetMemberIds),
      ];
      if (!(await transaction.areMembersActive(confirmedMemberIds))) {
        return throwCareOperationError("conflict");
      }

      const activeRule = activateCareRule(rule, actor, request);
      await transaction.saveCareRule(activeRule, rule.version);
      await transaction.appendAuditEntry(
        createRuleConfirmationAudit(
          actor,
          activeRule,
          request.idempotencyKey,
          request.confirmedAt,
        ),
      );
      return ConfirmCareRuleResultSchema.parse({
        careRule: activeRule,
        status: "active",
      });
    },
  });
  return execution.result;
};

const appendEventTransition = async (
  transaction: CareTransaction,
  actor: Actor,
  rule: CareRule,
  previous: CareEvent,
  next: CareEvent,
  operation: string,
  idempotencyKey: IdempotencyKey,
  occurredAt: Timestamp,
): Promise<void> => {
  await transaction.saveCareEvent(next, previous.version);
  await transaction.appendAuditEntry(
    createEventTransitionAudit(
      actor,
      rule,
      previous,
      next,
      operation,
      idempotencyKey,
      occurredAt,
    ),
  );
};

const tickCareScheduler = async (
  dependencies: CareServiceDependencies,
  rawActor: unknown,
  rawRequest: unknown,
): Promise<TickCareSchedulerResult> => {
  const parsedActor = CareSchedulerActorSchema.safeParse(rawActor);
  if (!parsedActor.success) {
    return throwCareOperationError("unauthenticated");
  }
  const actor = parsedActor.data;
  const parsedRequest = TickCareSchedulerRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    return throwCareOperationError("invalid_request");
  }
  const request = parsedRequest.data;
  const clock = clockReading(dependencies.clock);
  if (timestampMillis(request.observedAt) !== clock.milliseconds) {
    return throwCareOperationError("invalid_request");
  }

  const execution = await dependencies.repository.executeIdempotent({
    actor,
    claimedAt: request.observedAt,
    idempotencyKey: request.idempotencyKey,
    operation: "TickCareScheduler",
    parseResult: (value) => TickCareSchedulerResultSchema.parse(value),
    requestHash: requestHash(request),
    work: async (transaction) => {
      const rules = await transaction.listCareRulesForUpdate();
      const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
      const storedEvents = await transaction.listCareEventsForUpdate();
      const events = storedEvents
        .map((event) => {
          const rule = rulesById.get(event.careRuleId);
          return rule === undefined
            ? event
            : hydrateNotificationIntentIds(event, rule);
        })
        .sort(eventOrder);
      const changedEvents: CareEvent[] = [];
      const notificationIntents: TickCareSchedulerResult["notificationIntents"] =
        [];
      let remaining = request.batchSize;

      for (const event of events) {
        if (remaining === 0) {
          break;
        }
        const rule = rulesById.get(event.careRuleId);
        if (rule === undefined) {
          continue;
        }
        const recipients = requiredRecipientsForNextTransition(
          event,
          rule,
          request.observedAt,
        );
        const recipientsAvailable =
          recipients.length === 0 ||
          (await transaction.areMembersActive(recipients));
        const advance = advanceCareEvent(
          event,
          rule,
          request.observedAt,
          recipientsAvailable,
        );
        if (advance === null) {
          continue;
        }
        await appendEventTransition(
          transaction,
          actor,
          rule,
          event,
          advance.event,
          "TickCareScheduler",
          request.idempotencyKey,
          request.observedAt,
        );
        changedEvents.push(advance.event);
        notificationIntents.push(
          ...notificationIntentsForAdvance(event, advance),
        );
        remaining -= 1;
      }

      const activeRules = rules
        .filter((rule): rule is Extract<CareRule, { status: "active" }> =>
          rule.status === "active",
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const rule of activeRules) {
        if (remaining === 0) {
          break;
        }
        for (const scheduledFor of scheduleOccurrencesForTick(
          rule,
          request.observedAt,
        )) {
          if (remaining === 0) {
            break;
          }
          const event = createScheduledCareEvent(
            rule,
            scheduledFor,
            request.observedAt,
          );
          if ((await transaction.insertCareEvent(event)) === "created") {
            changedEvents.push(event);
            remaining -= 1;
          }
        }
      }

      return TickCareSchedulerResultSchema.parse({
        events: changedEvents.sort(eventOrder),
        notificationIntents,
        replayed: false,
        status: "processed",
      });
    },
  });

  if (!execution.replayed) {
    return execution.result;
  }
  return TickCareSchedulerResultSchema.parse({
    ...execution.result,
    notificationIntents: replayedNotificationIntents(
      execution.result.notificationIntents,
    ),
    replayed: true,
  });
};

const acknowledgeCareEvent = async (
  dependencies: CareServiceDependencies,
  rawActor: unknown,
  rawRequest: unknown,
): Promise<AcknowledgeCareEventResult> => {
  const actor = parseMemberActor(rawActor);
  const parsedRequest = AcknowledgeCareEventRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    return throwCareOperationError("invalid_request");
  }
  const request = parsedRequest.data;
  const clock = clockReading(dependencies.clock);
  assertNotFuture(request.acknowledgedAt, clock.milliseconds);

  const execution = await dependencies.repository.executeIdempotent({
    actor,
    claimedAt: request.acknowledgedAt,
    idempotencyKey: request.idempotencyKey,
    operation: "AcknowledgeCareEvent",
    parseResult: (value) => AcknowledgeCareEventResultSchema.parse(value),
    requestHash: requestHash(request),
    work: async (transaction) => {
      const storedEvent = await transaction.getCareEventForUpdate(
        request.careEventId,
      );
      if (storedEvent === null) {
        return throwCareOperationError("not_found");
      }
      const rule = await transaction.getCareRuleForUpdate(
        storedEvent.careRuleId,
      );
      if (rule === null) {
        return throwCareOperationError("not_found");
      }
      if (actor.memberId !== storedEvent.subjectId) {
        return throwCareOperationError("forbidden");
      }
      if (storedEvent.version !== request.expectedVersion) {
        return throwCareOperationError("stale_version");
      }
      const event = hydrateNotificationIntentIds(storedEvent, rule);
      const acknowledged = acknowledgeCareEventState(
        event,
        request.acknowledgedAt,
      );
      await appendEventTransition(
        transaction,
        actor,
        rule,
        event,
        acknowledged,
        "AcknowledgeCareEvent",
        request.idempotencyKey,
        request.acknowledgedAt,
      );
      return AcknowledgeCareEventResultSchema.parse({
        careEvent: acknowledged,
        status: "acknowledged",
      });
    },
  });
  return execution.result;
};

const handleCareEvent = async (
  dependencies: CareServiceDependencies,
  rawActor: unknown,
  rawRequest: unknown,
): Promise<HandleCareEventResult> => {
  const actor = parseMemberActor(rawActor);
  const parsedRequest = HandleCareEventRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    return throwCareOperationError("invalid_request");
  }
  const request = parsedRequest.data;
  const clock = clockReading(dependencies.clock);
  assertNotFuture(request.handledAt, clock.milliseconds);

  const execution = await dependencies.repository.executeIdempotent({
    actor,
    claimedAt: request.handledAt,
    idempotencyKey: request.idempotencyKey,
    operation: "HandleCareEvent",
    parseResult: (value) => HandleCareEventResultSchema.parse(value),
    requestHash: requestHash(request),
    work: async (transaction) => {
      const storedEvent = await transaction.getCareEventForUpdate(
        request.careEventId,
      );
      if (storedEvent === null) {
        return throwCareOperationError("not_found");
      }
      const rule = await transaction.getCareRuleForUpdate(
        storedEvent.careRuleId,
      );
      if (rule === null) {
        return throwCareOperationError("not_found");
      }
      const event = hydrateNotificationIntentIds(storedEvent, rule);
      if (event.state !== "escalated") {
        if (event.state === "closed" || event.state === "unresolved") {
          return throwCareOperationError("terminal_state");
        }
        return throwCareOperationError("transition_denied");
      }
      const currentStep = rule.escalationChain.find(
        (step) => step.level === event.escalationLevel,
      );
      if (!currentStep?.targetMemberIds.includes(actor.memberId)) {
        return throwCareOperationError("forbidden");
      }
      if (event.version !== request.expectedVersion) {
        return throwCareOperationError("stale_version");
      }
      const handled = handleCareEventState(event, request.handledAt);
      await appendEventTransition(
        transaction,
        actor,
        rule,
        event,
        handled,
        "HandleCareEvent",
        request.idempotencyKey,
        request.handledAt,
      );
      return HandleCareEventResultSchema.parse({
        careEvent: handled,
        status: "handled",
      });
    },
  });
  return execution.result;
};

export const createCareService = (
  dependencies: CareServiceDependencies,
): CareService =>
  Object.freeze({
    AcknowledgeCareEvent: (actor: unknown, request: unknown) =>
      acknowledgeCareEvent(dependencies, actor, request),
    ConfirmCareRule: (actor: unknown, request: unknown) =>
      confirmCareRule(dependencies, actor, request),
    HandleCareEvent: (actor: unknown, request: unknown) =>
      handleCareEvent(dependencies, actor, request),
    TickCareScheduler: (actor: unknown, request: unknown) =>
      tickCareScheduler(dependencies, actor, request),
  });

export const ConfirmCareRule = (
  dependencies: CareServiceDependencies,
  actor: unknown,
  request: unknown,
): Promise<ConfirmCareRuleResult> =>
  confirmCareRule(dependencies, actor, request);

export const TickCareScheduler = (
  dependencies: CareServiceDependencies,
  actor: unknown,
  request: unknown,
): Promise<TickCareSchedulerResult> =>
  tickCareScheduler(dependencies, actor, request);

export const AcknowledgeCareEvent = (
  dependencies: CareServiceDependencies,
  actor: unknown,
  request: unknown,
): Promise<AcknowledgeCareEventResult> =>
  acknowledgeCareEvent(dependencies, actor, request);

export const HandleCareEvent = (
  dependencies: CareServiceDependencies,
  actor: unknown,
  request: unknown,
): Promise<HandleCareEventResult> =>
  handleCareEvent(dependencies, actor, request);
