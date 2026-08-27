import { z } from "zod";

import { CareEventStateSchema } from "./entities";

export const HANDOVER_STATES = [
  "draft",
  "proposed",
  "blocked",
  "awaiting_confirmations",
  "accepted",
  "declined",
  "expired",
] as const;

export const HandoverStateSchema = z.enum(HANDOVER_STATES);
export type HandoverState = z.infer<typeof HandoverStateSchema>;

export const HANDOVER_TERMINAL_STATES = [
  "accepted",
  "declined",
  "expired",
] as const satisfies readonly HandoverState[];

export const HandoverTransitionTriggerSchema = z.enum([
  "ProposeHandover",
  "EvaluateHandoverCompleteness",
  "SupplyHandoverInfo",
  "AcceptHandover",
  "DeclineHandover",
  "ExpireHandover",
]);
export type HandoverTransitionTrigger = z.infer<
  typeof HandoverTransitionTriggerSchema
>;

export interface AllowedHandoverTransition {
  readonly from: HandoverState;
  readonly to: HandoverState;
  readonly decision: "allowed";
  readonly trigger: HandoverTransitionTrigger;
  readonly guard: string;
}

export interface DeniedHandoverTransition {
  readonly from: HandoverState;
  readonly to: HandoverState;
  readonly decision: "denied";
  readonly reason:
    | "same_state_requires_idempotent_replay"
    | "terminal_state"
    | "transition_not_allowed";
}

export type HandoverTransitionRule =
  | AllowedHandoverTransition
  | DeniedHandoverTransition;

const allowedHandoverTransitions: Readonly<
  Partial<
    Record<
      HandoverState,
      Partial<
        Record<
          HandoverState,
          Readonly<{
            trigger: HandoverTransitionTrigger;
            guard: string;
          }>
        >
      >
    >
  >
> = {
  draft: {
    proposed: {
      trigger: "ProposeHandover",
      guard: "actor_is_current_owner_and_recipient_is_distinct_active_member",
    },
  },
  proposed: {
    blocked: {
      trigger: "EvaluateHandoverCompleteness",
      guard: "missing_information_is_non_empty",
    },
    awaiting_confirmations: {
      trigger: "EvaluateHandoverCompleteness",
      guard: "missing_information_is_empty",
    },
  },
  blocked: {
    awaiting_confirmations: {
      trigger: "SupplyHandoverInfo",
      guard: "all_required_information_is_resolved",
    },
    declined: {
      trigger: "DeclineHandover",
      guard: "actor_is_source_or_recipient",
    },
    expired: {
      trigger: "ExpireHandover",
      guard: "clock_is_at_or_after_expiry",
    },
  },
  awaiting_confirmations: {
    accepted: {
      trigger: "AcceptHandover",
      guard:
        "information_complete_both_confirmed_versions_current_and_atomic_migration_succeeds",
    },
    declined: {
      trigger: "DeclineHandover",
      guard: "actor_is_source_or_recipient",
    },
    expired: {
      trigger: "ExpireHandover",
      guard: "clock_is_at_or_after_expiry",
    },
  },
};

const handoverDeniedReason = (
  from: HandoverState,
  to: HandoverState,
): DeniedHandoverTransition["reason"] => {
  if (from === to) {
    return "same_state_requires_idempotent_replay";
  }
  if (HANDOVER_TERMINAL_STATES.some((state) => state === from)) {
    return "terminal_state";
  }
  return "transition_not_allowed";
};

export const HANDOVER_TRANSITION_TABLE: readonly HandoverTransitionRule[] =
  HANDOVER_STATES.flatMap((from) =>
    HANDOVER_STATES.map((to): HandoverTransitionRule => {
      const allowed = allowedHandoverTransitions[from]?.[to];
      if (allowed !== undefined) {
        return { from, to, decision: "allowed", ...allowed };
      }
      return { from, to, decision: "denied", reason: handoverDeniedReason(from, to) };
    }),
  );

export const getHandoverTransitionRule = (
  from: HandoverState,
  to: HandoverState,
): HandoverTransitionRule => {
  const rule = HANDOVER_TRANSITION_TABLE.find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  if (rule === undefined) {
    throw new Error("Handover transition table is incomplete");
  }
  return rule;
};

export const CARE_STATES = CareEventStateSchema.options;

