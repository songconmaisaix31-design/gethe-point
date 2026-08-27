import { z } from "zod";

export const AuthorizationActionSchema = z.enum([
  "private_message.create",
  "private_conversation.read",
  "evidence.raw.read",
  "evidence.raw.delete",
  "signal.consent.decide",
  "signal.shared.confirm",
  "signal.shared.read",
  "task.attribution.correct",
  "handover.propose",
  "handover.confirm_from",
  "handover.confirm_to",
  "handover.accept",
  "handover.decline",
  "handover.expire",
  "care_rule.confirm",
  "care_scheduler.tick",
  "care_event.acknowledge",
  "care_event.handle",
  "personal_data.export",
  "audit.read",
  "space.delete",
]);
export type AuthorizationAction = z.infer<typeof AuthorizationActionSchema>;

export const ActorRelationshipSchema = z.enum([
  "conversation_participant",
  "evidence_speaker",
  "signal_speaker",
  "visible_space_member",
  "current_domain_owner",
  "handover_source",
  "handover_recipient",
  "handover_source_or_recipient",
  "handover_service",
  "handover_expiry_service",
  "care_subject_or_primary_caregiver",
  "care_scheduler",
  "care_subject",
  "current_escalation_recipient",
  "self",
  "audit_visibility_member",
  "space_creator",
  "any_other",
]);
export type ActorRelationship = z.infer<typeof ActorRelationshipSchema>;

export interface AuthorizationRule {
  readonly action: AuthorizationAction;
  readonly relationship: ActorRelationship;
  readonly decision: "allow" | "deny";
  readonly guards: readonly string[];
  readonly denialCode: "forbidden" | "not_found";
  readonly revealsExistence: false;
}

const allow = (
  action: AuthorizationAction,
  relationship: ActorRelationship,
  guards: readonly string[],
): AuthorizationRule => ({
  action,
  relationship,
  decision: "allow",
  guards,
  denialCode: "not_found",
  revealsExistence: false,
});

const denyOther = (action: AuthorizationAction): AuthorizationRule => ({
  action,
  relationship: "any_other",
  decision: "deny",
  guards: ["deny_by_default"],
  denialCode: "not_found",
  revealsExistence: false,
});

export const AUTHORIZATION_MATRIX: readonly AuthorizationRule[] = [
  allow("private_message.create", "conversation_participant", [
    "same_space",
    "active_member",
    "actor_is_author",
  ]),
  denyOther("private_message.create"),
  allow("private_conversation.read", "conversation_participant", ["same_space"]),
  denyOther("private_conversation.read"),
  allow("evidence.raw.read", "evidence_speaker", ["same_space", "evidence_available"]),
  denyOther("evidence.raw.read"),
  allow("evidence.raw.delete", "evidence_speaker", [
    "same_space",
    "expected_version_matches",
    "idempotency_matches",
  ]),
  denyOther("evidence.raw.delete"),
  allow("signal.consent.decide", "signal_speaker", [
    "same_space",
    "decision_pending",
    "one_signal_only",
  ]),
  denyOther("signal.consent.decide"),
  allow("signal.shared.confirm", "signal_speaker", [
    "same_space",
    "active_unexpired_share_consent",
    "supported_shared_visibility",
    "expected_version_matches",
    "idempotency_matches",
  ]),
  denyOther("signal.shared.confirm"),
  allow("signal.shared.read", "visible_space_member", [
    "same_space",
    "visibility_predicate_matches",
  ]),
  denyOther("signal.shared.read"),
  allow("task.attribution.correct", "visible_space_member", [
    "same_space",
    "task_visible",
    "evidence_current",
    "expected_version_matches",
  ]),
  denyOther("task.attribution.correct"),
  allow("handover.propose", "current_domain_owner", [
    "same_space",
    "recipient_is_distinct_active_member",
    "domain_current",
  ]),
  denyOther("handover.propose"),
  allow("handover.confirm_from", "handover_source", [
    "same_space",
    "information_complete",
    "handover_non_terminal",
  ]),
  denyOther("handover.confirm_from"),
  allow("handover.confirm_to", "handover_recipient", [
    "same_space",
    "information_complete",
    "handover_non_terminal",
  ]),
  denyOther("handover.confirm_to"),
  allow("handover.accept", "handover_service", [
    "information_complete",
    "both_confirmations_present",
    "versions_match",
    "atomic_migration_succeeds",
  ]),
  denyOther("handover.accept"),
  allow("handover.decline", "handover_source_or_recipient", [
    "same_space",
    "state_blocked_or_awaiting_confirmations",
  ]),
  denyOther("handover.decline"),
  allow("handover.expire", "handover_expiry_service", [
    "clock_at_or_after_expiry",
    "handover_non_terminal",
  ]),
  denyOther("handover.expire"),
  allow("care_rule.confirm", "care_subject_or_primary_caregiver", [
    "same_space",
    "exact_rule_facts_reviewed",
    "evidence_current",
  ]),
  denyOther("care_rule.confirm"),
  allow("care_scheduler.tick", "care_scheduler", [
    "rule_active",
    "deterministic_due_time",
  ]),
  denyOther("care_scheduler.tick"),
  allow("care_event.acknowledge", "care_subject", [
    "same_space",
    "transition_allowed",
  ]),
  denyOther("care_event.acknowledge"),
  allow("care_event.handle", "current_escalation_recipient", [
    "same_space",
    "event_escalated",
  ]),
  denyOther("care_event.handle"),
  allow("personal_data.export", "self", [
    "same_space",
    "include_only_currently_authorized_records",
  ]),
  denyOther("personal_data.export"),
  allow("audit.read", "audit_visibility_member", [
    "same_space",
    "entry_visibility_matches",
  ]),
  denyOther("audit.read"),
  allow("space.delete", "space_creator", [
    "same_space",
    "exact_name_confirmation",
    "expected_version_matches",
    "idempotency_matches",
  ]),
  denyOther("space.delete"),
];

