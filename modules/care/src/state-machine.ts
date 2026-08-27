import {
  ActiveCareRuleSchema,
  CareEventSchema,
  NotificationIntentSchema,
  getCareTransitionRule,
  type ActiveCareRule,
  type AcknowledgedCareEvent,
  type CareEvent,
  type CareRule,
  type CareSchedule,
  type ConfirmCareRuleRequest,
  type DraftCareRule,
  type EscalationStep,
  type HandledCareEvent,
  type MemberActor,
  type NotificationIntent,
  type Timestamp,
} from "../../../packages/contracts/src/index";
import {
  careOccurrenceKey,
  deterministicUuid,
  isSupportedTimeZone,
  timestampAfterSeconds,
  timestampMillis,
} from "./deterministic";
import { throwCareOperationError } from "./repository";

const assertAllowedTransition = (
  from: CareEvent["state"],
  to: CareEvent["state"],
  trigger:
    | "AcknowledgeCareEvent"
    | "CloseCareEvent"
    | "HandleCareEvent"
    | "TickCareScheduler",
): void => {
  const rule = getCareTransitionRule(from, to);
  if (rule.decision !== "allowed" || rule.trigger !== trigger) {
    throwCareOperationError("internal_failure");
  }
};

export const assertConfirmableCareFacts = (
  schedule: CareSchedule,
  escalationChain: readonly EscalationStep[],
): void => {
  if (schedule.kind === "daily" && !isSupportedTimeZone(schedule.timezone)) {
    throwCareOperationError("invalid_request");
  }
  if (
    escalationChain.some(
      (step, index) =>
        step.level !== index + 1 ||
        new Set(step.targetMemberIds).size !== step.targetMemberIds.length,
    )
  ) {
    throwCareOperationError("invalid_request");
  }
};

export const activateCareRule = (
  draft: DraftCareRule,
  actor: MemberActor,
  request: ConfirmCareRuleRequest,
): ActiveCareRule => {
  assertConfirmableCareFacts(request.schedule, request.escalationChain);
  return ActiveCareRuleSchema.parse({
    ...draft,
    ackTimeoutSec: request.ackTimeoutSec,
    confirmedAt: request.confirmedAt,
    confirmedBy: actor.memberId,
    escalationChain: request.escalationChain,
    requireAck: request.requireAck,
    schedule: request.schedule,
    status: "active",
    terminalBehavior: request.terminalBehavior,
    updatedAt: request.confirmedAt,
    version: draft.version + 1,
  });
};

export const createScheduledCareEvent = (
  rule: ActiveCareRule,
  scheduledFor: Timestamp,
  createdAt: Timestamp,
): CareEvent => {
  const occurrenceKey = careOccurrenceKey(rule.id, scheduledFor);
  return CareEventSchema.parse({
    acknowledgementDeadline: null,
    acknowledgedAt: null,
    careRuleId: rule.id,
    closedAt: null,
    createdAt,
    escalatedAt: null,
    escalationLevel: 0,
    handledAt: null,
    id: deterministicUuid(`care-event:${rule.spaceId}:${occurrenceKey}`),
    notificationIntentIds: [],
    notifiedAt: null,
    occurrenceKey,
    scheduledFor,
    spaceId: rule.spaceId,
    state: "scheduled",
    subjectId: rule.subjectId,
    timedOutAt: null,
    unresolvedAt: null,
    updatedAt: createdAt,
    version: 0,
  });
};

const notificationIdentity = (
  careEventId: string,
  escalationLevel: number,
  targetMemberId: string,
): Readonly<{ id: string; idempotencyKey: string }> => ({
  id: deterministicUuid(
    `care-notification:${careEventId}:${String(escalationLevel)}:${targetMemberId}`,
  ),
  idempotencyKey: `care-notify:${careEventId}:${String(escalationLevel)}:${targetMemberId}`,
});

const createNotificationIntent = (
  careEventId: string,
  escalationLevel: number,
  targetMemberId: string,
  status: NotificationIntent["status"],
): NotificationIntent =>
  NotificationIntentSchema.parse({
    ...notificationIdentity(careEventId, escalationLevel, targetMemberId),
    careEventId,
    channel: "agent_dm",
    escalationLevel,
    status,
    targetMemberId,
  });

const stepAtLevel = (
  rule: CareRule,
  level: number,
): EscalationStep | undefined =>
  rule.escalationChain.find((step) => step.level === level);

export const notificationIntentIdsForEvent = (
  event: CareEvent,
  rule: CareRule,
): readonly string[] => {
  const identities: string[] = [];
  if (event.notifiedAt !== null) {
    identities.push(notificationIdentity(event.id, 0, event.subjectId).id);
  }
  for (const step of rule.escalationChain) {
    if (step.level > event.escalationLevel) {
      break;
    }
    for (const targetMemberId of step.targetMemberIds) {
      identities.push(
        notificationIdentity(event.id, step.level, targetMemberId).id,
      );
    }
  }
  return identities;
};

