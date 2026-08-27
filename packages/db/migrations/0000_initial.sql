CREATE TYPE "public"."actor_kind" AS ENUM('member', 'system');--> statement-breakpoint
CREATE TYPE "public"."analysis_consent" AS ENUM('enabled', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('private_message_created', 'signal_draft_created', 'consent_decided', 'shared_signal_confirmed', 'task_attribution_corrected', 'handover_transitioned', 'handover_accepted', 'care_rule_confirmed', 'care_event_transitioned', 'evidence_deleted', 'analysis_consent_revoked', 'personal_data_exported', 'space_deleted');--> statement-breakpoint
CREATE TYPE "public"."audit_target_type" AS ENUM('message', 'signal', 'consent', 'task', 'domain', 'handover', 'care_rule', 'care_event', 'evidence', 'member', 'export', 'space');--> statement-breakpoint
CREATE TYPE "public"."care_event_state" AS ENUM('scheduled', 'notified', 'acknowledged', 'timed_out', 'escalated', 'handled', 'closed', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."care_rule_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."care_terminal_behavior" AS ENUM('close_on_ack', 'close_on_handle', 'unresolved_after_chain');--> statement-breakpoint
CREATE TYPE "public"."consent_outcome" AS ENUM('share', 'discard');--> statement-breakpoint
CREATE TYPE "public"."consent_record_state" AS ENUM('active', 'revoked', 'expired', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."conversation_type" AS ENUM('agent_dm', 'family_group');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('active', 'needs_review', 'archived');--> statement-breakpoint
CREATE TYPE "public"."evidence_source_type" AS ENUM('agent_dm', 'family_group', 'screenshot', 'voice', 'forward');--> statement-breakpoint
CREATE TYPE "public"."evidence_state" AS ENUM('available', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."handover_status" AS ENUM('draft', 'proposed', 'blocked', 'awaiting_confirmations', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('claimed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('primary', 'partner', 'subject');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('active', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."signal_draft_kind" AS ENUM('potential_task', 'discussion_only', 'high_risk');--> statement-breakpoint
CREATE TYPE "public"."signal_purpose" AS ENUM('responsibility', 'care_information', 'family_information');--> statement-breakpoint
CREATE TYPE "public"."signal_source" AS ENUM('fixture', 'validated_ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."space_status" AS ENUM('active', 'deleting');--> statement-breakpoint
CREATE TYPE "public"."system_service" AS ENUM('handover_service', 'handover_expiry_service', 'care_scheduler', 'privacy_service');--> statement-breakpoint
CREATE TYPE "public"."task_review_state" AS ENUM('current', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visibility_kind" AS ENUM('self', 'space', 'members', 'care_related');--> statement-breakpoint
CREATE FUNCTION visibility_is_valid(
	p_kind visibility_kind,
	p_member_ids uuid[],
	p_subject_id uuid,
	p_allow_self boolean
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		cardinality(p_member_ids) = cardinality(
			ARRAY(SELECT DISTINCT member_id FROM unnest(p_member_ids) AS member_id)
		)
		AND CASE p_kind
			WHEN 'self' THEN p_allow_self AND cardinality(p_member_ids) = 1 AND p_subject_id IS NULL
			WHEN 'space' THEN cardinality(p_member_ids) = 0 AND p_subject_id IS NULL
			WHEN 'members' THEN cardinality(p_member_ids) BETWEEN 1 AND 3 AND p_subject_id IS NULL
			WHEN 'care_related' THEN cardinality(p_member_ids) BETWEEN 1 AND 3 AND p_subject_id IS NOT NULL
			ELSE false
		END,
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION shared_visibility_is_valid(
	p_kind visibility_kind,
	p_member_ids uuid[],
	p_subject_id uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT visibility_is_valid(p_kind, p_member_ids, p_subject_id, false);
$$;--> statement-breakpoint
CREATE FUNCTION consent_decision_is_valid(
	p_state consent_record_state,
	p_outcome consent_outcome,
	p_visibility_kind visibility_kind,
	p_member_ids uuid[],
	p_subject_id uuid,
	p_expires_at timestamptz,
	p_revoked_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(CASE p_state
		WHEN 'active' THEN
			p_outcome = 'share'
			AND shared_visibility_is_valid(p_visibility_kind, p_member_ids, p_subject_id)
			AND p_revoked_at IS NULL
		WHEN 'revoked' THEN
			p_outcome = 'share'
			AND shared_visibility_is_valid(p_visibility_kind, p_member_ids, p_subject_id)
			AND p_revoked_at IS NOT NULL
		WHEN 'expired' THEN
			p_outcome = 'share'
			AND shared_visibility_is_valid(p_visibility_kind, p_member_ids, p_subject_id)
			AND p_expires_at IS NOT NULL
			AND p_revoked_at IS NULL
		WHEN 'discarded' THEN
			p_outcome = 'discard'
			AND p_visibility_kind IS NULL
			AND cardinality(p_member_ids) = 0
			AND p_subject_id IS NULL
			AND p_expires_at IS NULL
			AND p_revoked_at IS NULL
		ELSE false
	END, false);
$$;--> statement-breakpoint
CREATE FUNCTION actor_is_valid(
	p_kind actor_kind,
	p_member_id uuid,
	p_service system_service
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		(p_kind = 'member' AND p_member_id IS NOT NULL AND p_service IS NULL)
		OR (p_kind = 'system' AND p_member_id IS NULL AND p_service IS NOT NULL),
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION actor_with_key_is_valid(
	p_kind actor_kind,
	p_member_id uuid,
	p_service system_service,
	p_actor_key text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT actor_is_valid(p_kind, p_member_id, p_service)
		AND p_actor_key = CASE p_kind
			WHEN 'member' THEN 'member:' || p_member_id::text
			WHEN 'system' THEN 'system:' || p_service::text
		END;
$$;--> statement-breakpoint
CREATE FUNCTION audit_value_is_safe(p_value jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		jsonb_typeof(p_value) = 'object'
		AND (SELECT count(*) = 2 FROM jsonb_object_keys(p_value))
		AND p_value ? 'kind'
		AND p_value ? 'value'
		AND CASE p_value->>'kind'
			WHEN 'id' THEN
				jsonb_typeof(p_value->'value') = 'null'
				OR (
					jsonb_typeof(p_value->'value') = 'string'
					AND p_value->>'value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
				)
			WHEN 'state' THEN
				jsonb_typeof(p_value->'value') = 'null'
				OR (
					jsonb_typeof(p_value->'value') = 'string'
					AND length(p_value->>'value') BETWEEN 1 AND 160
				)
			WHEN 'count' THEN
				jsonb_typeof(p_value->'value') = 'number'
				AND p_value->>'value' ~ '^[0-9]+$'
			WHEN 'boolean' THEN jsonb_typeof(p_value->'value') = 'boolean'
			ELSE false
		END,
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION audit_changes_are_safe(p_changes jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		jsonb_typeof(p_changes) = 'array'
		AND jsonb_array_length(p_changes) <= 20
		AND NOT EXISTS (
			SELECT 1
			FROM jsonb_array_elements(p_changes) AS change(value)
			WHERE jsonb_typeof(change.value) <> 'object'
				OR (SELECT count(*) FROM jsonb_object_keys(change.value)) <> 3
				OR NOT (change.value ?& ARRAY['field', 'before', 'after'])
				OR change.value->>'field' NOT IN (
					'status', 'ownerId', 'reminderOwnerId', 'discoveredBy',
					'deadlineKeptBy', 'scheduledBy', 'executedBy', 'followedUpBy',
					'visibility', 'evidenceState', 'reviewState', 'analysisConsent',
					'escalationLevel'
				)
				OR NOT audit_value_is_safe(change.value->'before')
				OR NOT audit_value_is_safe(change.value->'after')
		),
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION handover_shape_is_valid(
	p_status handover_status,
	p_missing_info jsonb,
	p_from_confirmed_at timestamptz,
	p_to_confirmed_at timestamptz,
	p_accepted_at timestamptz,
	p_terminal_at timestamptz,
	p_declined_by uuid,
	p_decline_reason text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		jsonb_typeof(p_missing_info) = 'array'
		AND jsonb_array_length(p_missing_info) <= 20
		AND CASE p_status
			WHEN 'draft' THEN
				p_from_confirmed_at IS NULL AND p_to_confirmed_at IS NULL
				AND p_accepted_at IS NULL AND p_terminal_at IS NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			WHEN 'proposed' THEN
				p_from_confirmed_at IS NULL AND p_to_confirmed_at IS NULL
				AND p_accepted_at IS NULL AND p_terminal_at IS NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			WHEN 'blocked' THEN
				jsonb_array_length(p_missing_info) BETWEEN 1 AND 20
				AND p_from_confirmed_at IS NULL AND p_to_confirmed_at IS NULL
				AND p_accepted_at IS NULL AND p_terminal_at IS NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			WHEN 'awaiting_confirmations' THEN
				jsonb_array_length(p_missing_info) = 0
				AND p_accepted_at IS NULL AND p_terminal_at IS NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			WHEN 'accepted' THEN
				jsonb_array_length(p_missing_info) = 0
				AND p_from_confirmed_at IS NOT NULL AND p_to_confirmed_at IS NOT NULL
				AND p_accepted_at IS NOT NULL AND p_terminal_at IS NOT NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			WHEN 'declined' THEN
				p_accepted_at IS NULL AND p_terminal_at IS NOT NULL
				AND p_declined_by IS NOT NULL
				AND length(btrim(p_decline_reason)) BETWEEN 1 AND 2000
			WHEN 'expired' THEN
				p_accepted_at IS NULL AND p_terminal_at IS NOT NULL
				AND p_declined_by IS NULL AND p_decline_reason IS NULL
			ELSE false
		END,
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION care_rule_shape_is_valid(
	p_status care_rule_status,
	p_schedule jsonb,
	p_ack_timeout_sec integer,
	p_escalation_chain jsonb,
	p_confirmed_by uuid,
	p_confirmed_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		jsonb_typeof(p_schedule) = 'object'
		AND jsonb_typeof(p_escalation_chain) = 'array'
		AND jsonb_array_length(p_escalation_chain) BETWEEN 1 AND 10
		AND p_ack_timeout_sec BETWEEN 1 AND 86400
		AND CASE p_status
			WHEN 'draft' THEN p_confirmed_by IS NULL AND p_confirmed_at IS NULL
			WHEN 'active' THEN p_confirmed_by IS NOT NULL AND p_confirmed_at IS NOT NULL
			WHEN 'paused' THEN p_confirmed_by IS NOT NULL AND p_confirmed_at IS NOT NULL
			WHEN 'archived' THEN p_confirmed_by IS NOT NULL AND p_confirmed_at IS NOT NULL
			ELSE false
		END,
		false
	);
$$;--> statement-breakpoint
CREATE FUNCTION care_event_shape_is_valid(
	p_state care_event_state,
	p_notified_at timestamptz,
	p_acknowledged_at timestamptz,
	p_timed_out_at timestamptz,
	p_escalation_level integer,
	p_escalated_at timestamptz,
	p_handled_at timestamptz,
	p_closed_at timestamptz,
	p_unresolved_at timestamptz
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT COALESCE(
		p_escalation_level BETWEEN 0 AND 10
		AND CASE p_state
			WHEN 'scheduled' THEN
				p_notified_at IS NULL AND p_acknowledged_at IS NULL
				AND p_timed_out_at IS NULL AND p_escalation_level = 0
				AND p_escalated_at IS NULL AND p_handled_at IS NULL
				AND p_closed_at IS NULL AND p_unresolved_at IS NULL
			WHEN 'notified' THEN
				p_notified_at IS NOT NULL AND p_acknowledged_at IS NULL
				AND p_timed_out_at IS NULL AND p_escalation_level = 0
				AND p_escalated_at IS NULL AND p_handled_at IS NULL
				AND p_closed_at IS NULL AND p_unresolved_at IS NULL
			WHEN 'acknowledged' THEN
				p_notified_at IS NOT NULL AND p_acknowledged_at IS NOT NULL
				AND p_handled_at IS NULL AND p_closed_at IS NULL AND p_unresolved_at IS NULL
				AND (
					(p_escalation_level = 0 AND p_timed_out_at IS NULL AND p_escalated_at IS NULL)
					OR (p_escalation_level > 0 AND p_timed_out_at IS NOT NULL AND p_escalated_at IS NOT NULL)
				)
			WHEN 'timed_out' THEN
				p_notified_at IS NOT NULL AND p_acknowledged_at IS NULL
				AND p_timed_out_at IS NOT NULL AND p_escalation_level = 0
				AND p_escalated_at IS NULL AND p_handled_at IS NULL
				AND p_closed_at IS NULL AND p_unresolved_at IS NULL
			WHEN 'escalated' THEN
				p_notified_at IS NOT NULL AND p_acknowledged_at IS NULL
				AND p_timed_out_at IS NOT NULL AND p_escalation_level BETWEEN 1 AND 10
				AND p_escalated_at IS NOT NULL AND p_handled_at IS NULL
				AND p_closed_at IS NULL AND p_unresolved_at IS NULL
			WHEN 'handled' THEN
				p_acknowledged_at IS NULL AND p_timed_out_at IS NOT NULL
				AND p_escalation_level BETWEEN 1 AND 10 AND p_escalated_at IS NOT NULL
				AND p_handled_at IS NOT NULL AND p_closed_at IS NULL AND p_unresolved_at IS NULL
			WHEN 'closed' THEN p_notified_at IS NOT NULL AND p_closed_at IS NOT NULL AND p_unresolved_at IS NULL
			WHEN 'unresolved' THEN
				p_acknowledged_at IS NULL AND p_handled_at IS NULL
				AND p_closed_at IS NULL AND p_unresolved_at IS NOT NULL
			ELSE false
		END,
		false
	);
$$;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_member_id" uuid,
	"actor_service" "system_service",
	"action" "audit_action" NOT NULL,
	"target_type" "audit_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"before_version" integer,
	"after_version" integer,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_kind" "visibility_kind" NOT NULL,
	"visibility_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"visibility_subject_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_logs_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "audit_logs_actor_shape" CHECK (actor_is_valid("audit_logs"."actor_kind", "audit_logs"."actor_member_id", "audit_logs"."actor_service")),
	CONSTRAINT "audit_logs_visibility_shape" CHECK (visibility_is_valid("audit_logs"."visibility_kind", "audit_logs"."visibility_member_ids", "audit_logs"."visibility_subject_id", true)),
	CONSTRAINT "audit_logs_safe_changes" CHECK (audit_changes_are_safe("audit_logs"."changes")),
	CONSTRAINT "audit_logs_versions_nonnegative" CHECK (("audit_logs"."before_version" IS NULL OR "audit_logs"."before_version" >= 0) AND ("audit_logs"."after_version" IS NULL OR "audit_logs"."after_version" >= 0))
);
--> statement-breakpoint
CREATE TABLE "care_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"care_rule_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"occurrence_key" varchar(160) NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"acknowledgement_deadline" timestamp with time zone,
	"state" "care_event_state" DEFAULT 'scheduled' NOT NULL,
	"notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"unresolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "care_events_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "care_events_occurrence_key" UNIQUE("space_id","care_rule_id","occurrence_key"),
	CONSTRAINT "care_events_state_shape" CHECK (care_event_shape_is_valid("care_events"."state", "care_events"."notified_at", "care_events"."acknowledged_at", "care_events"."timed_out_at", "care_events"."escalation_level", "care_events"."escalated_at", "care_events"."handled_at", "care_events"."closed_at", "care_events"."unresolved_at")),
	CONSTRAINT "care_events_version_nonnegative" CHECK ("care_events"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "care_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"schedule" jsonb NOT NULL,
	"require_ack" boolean NOT NULL,
	"ack_timeout_sec" integer NOT NULL,
	"escalation_chain" jsonb NOT NULL,
	"primary_caregiver_id" uuid NOT NULL,
	"created_from_evidence_id" uuid NOT NULL,
	"terminal_behavior" "care_terminal_behavior" NOT NULL,
	"status" "care_rule_status" DEFAULT 'draft' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "care_rules_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "care_rules_state_shape" CHECK (care_rule_shape_is_valid("care_rules"."status", "care_rules"."schedule", "care_rules"."ack_timeout_sec", "care_rules"."escalation_chain", "care_rules"."confirmed_by", "care_rules"."confirmed_at")),
	CONSTRAINT "care_rules_version_nonnegative" CHECK ("care_rules"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consent_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"signal_draft_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"record_state" "consent_record_state" NOT NULL,
	"outcome" "consent_outcome" NOT NULL,
	"visibility_kind" "visibility_kind",
	"visibility_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"visibility_subject_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "consent_decisions_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "consent_decisions_space_id_id_speaker_key" UNIQUE("space_id","id","speaker_id"),
	CONSTRAINT "consent_decisions_signal_draft_key" UNIQUE("space_id","signal_draft_id"),
	CONSTRAINT "consent_decisions_state_shape" CHECK (consent_decision_is_valid("consent_decisions"."record_state", "consent_decisions"."outcome", "consent_decisions"."visibility_kind", "consent_decisions"."visibility_member_ids", "consent_decisions"."visibility_subject_id", "consent_decisions"."expires_at", "consent_decisions"."revoked_at")),
	CONSTRAINT "consent_decisions_version_nonnegative" CHECK ("consent_decisions"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"space_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_member_id_pk" PRIMARY KEY("conversation_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"type" "conversation_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conversations_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "conversations_version_nonnegative" CHECK ("conversations"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "domain_evidence" (
	"space_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "domain_evidence_domain_id_evidence_id_pk" PRIMARY KEY("domain_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"owner_id" uuid,
	"future_task_owner_id" uuid,
	"status" "domain_status" DEFAULT 'active' NOT NULL,
	"next_action" varchar(160),
	"visibility_kind" "visibility_kind" NOT NULL,
	"visibility_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"visibility_subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "domains_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "domains_shared_visibility" CHECK (shared_visibility_is_valid("domains"."visibility_kind", "domains"."visibility_member_ids", "domains"."visibility_subject_id")),
	CONSTRAINT "domains_name_nonempty" CHECK (btrim("domains"."name") <> ''),
	CONSTRAINT "domains_version_nonnegative" CHECK ("domains"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"source_type" "evidence_source_type" NOT NULL,
	"speaker_id" uuid NOT NULL,
	"source_message_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_ref" varchar(512) NOT NULL,
	"visible_to_member_id" uuid NOT NULL,
	"state" "evidence_state" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "evidence_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "evidence_self_visibility" CHECK ("evidence"."visible_to_member_id" = "evidence"."speaker_id"),
	CONSTRAINT "evidence_raw_ref_nonempty" CHECK (btrim("evidence"."raw_ref") <> ''),
	CONSTRAINT "evidence_version_nonnegative" CHECK ("evidence"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"packet" jsonb NOT NULL,
	"missing_info" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "handover_status" DEFAULT 'draft' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"from_confirmed_at" timestamp with time zone,
	"to_confirmed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"declined_by" uuid,
	"decline_reason" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "handovers_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "handovers_distinct_members" CHECK ("handovers"."from_member_id" <> "handovers"."to_member_id"),
	CONSTRAINT "handovers_state_shape" CHECK (handover_shape_is_valid("handovers"."status", "handovers"."missing_info", "handovers"."from_confirmed_at", "handovers"."to_confirmed_at", "handovers"."accepted_at", "handovers"."terminal_at", "handovers"."declined_by", "handovers"."decline_reason")),
	CONSTRAINT "handovers_version_nonnegative" CHECK ("handovers"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"operation" varchar(80) NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_member_id" uuid,
	"actor_service" "system_service",
	"actor_key" varchar(160) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"state" "idempotency_state" DEFAULT 'claimed' NOT NULL,
	"result" jsonb,
	"claimed_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_actor_shape" CHECK (actor_with_key_is_valid("idempotency_records"."actor_kind", "idempotency_records"."actor_member_id", "idempotency_records"."actor_service", "idempotency_records"."actor_key")),
	CONSTRAINT "idempotency_records_key_format" CHECK (length("idempotency_records"."idempotency_key") BETWEEN 16 AND 128 AND "idempotency_records"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "idempotency_records_hash_format" CHECK ("idempotency_records"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "idempotency_records_state_shape" CHECK (("idempotency_records"."state" = 'claimed' AND "idempotency_records"."result" IS NULL AND "idempotency_records"."completed_at" IS NULL) OR ("idempotency_records"."state" = 'completed' AND "idempotency_records"."result" IS NOT NULL AND "idempotency_records"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"analysis_consent" "analysis_consent" DEFAULT 'enabled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "members_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "members_display_name_nonempty" CHECK (btrim("members"."display_name") <> ''),
	CONSTRAINT "members_version_nonnegative" CHECK ("members"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"client_message_id" uuid NOT NULL,
	"content" varchar(4000) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"visible_to_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "messages_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "messages_client_id_key" UNIQUE("space_id","conversation_id","client_message_id"),
	CONSTRAINT "messages_self_visibility" CHECK ("messages"."visible_to_member_id" = "messages"."author_id"),
	CONSTRAINT "messages_content_nonempty" CHECK (btrim("messages"."content") <> ''),
	CONSTRAINT "messages_version_nonnegative" CHECK ("messages"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"task_id" uuid,
	"owner_member_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'active' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reminders_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "reminders_idempotency_key" UNIQUE("space_id","idempotency_key"),
	CONSTRAINT "reminders_idempotency_key_format" CHECK (length("reminders"."idempotency_key") BETWEEN 16 AND 128 AND "reminders"."idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
	CONSTRAINT "reminders_version_nonnegative" CHECK ("reminders"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "signal_draft_evidence" (
	"space_id" uuid NOT NULL,
	"signal_draft_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "signal_draft_evidence_signal_draft_id_evidence_id_pk" PRIMARY KEY("signal_draft_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "signal_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"kind" "signal_draft_kind" NOT NULL,
	"redacted_excerpt" varchar(280) NOT NULL,
	"proposed_conclusion" varchar(2000) NOT NULL,
	"candidate_domain_id" uuid,
	"confidence" numeric(4, 3) NOT NULL,
	"missing_info" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" varchar(80) NOT NULL,
	"source" "signal_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "signal_drafts_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "signal_drafts_space_id_id_speaker_key" UNIQUE("space_id","id","speaker_id"),
	CONSTRAINT "signal_drafts_confidence_range" CHECK ("signal_drafts"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "signal_drafts_missing_info_array" CHECK (jsonb_typeof("signal_drafts"."missing_info") = 'array' AND jsonb_array_length("signal_drafts"."missing_info") <= 20),
	CONSTRAINT "signal_drafts_version_nonnegative" CHECK ("signal_drafts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "signal_evidence" (
	"space_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "signal_evidence_signal_id_evidence_id_pk" PRIMARY KEY("signal_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"speaker_id" uuid NOT NULL,
	"consent_decision_id" uuid NOT NULL,
	"redacted_excerpt" varchar(280) NOT NULL,
	"conclusion" varchar(2000) NOT NULL,
	"purpose" "signal_purpose" NOT NULL,
	"visibility_kind" "visibility_kind" NOT NULL,
	"visibility_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"visibility_subject_id" uuid,
	"evidence_state" "evidence_state" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "signals_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "signals_consent_decision_key" UNIQUE("space_id","consent_decision_id"),
	CONSTRAINT "signals_shared_visibility" CHECK (shared_visibility_is_valid("signals"."visibility_kind", "signals"."visibility_member_ids", "signals"."visibility_subject_id")),
	CONSTRAINT "signals_version_nonnegative" CHECK ("signals"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "space_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "spaces_name_nonempty" CHECK (btrim("spaces"."name") <> ''),
	CONSTRAINT "spaces_version_nonnegative" CHECK ("spaces"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_evidence" (
	"space_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "task_evidence_task_id_evidence_id_pk" PRIMARY KEY("task_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"due_at" timestamp with time zone,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"review_state" "task_review_state" DEFAULT 'current' NOT NULL,
	"visibility_kind" "visibility_kind" NOT NULL,
	"visibility_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"visibility_subject_id" uuid,
	"discovered_by" uuid,
	"deadline_kept_by" uuid,
	"scheduled_by" uuid,
	"executed_by" uuid,
	"followed_up_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tasks_space_id_id_key" UNIQUE("space_id","id"),
	CONSTRAINT "tasks_shared_visibility" CHECK (shared_visibility_is_valid("tasks"."visibility_kind", "tasks"."visibility_member_ids", "tasks"."visibility_subject_id")),
	CONSTRAINT "tasks_title_nonempty" CHECK (btrim("tasks"."title") <> ''),
	CONSTRAINT "tasks_version_nonnegative" CHECK ("tasks"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_member_fk" FOREIGN KEY ("space_id","actor_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_visibility_subject_fk" FOREIGN KEY ("space_id","visibility_subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_rule_fk" FOREIGN KEY ("space_id","care_rule_id") REFERENCES "public"."care_rules"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_events" ADD CONSTRAINT "care_events_subject_fk" FOREIGN KEY ("space_id","subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_rules" ADD CONSTRAINT "care_rules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_rules" ADD CONSTRAINT "care_rules_subject_fk" FOREIGN KEY ("space_id","subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_rules" ADD CONSTRAINT "care_rules_primary_caregiver_fk" FOREIGN KEY ("space_id","primary_caregiver_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_rules" ADD CONSTRAINT "care_rules_confirmed_by_fk" FOREIGN KEY ("space_id","confirmed_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_rules" ADD CONSTRAINT "care_rules_evidence_fk" FOREIGN KEY ("space_id","created_from_evidence_id") REFERENCES "public"."evidence"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_decisions" ADD CONSTRAINT "consent_decisions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_decisions" ADD CONSTRAINT "consent_decisions_draft_speaker_fk" FOREIGN KEY ("space_id","signal_draft_id","speaker_id") REFERENCES "public"."signal_drafts"("space_id","id","speaker_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_decisions" ADD CONSTRAINT "consent_decisions_visibility_subject_fk" FOREIGN KEY ("space_id","visibility_subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_fk" FOREIGN KEY ("space_id","conversation_id") REFERENCES "public"."conversations"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_member_fk" FOREIGN KEY ("space_id","member_id") REFERENCES "public"."members"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_evidence" ADD CONSTRAINT "domain_evidence_domain_fk" FOREIGN KEY ("space_id","domain_id") REFERENCES "public"."domains"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_evidence" ADD CONSTRAINT "domain_evidence_evidence_fk" FOREIGN KEY ("space_id","evidence_id") REFERENCES "public"."evidence"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_owner_fk" FOREIGN KEY ("space_id","owner_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_future_task_owner_fk" FOREIGN KEY ("space_id","future_task_owner_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_visibility_subject_fk" FOREIGN KEY ("space_id","visibility_subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_speaker_fk" FOREIGN KEY ("space_id","speaker_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_message_fk" FOREIGN KEY ("space_id","source_message_id") REFERENCES "public"."messages"("space_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_visible_member_fk" FOREIGN KEY ("space_id","visible_to_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_domain_fk" FOREIGN KEY ("space_id","domain_id") REFERENCES "public"."domains"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_from_member_fk" FOREIGN KEY ("space_id","from_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_to_member_fk" FOREIGN KEY ("space_id","to_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_declined_by_fk" FOREIGN KEY ("space_id","declined_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_member_fk" FOREIGN KEY ("space_id","actor_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("space_id","conversation_id") REFERENCES "public"."conversations"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_fk" FOREIGN KEY ("space_id","author_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_visible_member_fk" FOREIGN KEY ("space_id","visible_to_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_domain_fk" FOREIGN KEY ("space_id","domain_id") REFERENCES "public"."domains"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_fk" FOREIGN KEY ("space_id","task_id") REFERENCES "public"."tasks"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_owner_fk" FOREIGN KEY ("space_id","owner_member_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_draft_evidence" ADD CONSTRAINT "signal_draft_evidence_draft_fk" FOREIGN KEY ("space_id","signal_draft_id") REFERENCES "public"."signal_drafts"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_draft_evidence" ADD CONSTRAINT "signal_draft_evidence_evidence_fk" FOREIGN KEY ("space_id","evidence_id") REFERENCES "public"."evidence"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_drafts" ADD CONSTRAINT "signal_drafts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_drafts" ADD CONSTRAINT "signal_drafts_speaker_fk" FOREIGN KEY ("space_id","speaker_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_drafts" ADD CONSTRAINT "signal_drafts_message_fk" FOREIGN KEY ("space_id","source_message_id") REFERENCES "public"."messages"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_drafts" ADD CONSTRAINT "signal_drafts_candidate_domain_fk" FOREIGN KEY ("space_id","candidate_domain_id") REFERENCES "public"."domains"("space_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_signal_fk" FOREIGN KEY ("space_id","signal_id") REFERENCES "public"."signals"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_evidence_fk" FOREIGN KEY ("space_id","evidence_id") REFERENCES "public"."evidence"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_consent_speaker_fk" FOREIGN KEY ("space_id","consent_decision_id","speaker_id") REFERENCES "public"."consent_decisions"("space_id","id","speaker_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_visibility_subject_fk" FOREIGN KEY ("space_id","visibility_subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_fk" FOREIGN KEY ("space_id","task_id") REFERENCES "public"."tasks"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_evidence_fk" FOREIGN KEY ("space_id","evidence_id") REFERENCES "public"."evidence"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_domain_fk" FOREIGN KEY ("space_id","domain_id") REFERENCES "public"."domains"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_discovered_by_fk" FOREIGN KEY ("space_id","discovered_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deadline_kept_by_fk" FOREIGN KEY ("space_id","deadline_kept_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_scheduled_by_fk" FOREIGN KEY ("space_id","scheduled_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_executed_by_fk" FOREIGN KEY ("space_id","executed_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_followed_up_by_fk" FOREIGN KEY ("space_id","followed_up_by") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_visibility_subject_fk" FOREIGN KEY ("space_id","visibility_subject_id") REFERENCES "public"."members"("space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_time_idx" ON "audit_logs" USING btree ("space_id","target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "care_events_due_state_idx" ON "care_events" USING btree ("space_id","state","scheduled_for");--> statement-breakpoint
CREATE INDEX "conversation_members_member_idx" ON "conversation_members" USING btree ("space_id","member_id");--> statement-breakpoint
CREATE INDEX "domains_owner_idx" ON "domains" USING btree ("space_id","owner_id");--> statement-breakpoint
CREATE INDEX "handovers_domain_status_idx" ON "handovers" USING btree ("space_id","domain_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key" ON "idempotency_records" USING btree ("space_id","operation","actor_key","idempotency_key");--> statement-breakpoint
CREATE INDEX "members_space_status_idx" ON "members" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "messages_conversation_time_idx" ON "messages" USING btree ("space_id","conversation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "reminders_active_owner_idx" ON "reminders" USING btree ("space_id","domain_id","status","owner_member_id");--> statement-breakpoint
CREATE INDEX "tasks_domain_status_idx" ON "tasks" USING btree ("space_id","domain_id","status");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_fk"
	FOREIGN KEY ("id", "created_by")
	REFERENCES "members" ("space_id", "id")
	ON DELETE restrict
	DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE FUNCTION enforce_visibility_members_same_space() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM unnest(NEW.visibility_member_ids) AS visible_member_id
		LEFT JOIN members
			ON members.space_id = NEW.space_id
			AND members.id = visible_member_id
		WHERE members.id IS NULL
	) THEN
		RAISE EXCEPTION 'visibility references a member outside the record space'
			USING ERRCODE = '23503';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER domains_visibility_members_same_space
	BEFORE INSERT OR UPDATE OF space_id, visibility_member_ids ON domains
	FOR EACH ROW EXECUTE FUNCTION enforce_visibility_members_same_space();--> statement-breakpoint
CREATE TRIGGER consent_visibility_members_same_space
	BEFORE INSERT OR UPDATE OF space_id, visibility_member_ids ON consent_decisions
	FOR EACH ROW EXECUTE FUNCTION enforce_visibility_members_same_space();--> statement-breakpoint
CREATE TRIGGER signals_visibility_members_same_space
	BEFORE INSERT OR UPDATE OF space_id, visibility_member_ids ON signals
	FOR EACH ROW EXECUTE FUNCTION enforce_visibility_members_same_space();--> statement-breakpoint
CREATE TRIGGER tasks_visibility_members_same_space
	BEFORE INSERT OR UPDATE OF space_id, visibility_member_ids ON tasks
	FOR EACH ROW EXECUTE FUNCTION enforce_visibility_members_same_space();--> statement-breakpoint
CREATE TRIGGER audit_visibility_members_same_space
	BEFORE INSERT OR UPDATE OF space_id, visibility_member_ids ON audit_logs
	FOR EACH ROW EXECUTE FUNCTION enforce_visibility_members_same_space();--> statement-breakpoint
CREATE FUNCTION enforce_conversation_member_limit() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (
		SELECT count(*)
		FROM conversation_members
		WHERE conversation_id = NEW.conversation_id
	) >= 3 THEN
		RAISE EXCEPTION 'conversation participant limit exceeded'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER conversation_member_limit
	BEFORE INSERT ON conversation_members
	FOR EACH ROW EXECUTE FUNCTION enforce_conversation_member_limit();--> statement-breakpoint
CREATE FUNCTION enforce_message_participant() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM conversation_members
		WHERE space_id = NEW.space_id
			AND conversation_id = NEW.conversation_id
			AND member_id = NEW.author_id
	) THEN
		RAISE EXCEPTION 'message author is not a conversation participant'
			USING ERRCODE = '23503';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER messages_require_participant
	BEFORE INSERT OR UPDATE OF space_id, conversation_id, author_id ON messages
	FOR EACH ROW EXECUTE FUNCTION enforce_message_participant();--> statement-breakpoint
CREATE FUNCTION enforce_consent_decision_immutable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW IS DISTINCT FROM OLD THEN
		RAISE EXCEPTION 'consent decisions are immutable'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER consent_decisions_immutable
	BEFORE UPDATE ON consent_decisions
	FOR EACH ROW EXECUTE FUNCTION enforce_consent_decision_immutable();--> statement-breakpoint
CREATE FUNCTION enforce_signal_consent() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	decision consent_decisions%ROWTYPE;
BEGIN
	SELECT * INTO decision
	FROM consent_decisions
	WHERE space_id = NEW.space_id
		AND id = NEW.consent_decision_id
	FOR SHARE;

	IF NOT FOUND
		OR decision.speaker_id <> NEW.speaker_id
		OR decision.record_state <> 'active'
		OR decision.outcome <> 'share'
		OR (decision.expires_at IS NOT NULL AND decision.expires_at <= CURRENT_TIMESTAMP)
		OR decision.visibility_kind IS DISTINCT FROM NEW.visibility_kind
		OR decision.visibility_member_ids IS DISTINCT FROM NEW.visibility_member_ids
		OR decision.visibility_subject_id IS DISTINCT FROM NEW.visibility_subject_id
	THEN
		RAISE EXCEPTION 'active matching consent is required'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER signals_require_active_matching_consent
	BEFORE INSERT OR UPDATE OF space_id, speaker_id, consent_decision_id,
		visibility_kind, visibility_member_ids, visibility_subject_id ON signals
	FOR EACH ROW EXECUTE FUNCTION enforce_signal_consent();--> statement-breakpoint
CREATE FUNCTION enforce_handover_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.status IN ('accepted', 'declined', 'expired') THEN
		IF NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'terminal handover is immutable'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW.status IS DISTINCT FROM OLD.status
		AND NOT (
			(OLD.status = 'draft' AND NEW.status = 'proposed')
			OR (OLD.status = 'proposed' AND NEW.status IN ('blocked', 'awaiting_confirmations'))
			OR (OLD.status = 'blocked' AND NEW.status IN ('awaiting_confirmations', 'declined', 'expired'))
			OR (OLD.status = 'awaiting_confirmations' AND NEW.status IN ('accepted', 'declined', 'expired'))
		)
	THEN
		RAISE EXCEPTION 'handover transition is not allowed'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER handovers_enforce_transition
	BEFORE UPDATE ON handovers
	FOR EACH ROW EXECUTE FUNCTION enforce_handover_transition();--> statement-breakpoint
CREATE FUNCTION enforce_care_event_transition() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.state IN ('closed', 'unresolved') THEN
		IF NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'terminal care event is immutable'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW.state = OLD.state AND OLD.state = 'escalated' THEN
		IF NEW.escalation_level <= OLD.escalation_level THEN
			RAISE EXCEPTION 'escalation level must strictly increase'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW.state IS DISTINCT FROM OLD.state
		AND NOT (
			(OLD.state = 'scheduled' AND NEW.state IN ('notified', 'unresolved'))
			OR (OLD.state = 'notified' AND NEW.state IN ('acknowledged', 'timed_out', 'closed', 'unresolved'))
			OR (OLD.state = 'timed_out' AND NEW.state IN ('escalated', 'unresolved'))
			OR (OLD.state = 'escalated' AND NEW.state IN ('acknowledged', 'handled', 'unresolved'))
			OR (OLD.state = 'acknowledged' AND NEW.state = 'closed')
			OR (OLD.state = 'handled' AND NEW.state = 'closed')
		)
	THEN
		RAISE EXCEPTION 'care event transition is not allowed'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER care_events_enforce_transition
	BEFORE UPDATE ON care_events
	FOR EACH ROW EXECUTE FUNCTION enforce_care_event_transition();