export const DEFAULT_AUTHORIZATION_DECISION = Object.freeze({
  decision: "deny",
  denialCode: "not_found",
  revealsExistence: false,
} as const);

export const DeletionOperationSchema = z.enum([
  "delete_evidence",
  "revoke_analysis_consent",
  "export_personal_data",
  "delete_space",
]);
export type DeletionOperation = z.infer<typeof DeletionOperationSchema>;

export interface DeletionPolicyRule {
  readonly operation: DeletionOperation;
  readonly authorizedRelationship: ActorRelationship;
  readonly removes: readonly string[];
  readonly invalidates: readonly string[];
  readonly preserves: readonly string[];
  readonly audit: "append_until_space_deleted" | "deleted_with_space";
  readonly receipt: string;
}

export const DELETION_MATRIX: readonly DeletionPolicyRule[] = [
  {
    operation: "delete_evidence",
    authorizedRelationship: "evidence_speaker",
    removes: ["raw_evidence"],
    invalidates: [
      "dependent_signals_to_evidence_missing",
      "dependent_tasks_to_needs_review",
      "dependent_domains_to_needs_review",
      "future_report_inclusion",
    ],
    preserves: ["accepted_handover_history", "current_domain_owner"],
    audit: "append_until_space_deleted",
    receipt: "affected_ids_and_audit_entry_id",
  },
  {
    operation: "revoke_analysis_consent",
    authorizedRelationship: "self",
    removes: [],
    invalidates: ["future_ai_analysis_authority"],
    preserves: ["prior_authorized_events", "existing_shared_records"],
    audit: "append_until_space_deleted",
    receipt: "analysis_consent_state",
  },
  {
    operation: "export_personal_data",
    authorizedRelationship: "self",
    removes: [],
    invalidates: [],
    preserves: ["all_product_state"],
    audit: "append_until_space_deleted",
    receipt: "actor_authorized_json_bundle",
  },
  {
    operation: "delete_space",
    authorizedRelationship: "space_creator",
    removes: [
      "space",
      "members",
      "conversations",
      "messages",
      "evidence",
      "signals",
      "consent_decisions",
      "domains",
      "tasks",
      "handovers",
      "reminders",
      "care_rules",
      "care_events",
      "exports",
      "audit_entries",
    ],
    invalidates: [],
    preserves: [],
    audit: "deleted_with_space",
    receipt: "ephemeral_non_content_receipt",
  },
];

export const REPORT_ELIGIBILITY_POLICY = Object.freeze({
  includeTaskWhen: Object.freeze([
    "task_review_state_is_current",
    "all_referenced_evidence_is_available",
    "source_signal_is_not_discussion_only",
    "actor_can_read_task_visibility",
  ] as const),
  excludeTaskWhen: Object.freeze([
    "task_review_state_is_needs_review",
    "any_referenced_evidence_is_missing",
    "source_signal_is_discussion_only",
    "source_signal_is_high_risk",
  ] as const),
  generation: "deterministic_human_authored_templates",
  forbiddenOutput: Object.freeze([
    "score",
    "ranking",
    "blame",
    "diagnosis",
    "relationship_judgment",
  ] as const),
} as const);

export const HIGH_RISK_CONTENT_POLICY = Object.freeze({
  categories: Object.freeze([
    "self_harm",
    "domestic_violence",
    "acute_medical_symptom",
  ] as const),
  createOrdinaryTask: false,
  createSharedSignalAutomatically: false,
  response: "non_diagnostic_safety_guidance_and_professional_resources",
  consequentialMutationAllowed: false,
} as const);