export const hydrateNotificationIntentIds = (
  event: CareEvent,
  rule: CareRule,
): CareEvent =>
  CareEventSchema.parse({
    ...event,
    notificationIntentIds: notificationIntentIdsForEvent(event, rule),
  });

export const notificationIntentsForAdvance = (
  previous: CareEvent,
  advance: CareEventAdvance,
): readonly NotificationIntent[] => {
  const next = advance.event;
  if (previous.state === "scheduled" && next.state === "notified") {
    return [createNotificationIntent(next.id, 0, next.subjectId, "pending")];
  }
  if (advance.escalationStep !== null) {
    return notificationIntentsForEscalation(next, advance.escalationStep);
  }
  return [];
};

export const notificationIntentsForEscalation = (
  event: CareEvent,
  step: EscalationStep,
): readonly NotificationIntent[] =>
  step.targetMemberIds.map((targetMemberId) =>
    createNotificationIntent(
      event.id,
      step.level,
      targetMemberId,
      "pending",
    ),
  );

export const replayedNotificationIntents = (
  intents: readonly NotificationIntent[],
): readonly NotificationIntent[] =>
  intents.map((intent) => ({ ...intent, status: "already_recorded" }));

const currentEscalationStep = (
  event: CareEvent,
  rule: CareRule,
): EscalationStep | undefined =>
  event.state === "escalated"
    ? stepAtLevel(rule, event.escalationLevel)
    : undefined;

const nextEscalationStep = (
  event: CareEvent,
  rule: CareRule,
): EscalationStep | undefined => {
  if (event.state === "timed_out") {
    return stepAtLevel(rule, 1);
  }
  if (event.state === "escalated") {
    return stepAtLevel(rule, event.escalationLevel + 1);
  }
  return undefined;
};

const escalationWaitFinished = (
  event: CareEvent,
  rule: CareRule,
  observedAt: Timestamp,
): boolean => {
  if (event.state !== "escalated") {
    return true;
  }
  const currentStep = currentEscalationStep(event, rule);
  if (currentStep === undefined) {
    return true;
  }
  return (
    timestampMillis(observedAt) >=
    timestampMillis(event.escalatedAt) + currentStep.delaySec * 1_000
  );
};

export const requiredRecipientsForNextTransition = (
  event: CareEvent,
  rule: CareRule,
  observedAt: Timestamp,
): readonly string[] => {
  if (
    event.state === "scheduled" &&
    timestampMillis(observedAt) >= timestampMillis(event.scheduledFor)
  ) {
    return [event.subjectId];
  }
  if (event.state === "timed_out") {
    return nextEscalationStep(event, rule)?.targetMemberIds ?? [];
  }
  if (
    event.state === "escalated" &&
    escalationWaitFinished(event, rule, observedAt)
  ) {
    return nextEscalationStep(event, rule)?.targetMemberIds ?? [];
  }
  return [];
};

const unresolvedEvent = (
  event: CareEvent,
  observedAt: Timestamp,
): CareEvent => {
  assertAllowedTransition(event.state, "unresolved", "TickCareScheduler");
  return CareEventSchema.parse({
    ...event,
    state: "unresolved",
    unresolvedAt: observedAt,
    updatedAt: observedAt,
    version: event.version + 1,
  });
};

export interface CareEventAdvance {
  readonly event: CareEvent;
  readonly escalationStep: EscalationStep | null;
}