export const CARE_TERMINAL_STATES = [
  "closed",
  "unresolved",
] as const satisfies readonly z.infer<typeof CareEventStateSchema>[];

export const CareTransitionTriggerSchema = z.enum([
  "TickCareScheduler",
  "AcknowledgeCareEvent",
  "HandleCareEvent",
  "CloseCareEvent",
]);
export type CareTransitionTrigger = z.infer<typeof CareTransitionTriggerSchema>;
export type CareState = z.infer<typeof CareEventStateSchema>;

export interface AllowedCareTransition {
  readonly from: CareState;
  readonly to: CareState;
  readonly decision: "allowed";
  readonly trigger: CareTransitionTrigger;
  readonly guard: string;
}

export interface DeniedCareTransition {
  readonly from: CareState;
  readonly to: CareState;
  readonly decision: "denied";
  readonly reason:
    | "same_state_requires_idempotent_replay"
    | "terminal_state"
    | "transition_not_allowed";
}

export type CareTransitionRule = AllowedCareTransition | DeniedCareTransition;

const allowedCareTransitions: Readonly<
  Partial<
    Record<
      CareState,
      Partial<
        Record<
          CareState,
          Readonly<{ trigger: CareTransitionTrigger; guard: string }>
        >
      >
    >
  >
> = {
  scheduled: {
    notified: {
      trigger: "TickCareScheduler",
      guard: "active_confirmed_rule_due_and_subject_notification_persisted",
    },
    unresolved: {
      trigger: "TickCareScheduler",
      guard: "bounded_delivery_or_recipient_failure_is_exhausted",
    },
  },
  notified: {
    acknowledged: {
      trigger: "AcknowledgeCareEvent",
      guard: "actor_is_subject_and_acknowledgement_is_allowed",
    },
    timed_out: {
      trigger: "TickCareScheduler",
      guard: "ack_required_and_clock_is_at_or_after_deadline",
    },
    closed: {
      trigger: "CloseCareEvent",
      guard: "ack_not_required_and_notification_audit_is_persisted",
    },
    unresolved: {
      trigger: "TickCareScheduler",
      guard: "bounded_delivery_retry_is_exhausted",
    },
  },
  timed_out: {
    escalated: {
      trigger: "TickCareScheduler",
      guard: "next_confirmed_escalation_level_has_valid_target",
    },
    unresolved: {
      trigger: "TickCareScheduler",
      guard: "no_valid_escalation_target_remains",
    },
  },
  escalated: {
    escalated: {
      trigger: "TickCareScheduler",
      guard: "next_level_exists_level_increases_and_level_key_is_new",
    },
    acknowledged: {
      trigger: "AcknowledgeCareEvent",
      guard: "subject_acknowledges_before_terminal_handling",
    },
    handled: {
      trigger: "HandleCareEvent",
      guard: "actor_is_current_escalation_recipient",
    },
    unresolved: {
      trigger: "TickCareScheduler",
      guard: "final_escalation_and_retry_policy_are_exhausted",
    },
  },
  acknowledged: {
    closed: {
      trigger: "CloseCareEvent",
      guard: "acknowledgement_audit_is_persisted",
    },
  },
  handled: {
    closed: {
      trigger: "CloseCareEvent",
      guard: "handling_audit_is_persisted",
    },
  },
};

const careDeniedReason = (
  from: CareState,
  to: CareState,
): DeniedCareTransition["reason"] => {
  if (from === to) {
    return "same_state_requires_idempotent_replay";
  }
  if (CARE_TERMINAL_STATES.some((state) => state === from)) {
    return "terminal_state";
  }
  return "transition_not_allowed";
};

export const CARE_TRANSITION_TABLE: readonly CareTransitionRule[] =
  CARE_STATES.flatMap((from) =>
    CARE_STATES.map((to): CareTransitionRule => {
      const allowed = allowedCareTransitions[from]?.[to];
      if (allowed !== undefined) {
        return { from, to, decision: "allowed", ...allowed };
      }
      return { from, to, decision: "denied", reason: careDeniedReason(from, to) };
    }),
  );

export const getCareTransitionRule = (
  from: CareState,
  to: CareState,
): CareTransitionRule => {
  const rule = CARE_TRANSITION_TABLE.find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  if (rule === undefined) {
    throw new Error("Care transition table is incomplete");
  }
  return rule;
};
