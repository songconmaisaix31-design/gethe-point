import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  AuditEntry,
  CareSchedule,
  EscalationStep,
  HandoverMissingInfo,
  HandoverPacket,
} from "../../contracts/src/index";

type AuditChange = AuditEntry["changes"][number];

export const spaceStatusEnum = pgEnum("space_status", ["active", "deleting"]);
export const memberRoleEnum = pgEnum("member_role", [
  "primary",
  "partner",
  "subject",
]);
export const memberStatusEnum = pgEnum("member_status", ["active", "inactive"]);
export const analysisConsentEnum = pgEnum("analysis_consent", [
  "enabled",
  "revoked",
]);
export const conversationTypeEnum = pgEnum("conversation_type", [
  "agent_dm",
  "family_group",
]);
export const evidenceSourceTypeEnum = pgEnum("evidence_source_type", [
  "agent_dm",
  "family_group",
  "screenshot",
  "voice",
  "forward",
]);
export const evidenceStateEnum = pgEnum("evidence_state", [
  "available",
  "deleted",
]);
export const signalDraftKindEnum = pgEnum("signal_draft_kind", [
  "potential_task",
  "discussion_only",
  "high_risk",
]);
export const signalSourceEnum = pgEnum("signal_source", [
  "fixture",
  "validated_ai",
  "human",
]);
export const consentRecordStateEnum = pgEnum("consent_record_state", [
  "active",
  "revoked",
  "expired",
  "discarded",
]);
export const consentOutcomeEnum = pgEnum("consent_outcome", [
  "share",
  "discard",
]);
export const visibilityKindEnum = pgEnum("visibility_kind", [
  "self",
  "space",
  "members",
  "care_related",
]);
export const signalPurposeEnum = pgEnum("signal_purpose", [
  "responsibility",
  "care_information",
  "family_information",
]);
export const domainStatusEnum = pgEnum("domain_status", [
  "active",
  "needs_review",
  "archived",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "completed",
  "cancelled",
]);
export const taskReviewStateEnum = pgEnum("task_review_state", [
  "current",
  "needs_review",
]);
export const handoverStatusEnum = pgEnum("handover_status", [
  "draft",
  "proposed",
  "blocked",
  "awaiting_confirmations",
  "accepted",
  "declined",
  "expired",
]);
export const careRuleStatusEnum = pgEnum("care_rule_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);
export const careTerminalBehaviorEnum = pgEnum("care_terminal_behavior", [
  "close_on_ack",
  "close_on_handle",
  "unresolved_after_chain",
]);
export const careEventStateEnum = pgEnum("care_event_state", [
  "scheduled",
  "notified",
  "acknowledged",
  "timed_out",
  "escalated",
  "handled",
  "closed",
  "unresolved",
]);
export const reminderStatusEnum = pgEnum("reminder_status", [
  "active",
  "sent",
  "cancelled",
]);
export const actorKindEnum = pgEnum("actor_kind", ["member", "system"]);
export const systemServiceEnum = pgEnum("system_service", [
  "handover_service",
  "handover_expiry_service",
  "care_scheduler",
  "privacy_service",
]);
export const auditActionEnum = pgEnum("audit_action", [
  "private_message_created",
  "signal_draft_created",
  "consent_decided",
  "shared_signal_confirmed",
  "task_attribution_corrected",
  "handover_transitioned",
  "handover_accepted",
  "care_rule_confirmed",
  "care_event_transitioned",
  "evidence_deleted",
  "analysis_consent_revoked",
  "personal_data_exported",
  "space_deleted",
]);
export const auditTargetTypeEnum = pgEnum("audit_target_type", [
  "message",
  "signal",
  "consent",
  "task",
  "domain",
  "handover",
  "care_rule",
  "care_event",
  "evidence",
  "member",
  "export",
  "space",
]);
export const idempotencyStateEnum = pgEnum("idempotency_state", [
  "claimed",
  "completed",
]);

const recordColumns = () => ({
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow(),
  version: integer("version").notNull().default(0),
});

const visibilityColumns = () => ({
  visibilityKind: visibilityKindEnum("visibility_kind").notNull(),
  visibilityMemberIds: uuid("visibility_member_ids")
    .array()
    .notNull()
    .default(sql`ARRAY[]::uuid[]`),
  visibilitySubjectId: uuid("visibility_subject_id"),
});

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    createdBy: uuid("created_by").notNull(),
    status: spaceStatusEnum("status").notNull().default("active"),
    ...recordColumns(),
  },
  (table) => [
    check("spaces_name_nonempty", sql`btrim(${table.name}) <> ''`),
    check("spaces_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    status: memberStatusEnum("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { mode: "string", withTimezone: true }).notNull(),
    analysisConsent: analysisConsentEnum("analysis_consent")
      .notNull()
      .default("enabled"),
    ...recordColumns(),
  },
  (table) => [
    unique("members_space_id_id_key").on(table.spaceId, table.id),
    check("members_display_name_nonempty", sql`btrim(${table.displayName}) <> ''`),
    check("members_version_nonnegative", sql`${table.version} >= 0`),
    index("members_space_status_idx").on(table.spaceId, table.status),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    type: conversationTypeEnum("type").notNull(),
    ...recordColumns(),
  },
  (table) => [
    unique("conversations_space_id_id_key").on(table.spaceId, table.id),
    check("conversations_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    spaceId: uuid("space_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    memberId: uuid("member_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.memberId] }),
    foreignKey({
      name: "conversation_members_conversation_fk",
      columns: [table.spaceId, table.conversationId],
      foreignColumns: [conversations.spaceId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "conversation_members_member_fk",
      columns: [table.spaceId, table.memberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("cascade"),
    index("conversation_members_member_idx").on(table.spaceId, table.memberId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    authorId: uuid("author_id").notNull(),
    clientMessageId: uuid("client_message_id").notNull(),
    content: varchar("content", { length: 4_000 }).notNull(),
    occurredAt: timestamp("occurred_at", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    visibleToMemberId: uuid("visible_to_member_id").notNull(),
    ...recordColumns(),
  },
  (table) => [
    unique("messages_space_id_id_key").on(table.spaceId, table.id),
    unique("messages_client_id_key").on(
      table.spaceId,
      table.conversationId,
      table.clientMessageId,
    ),
    foreignKey({
      name: "messages_conversation_fk",
      columns: [table.spaceId, table.conversationId],
      foreignColumns: [conversations.spaceId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "messages_author_fk",
      columns: [table.spaceId, table.authorId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "messages_visible_member_fk",
      columns: [table.spaceId, table.visibleToMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check("messages_self_visibility", sql`${table.visibleToMemberId} = ${table.authorId}`),
    check("messages_content_nonempty", sql`btrim(${table.content}) <> ''`),
    check("messages_version_nonnegative", sql`${table.version} >= 0`),
    index("messages_conversation_time_idx").on(
      table.spaceId,
      table.conversationId,
      table.occurredAt,
    ),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    sourceType: evidenceSourceTypeEnum("source_type").notNull(),
    speakerId: uuid("speaker_id").notNull(),
    sourceMessageId: uuid("source_message_id"),
    occurredAt: timestamp("occurred_at", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    rawRef: varchar("raw_ref", { length: 512 }).notNull(),
    visibleToMemberId: uuid("visible_to_member_id").notNull(),
    state: evidenceStateEnum("state").notNull().default("available"),
    ...recordColumns(),
  },
  (table) => [
    unique("evidence_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "evidence_speaker_fk",
      columns: [table.spaceId, table.speakerId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "evidence_message_fk",
      columns: [table.spaceId, table.sourceMessageId],
      foreignColumns: [messages.spaceId, messages.id],
    }).onDelete("set null"),
    foreignKey({
      name: "evidence_visible_member_fk",
      columns: [table.spaceId, table.visibleToMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check("evidence_self_visibility", sql`${table.visibleToMemberId} = ${table.speakerId}`),
    check("evidence_raw_ref_nonempty", sql`btrim(${table.rawRef}) <> ''`),
    check("evidence_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const domains = pgTable(
  "domains",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    ownerId: uuid("owner_id"),
    futureTaskOwnerId: uuid("future_task_owner_id"),
    status: domainStatusEnum("status").notNull().default("active"),
    nextAction: varchar("next_action", { length: 160 }),
    ...visibilityColumns(),
    ...recordColumns(),
  },
  (table) => [
    unique("domains_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "domains_owner_fk",
      columns: [table.spaceId, table.ownerId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "domains_future_task_owner_fk",
      columns: [table.spaceId, table.futureTaskOwnerId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "domains_visibility_subject_fk",
      columns: [table.spaceId, table.visibilitySubjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "domains_shared_visibility",
      sql`shared_visibility_is_valid(${table.visibilityKind}, ${table.visibilityMemberIds}, ${table.visibilitySubjectId})`,
    ),
    check("domains_name_nonempty", sql`btrim(${table.name}) <> ''`),
    check("domains_version_nonnegative", sql`${table.version} >= 0`),
    index("domains_owner_idx").on(table.spaceId, table.ownerId),
  ],
);

export const signalDrafts = pgTable(
  "signal_drafts",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    speakerId: uuid("speaker_id").notNull(),
    sourceMessageId: uuid("source_message_id").notNull(),
    kind: signalDraftKindEnum("kind").notNull(),
    redactedExcerpt: varchar("redacted_excerpt", { length: 280 }).notNull(),
    proposedConclusion: varchar("proposed_conclusion", { length: 2_000 }).notNull(),
    candidateDomainId: uuid("candidate_domain_id"),
    confidence: numeric("confidence", {
      mode: "number",
      precision: 4,
      scale: 3,
    }).notNull(),
    missingInfo: jsonb("missing_info").$type<string[]>().notNull().default([]),
    promptVersion: varchar("prompt_version", { length: 80 }).notNull(),
    source: signalSourceEnum("source").notNull(),
    ...recordColumns(),
  },
  (table) => [
    unique("signal_drafts_space_id_id_key").on(table.spaceId, table.id),
    unique("signal_drafts_space_id_id_speaker_key").on(
      table.spaceId,
      table.id,
      table.speakerId,
    ),
    foreignKey({
      name: "signal_drafts_speaker_fk",
      columns: [table.spaceId, table.speakerId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "signal_drafts_message_fk",
      columns: [table.spaceId, table.sourceMessageId],
      foreignColumns: [messages.spaceId, messages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "signal_drafts_candidate_domain_fk",
      columns: [table.spaceId, table.candidateDomainId],
      foreignColumns: [domains.spaceId, domains.id],
    }).onDelete("set null"),
    check("signal_drafts_confidence_range", sql`${table.confidence} BETWEEN 0 AND 1`),
    check(
      "signal_drafts_missing_info_array",
      sql`jsonb_typeof(${table.missingInfo}) = 'array' AND jsonb_array_length(${table.missingInfo}) <= 20`,
    ),
    check("signal_drafts_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const signalDraftEvidence = pgTable(
  "signal_draft_evidence",
  {
    spaceId: uuid("space_id").notNull(),
    signalDraftId: uuid("signal_draft_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signalDraftId, table.evidenceId] }),
    foreignKey({
      name: "signal_draft_evidence_draft_fk",
      columns: [table.spaceId, table.signalDraftId],
      foreignColumns: [signalDrafts.spaceId, signalDrafts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "signal_draft_evidence_evidence_fk",
      columns: [table.spaceId, table.evidenceId],
      foreignColumns: [evidence.spaceId, evidence.id],
    }).onDelete("restrict"),
  ],
);

export const consentDecisions = pgTable(
  "consent_decisions",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    signalDraftId: uuid("signal_draft_id").notNull(),
    speakerId: uuid("speaker_id").notNull(),
    decidedAt: timestamp("decided_at", { mode: "string", withTimezone: true }).notNull(),
    recordState: consentRecordStateEnum("record_state").notNull(),
    outcome: consentOutcomeEnum("outcome").notNull(),
    visibilityKind: visibilityKindEnum("visibility_kind"),
    visibilityMemberIds: uuid("visibility_member_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    visibilitySubjectId: uuid("visibility_subject_id"),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "string", withTimezone: true }),
    ...recordColumns(),
  },
  (table) => [
    unique("consent_decisions_space_id_id_key").on(table.spaceId, table.id),
    unique("consent_decisions_space_id_id_speaker_key").on(
      table.spaceId,
      table.id,
      table.speakerId,
    ),
    unique("consent_decisions_signal_draft_key").on(table.spaceId, table.signalDraftId),
    foreignKey({
      name: "consent_decisions_draft_speaker_fk",
      columns: [table.spaceId, table.signalDraftId, table.speakerId],
      foreignColumns: [signalDrafts.spaceId, signalDrafts.id, signalDrafts.speakerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "consent_decisions_visibility_subject_fk",
      columns: [table.spaceId, table.visibilitySubjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "consent_decisions_state_shape",
      sql`consent_decision_is_valid(${table.recordState}, ${table.outcome}, ${table.visibilityKind}, ${table.visibilityMemberIds}, ${table.visibilitySubjectId}, ${table.expiresAt}, ${table.revokedAt})`,
    ),
    check("consent_decisions_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    speakerId: uuid("speaker_id").notNull(),
    consentDecisionId: uuid("consent_decision_id").notNull(),
    redactedExcerpt: varchar("redacted_excerpt", { length: 280 }).notNull(),
    conclusion: varchar("conclusion", { length: 2_000 }).notNull(),
    purpose: signalPurposeEnum("purpose").notNull(),
    ...visibilityColumns(),
    evidenceState: evidenceStateEnum("evidence_state").notNull().default("available"),
    ...recordColumns(),
  },
  (table) => [
    unique("signals_space_id_id_key").on(table.spaceId, table.id),
    unique("signals_consent_decision_key").on(table.spaceId, table.consentDecisionId),
    foreignKey({
      name: "signals_consent_speaker_fk",
      columns: [table.spaceId, table.consentDecisionId, table.speakerId],
      foreignColumns: [
        consentDecisions.spaceId,
        consentDecisions.id,
        consentDecisions.speakerId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "signals_visibility_subject_fk",
      columns: [table.spaceId, table.visibilitySubjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "signals_shared_visibility",
      sql`shared_visibility_is_valid(${table.visibilityKind}, ${table.visibilityMemberIds}, ${table.visibilitySubjectId})`,
    ),
    check("signals_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const signalEvidence = pgTable(
  "signal_evidence",
  {
    spaceId: uuid("space_id").notNull(),
    signalId: uuid("signal_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.signalId, table.evidenceId] }),
    foreignKey({
      name: "signal_evidence_signal_fk",
      columns: [table.spaceId, table.signalId],
      foreignColumns: [signals.spaceId, signals.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "signal_evidence_evidence_fk",
      columns: [table.spaceId, table.evidenceId],
      foreignColumns: [evidence.spaceId, evidence.id],
    }).onDelete("restrict"),
  ],
);

export const domainEvidence = pgTable(
  "domain_evidence",
  {
    spaceId: uuid("space_id").notNull(),
    domainId: uuid("domain_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.domainId, table.evidenceId] }),
    foreignKey({
      name: "domain_evidence_domain_fk",
      columns: [table.spaceId, table.domainId],
      foreignColumns: [domains.spaceId, domains.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "domain_evidence_evidence_fk",
      columns: [table.spaceId, table.evidenceId],
      foreignColumns: [evidence.spaceId, evidence.id],
    }).onDelete("restrict"),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    dueAt: timestamp("due_at", { mode: "string", withTimezone: true }),
    status: taskStatusEnum("status").notNull().default("open"),
    reviewState: taskReviewStateEnum("review_state").notNull().default("current"),
    ...visibilityColumns(),
    discoveredBy: uuid("discovered_by"),
    deadlineKeptBy: uuid("deadline_kept_by"),
    scheduledBy: uuid("scheduled_by"),
    executedBy: uuid("executed_by"),
    followedUpBy: uuid("followed_up_by"),
    ...recordColumns(),
  },
  (table) => [
    unique("tasks_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "tasks_domain_fk",
      columns: [table.spaceId, table.domainId],
      foreignColumns: [domains.spaceId, domains.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "tasks_discovered_by_fk",
      columns: [table.spaceId, table.discoveredBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_deadline_kept_by_fk",
      columns: [table.spaceId, table.deadlineKeptBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_scheduled_by_fk",
      columns: [table.spaceId, table.scheduledBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_executed_by_fk",
      columns: [table.spaceId, table.executedBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_followed_up_by_fk",
      columns: [table.spaceId, table.followedUpBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "tasks_visibility_subject_fk",
      columns: [table.spaceId, table.visibilitySubjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "tasks_shared_visibility",
      sql`shared_visibility_is_valid(${table.visibilityKind}, ${table.visibilityMemberIds}, ${table.visibilitySubjectId})`,
    ),
    check("tasks_title_nonempty", sql`btrim(${table.title}) <> ''`),
    check("tasks_version_nonnegative", sql`${table.version} >= 0`),
    index("tasks_domain_status_idx").on(table.spaceId, table.domainId, table.status),
  ],
);

export const taskEvidence = pgTable(
  "task_evidence",
  {
    spaceId: uuid("space_id").notNull(),
    taskId: uuid("task_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.evidenceId] }),
    foreignKey({
      name: "task_evidence_task_fk",
      columns: [table.spaceId, table.taskId],
      foreignColumns: [tasks.spaceId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "task_evidence_evidence_fk",
      columns: [table.spaceId, table.evidenceId],
      foreignColumns: [evidence.spaceId, evidence.id],
    }).onDelete("restrict"),
  ],
);

export const handovers = pgTable(
  "handovers",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    fromMemberId: uuid("from_member_id").notNull(),
    toMemberId: uuid("to_member_id").notNull(),
    packet: jsonb("packet").$type<HandoverPacket>().notNull(),
    missingInfo: jsonb("missing_info")
      .$type<HandoverMissingInfo[]>()
      .notNull()
      .default([]),
    status: handoverStatusEnum("status").notNull().default("draft"),
    expiresAt: timestamp("expires_at", { mode: "string", withTimezone: true }).notNull(),
    fromConfirmedAt: timestamp("from_confirmed_at", {
      mode: "string",
      withTimezone: true,
    }),
    toConfirmedAt: timestamp("to_confirmed_at", {
      mode: "string",
      withTimezone: true,
    }),
    acceptedAt: timestamp("accepted_at", { mode: "string", withTimezone: true }),
    terminalAt: timestamp("terminal_at", { mode: "string", withTimezone: true }),
    declinedBy: uuid("declined_by"),
    declineReason: varchar("decline_reason", { length: 2_000 }),
    ...recordColumns(),
  },
  (table) => [
    unique("handovers_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "handovers_domain_fk",
      columns: [table.spaceId, table.domainId],
      foreignColumns: [domains.spaceId, domains.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "handovers_from_member_fk",
      columns: [table.spaceId, table.fromMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "handovers_to_member_fk",
      columns: [table.spaceId, table.toMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "handovers_declined_by_fk",
      columns: [table.spaceId, table.declinedBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check("handovers_distinct_members", sql`${table.fromMemberId} <> ${table.toMemberId}`),
    check(
      "handovers_state_shape",
      sql`handover_shape_is_valid(${table.status}, ${table.missingInfo}, ${table.fromConfirmedAt}, ${table.toConfirmedAt}, ${table.acceptedAt}, ${table.terminalAt}, ${table.declinedBy}, ${table.declineReason})`,
    ),
    check("handovers_version_nonnegative", sql`${table.version} >= 0`),
    index("handovers_domain_status_idx").on(table.spaceId, table.domainId, table.status),
  ],
);

export const careRules = pgTable(
  "care_rules",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    schedule: jsonb("schedule").$type<CareSchedule>().notNull(),
    requireAck: boolean("require_ack").notNull(),
    ackTimeoutSec: integer("ack_timeout_sec").notNull(),
    escalationChain: jsonb("escalation_chain").$type<EscalationStep[]>().notNull(),
    primaryCaregiverId: uuid("primary_caregiver_id").notNull(),
    createdFromEvidenceId: uuid("created_from_evidence_id").notNull(),
    terminalBehavior: careTerminalBehaviorEnum("terminal_behavior").notNull(),
    status: careRuleStatusEnum("status").notNull().default("draft"),
    confirmedBy: uuid("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { mode: "string", withTimezone: true }),
    ...recordColumns(),
  },
  (table) => [
    unique("care_rules_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "care_rules_subject_fk",
      columns: [table.spaceId, table.subjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "care_rules_primary_caregiver_fk",
      columns: [table.spaceId, table.primaryCaregiverId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "care_rules_confirmed_by_fk",
      columns: [table.spaceId, table.confirmedBy],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "care_rules_evidence_fk",
      columns: [table.spaceId, table.createdFromEvidenceId],
      foreignColumns: [evidence.spaceId, evidence.id],
    }).onDelete("restrict"),
    check(
      "care_rules_state_shape",
      sql`care_rule_shape_is_valid(${table.status}, ${table.schedule}, ${table.ackTimeoutSec}, ${table.escalationChain}, ${table.confirmedBy}, ${table.confirmedAt})`,
    ),
    check("care_rules_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const careEvents = pgTable(
  "care_events",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    careRuleId: uuid("care_rule_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    occurrenceKey: varchar("occurrence_key", { length: 160 }).notNull(),
    scheduledFor: timestamp("scheduled_for", {
      mode: "string",
      withTimezone: true,
    }).notNull(),
    acknowledgementDeadline: timestamp("acknowledgement_deadline", {
      mode: "string",
      withTimezone: true,
    }),
    state: careEventStateEnum("state").notNull().default("scheduled"),
    notifiedAt: timestamp("notified_at", { mode: "string", withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", {
      mode: "string",
      withTimezone: true,
    }),
    timedOutAt: timestamp("timed_out_at", { mode: "string", withTimezone: true }),
    escalationLevel: integer("escalation_level").notNull().default(0),
    escalatedAt: timestamp("escalated_at", { mode: "string", withTimezone: true }),
    handledAt: timestamp("handled_at", { mode: "string", withTimezone: true }),
    closedAt: timestamp("closed_at", { mode: "string", withTimezone: true }),
    unresolvedAt: timestamp("unresolved_at", { mode: "string", withTimezone: true }),
    ...recordColumns(),
  },
  (table) => [
    unique("care_events_space_id_id_key").on(table.spaceId, table.id),
    unique("care_events_occurrence_key").on(
      table.spaceId,
      table.careRuleId,
      table.occurrenceKey,
    ),
    foreignKey({
      name: "care_events_rule_fk",
      columns: [table.spaceId, table.careRuleId],
      foreignColumns: [careRules.spaceId, careRules.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "care_events_subject_fk",
      columns: [table.spaceId, table.subjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "care_events_state_shape",
      sql`care_event_shape_is_valid(${table.state}, ${table.notifiedAt}, ${table.acknowledgedAt}, ${table.timedOutAt}, ${table.escalationLevel}, ${table.escalatedAt}, ${table.handledAt}, ${table.closedAt}, ${table.unresolvedAt})`,
    ),
    check("care_events_version_nonnegative", sql`${table.version} >= 0`),
    index("care_events_due_state_idx").on(table.spaceId, table.state, table.scheduledFor),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    domainId: uuid("domain_id").notNull(),
    taskId: uuid("task_id"),
    ownerMemberId: uuid("owner_member_id").notNull(),
    dueAt: timestamp("due_at", { mode: "string", withTimezone: true }).notNull(),
    status: reminderStatusEnum("status").notNull().default("active"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    ...recordColumns(),
  },
  (table) => [
    unique("reminders_space_id_id_key").on(table.spaceId, table.id),
    unique("reminders_idempotency_key").on(table.spaceId, table.idempotencyKey),
    foreignKey({
      name: "reminders_domain_fk",
      columns: [table.spaceId, table.domainId],
      foreignColumns: [domains.spaceId, domains.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reminders_task_fk",
      columns: [table.spaceId, table.taskId],
      foreignColumns: [tasks.spaceId, tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reminders_owner_fk",
      columns: [table.spaceId, table.ownerMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "reminders_idempotency_key_format",
      sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128 AND ${table.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check("reminders_version_nonnegative", sql`${table.version} >= 0`),
    index("reminders_active_owner_idx").on(
      table.spaceId,
      table.domainId,
      table.status,
      table.ownerMemberId,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    actorKind: actorKindEnum("actor_kind").notNull(),
    actorMemberId: uuid("actor_member_id"),
    actorService: systemServiceEnum("actor_service"),
    action: auditActionEnum("action").notNull(),
    targetType: auditTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    beforeVersion: integer("before_version"),
    afterVersion: integer("after_version"),
    changes: jsonb("changes").$type<AuditChange[]>().notNull().default([]),
    ...visibilityColumns(),
    occurredAt: timestamp("occurred_at", { mode: "string", withTimezone: true }).notNull(),
  },
  (table) => [
    unique("audit_logs_space_id_id_key").on(table.spaceId, table.id),
    foreignKey({
      name: "audit_logs_actor_member_fk",
      columns: [table.spaceId, table.actorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_logs_visibility_subject_fk",
      columns: [table.spaceId, table.visibilitySubjectId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "audit_logs_actor_shape",
      sql`actor_is_valid(${table.actorKind}, ${table.actorMemberId}, ${table.actorService})`,
    ),
    check(
      "audit_logs_visibility_shape",
      sql`visibility_is_valid(${table.visibilityKind}, ${table.visibilityMemberIds}, ${table.visibilitySubjectId}, true)`,
    ),
    check("audit_logs_safe_changes", sql`audit_changes_are_safe(${table.changes})`),
    check(
      "audit_logs_versions_nonnegative",
      sql`(${table.beforeVersion} IS NULL OR ${table.beforeVersion} >= 0) AND (${table.afterVersion} IS NULL OR ${table.afterVersion} >= 0)`,
    ),
    index("audit_logs_target_time_idx").on(
      table.spaceId,
      table.targetType,
      table.targetId,
      table.occurredAt,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    operation: varchar("operation", { length: 80 }).notNull(),
    actorKind: actorKindEnum("actor_kind").notNull(),
    actorMemberId: uuid("actor_member_id"),
    actorService: systemServiceEnum("actor_service"),
    actorKey: varchar("actor_key", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    state: idempotencyStateEnum("state").notNull().default("claimed"),
    result: jsonb("result").$type<unknown>(),
    claimedAt: timestamp("claimed_at", { mode: "string", withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { mode: "string", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idempotency_records_scope_key").on(
      table.spaceId,
      table.operation,
      table.actorKey,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "idempotency_records_actor_member_fk",
      columns: [table.spaceId, table.actorMemberId],
      foreignColumns: [members.spaceId, members.id],
    }).onDelete("restrict"),
    check(
      "idempotency_records_actor_shape",
      sql`actor_with_key_is_valid(${table.actorKind}, ${table.actorMemberId}, ${table.actorService}, ${table.actorKey})`,
    ),
    check(
      "idempotency_records_key_format",
      sql`length(${table.idempotencyKey}) BETWEEN 16 AND 128 AND ${table.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'`,
    ),
    check("idempotency_records_hash_format", sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "idempotency_records_state_shape",
      sql`(${table.state} = 'claimed' AND ${table.result} IS NULL AND ${table.completedAt} IS NULL) OR (${table.state} = 'completed' AND ${table.result} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const databaseSchema = {
  auditLogs,
  careEvents,
  careRules,
  consentDecisions,
  conversationMembers,
  conversations,
  domainEvidence,
  domains,
  evidence,
  handovers,
  idempotencyRecords,
  members,
  messages,
  reminders,
  signalDraftEvidence,
  signalDrafts,
  signalEvidence,
  signals,
  spaces,
  taskEvidence,
  tasks,
};