export const advanceCareEvent = (
  event: CareEvent,
  rule: CareRule,
  observedAt: Timestamp,
  recipientsAvailable: boolean,
): CareEventAdvance | null => {
  if (["closed", "unresolved"].includes(event.state)) {
    return null;
  }

  if (event.state === "acknowledged" || event.state === "handled") {
    assertAllowedTransition(event.state, "closed", "CloseCareEvent");
    return {
      escalationStep: null,
      event: CareEventSchema.parse({
        ...event,
        closedAt: observedAt,
        state: "closed",
        updatedAt: observedAt,
        version: event.version + 1,
      }),
    };
  }

  if (rule.status !== "active") {
    return null;
  }

  if (event.state === "scheduled") {
    if (timestampMillis(observedAt) < timestampMillis(event.scheduledFor)) {
      return null;
    }
    if (!recipientsAvailable) {
      return { escalationStep: null, event: unresolvedEvent(event, observedAt) };
    }
    assertAllowedTransition("scheduled", "notified", "TickCareScheduler");
    return {
      escalationStep: null,
      event: CareEventSchema.parse({
        ...event,
        acknowledgementDeadline: rule.requireAck
          ? timestampAfterSeconds(observedAt, rule.ackTimeoutSec)
          : null,
        notificationIntentIds: [
          notificationIdentity(event.id, 0, event.subjectId).id,
        ],
        notifiedAt: observedAt,
        state: "notified",
        updatedAt: observedAt,
        version: event.version + 1,
      }),
    };
  }

  if (event.state === "notified") {
    if (!rule.requireAck) {
      assertAllowedTransition("notified", "closed", "CloseCareEvent");
      return {
        escalationStep: null,
        event: CareEventSchema.parse({
          ...event,
          closedAt: observedAt,
          state: "closed",
          updatedAt: observedAt,
          version: event.version + 1,
        }),
      };
    }
    if (event.acknowledgementDeadline === null) {
      return { escalationStep: null, event: unresolvedEvent(event, observedAt) };
    }
    if (
      timestampMillis(observedAt) <
      timestampMillis(event.acknowledgementDeadline)
    ) {
      return null;
    }
    assertAllowedTransition("notified", "timed_out", "TickCareScheduler");
    return {
      escalationStep: null,
      event: CareEventSchema.parse({
        ...event,
        state: "timed_out",
        timedOutAt: event.acknowledgementDeadline,
        updatedAt: observedAt,
        version: event.version + 1,
      }),
    };
  }

  if (event.state === "timed_out") {
    const step = nextEscalationStep(event, rule);
    if (step === undefined || !recipientsAvailable) {
      return { escalationStep: null, event: unresolvedEvent(event, observedAt) };
    }
    assertAllowedTransition("timed_out", "escalated", "TickCareScheduler");
    return {
      escalationStep: step,
      event: CareEventSchema.parse({
        ...event,
        escalatedAt: observedAt,
        escalationLevel: step.level,
        notificationIntentIds: [
          ...event.notificationIntentIds,
          ...step.targetMemberIds.map(
            (targetMemberId) =>
              notificationIdentity(event.id, step.level, targetMemberId).id,
          ),
        ],
        state: "escalated",
        updatedAt: observedAt,
        version: event.version + 1,
      }),
    };
  }

  if (event.state === "escalated") {
    if (!escalationWaitFinished(event, rule, observedAt)) {
      return null;
    }
    const step = nextEscalationStep(event, rule);
    if (step === undefined || !recipientsAvailable) {
      return { escalationStep: null, event: unresolvedEvent(event, observedAt) };
    }
    assertAllowedTransition("escalated", "escalated", "TickCareScheduler");
    return {
      escalationStep: step,
      event: CareEventSchema.parse({
        ...event,
        escalatedAt: observedAt,
        escalationLevel: step.level,
        notificationIntentIds: [
          ...event.notificationIntentIds,
          ...step.targetMemberIds.map(
            (targetMemberId) =>
              notificationIdentity(event.id, step.level, targetMemberId).id,
          ),
        ],
        updatedAt: observedAt,
        version: event.version + 1,
      }),
    };
  }

  return null;
};

export const acknowledgeCareEventState = (
  event: CareEvent,
  acknowledgedAt: Timestamp,
): AcknowledgedCareEvent => {
  if (event.state === "closed" || event.state === "unresolved") {
    return throwCareOperationError("terminal_state");
  }
  if (event.state !== "notified" && event.state !== "escalated") {
    return throwCareOperationError("transition_denied");
  }
  if (timestampMillis(acknowledgedAt) < timestampMillis(event.notifiedAt)) {
    return throwCareOperationError("invalid_request");
  }
  if (
    event.state === "notified" &&
    (event.acknowledgementDeadline === null ||
      timestampMillis(acknowledgedAt) >
        timestampMillis(event.acknowledgementDeadline))
  ) {
    return throwCareOperationError("transition_denied");
  }
  assertAllowedTransition(
    event.state,
    "acknowledged",
    "AcknowledgeCareEvent",
  );
  return CareEventSchema.parse({
    ...event,
    acknowledgedAt,
    state: "acknowledged",
    updatedAt: acknowledgedAt,
    version: event.version + 1,
  }) as AcknowledgedCareEvent;
};

export const handleCareEventState = (
  event: CareEvent,
  handledAt: Timestamp,
): HandledCareEvent => {
  if (event.state === "closed" || event.state === "unresolved") {
    return throwCareOperationError("terminal_state");
  }
  if (event.state !== "escalated") {
    return throwCareOperationError("transition_denied");
  }
  if (timestampMillis(handledAt) < timestampMillis(event.escalatedAt)) {
    return throwCareOperationError("invalid_request");
  }
  assertAllowedTransition("escalated", "handled", "HandleCareEvent");
  return CareEventSchema.parse({
    ...event,
    handledAt,
    state: "handled",
    updatedAt: handledAt,
    version: event.version + 1,
  }) as HandledCareEvent;
};
