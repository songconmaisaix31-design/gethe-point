import { z } from "zod";

export const Roles = ["primary", "partner", "subject"] as const;
export const Channels = ["app", "robot_a3"] as const;
export const Priorities = ["normal", "high", "urgent"] as const;
export const SafeErrorCodes = [
  "invalid_request",
  "forbidden",
  "not_found",
  "conflict",
  "disabled",
  "timeout",
  "provider_unavailable",
  "internal_failure",
] as const;

export const RoleSchema = z.enum(Roles);
export const ChannelSchema = z.enum(Channels);
export const PrioritySchema = z.enum(Priorities);
export const SafeErrorCodeSchema = z.enum(SafeErrorCodes);

export const TimetableCategories = ["responsibility", "care", "family"] as const;
export const TimetableStatuses = ["planned", "completed"] as const;
export const TimetableVisibilities = ["household", "self"] as const;
export const AgentIntents = ["schedule", "responsibilities", "care", "help"] as const;

export const TimetableCategorySchema = z.enum(TimetableCategories);
export const TimetableStatusSchema = z.enum(TimetableStatuses);
export const TimetableVisibilitySchema = z.enum(TimetableVisibilities);
export const AgentIntentSchema = z.enum(AgentIntents);

export type Role = z.infer<typeof RoleSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type SafeErrorCode = z.infer<typeof SafeErrorCodeSchema>;
export type TimetableCategory = z.infer<typeof TimetableCategorySchema>;
export type TimetableStatus = z.infer<typeof TimetableStatusSchema>;
export type TimetableVisibility = z.infer<typeof TimetableVisibilitySchema>;
export type AgentIntent = z.infer<typeof AgentIntentSchema>;

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);

const MemberVisibilitySchema = z
  .object({
    members: z.array(EntityIdSchema).min(1).max(8).readonly(),
  })
  .strict()
  .superRefine(({ members }, context) => {
    if (new Set(members).size !== members.length) {
      context.addIssue({
        code: "custom",
        message: "Member visibility must not contain duplicate identifiers.",
        path: ["members"],
      });
    }
  });

export const VisibilitySchema = z.union([
  z.literal("self"),
  z.literal("space"),
  z.literal("care_related"),
  MemberVisibilitySchema,
]);

export type Visibility = z.infer<typeof VisibilitySchema>;

const VersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const DemoActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("share_evidence"),
      evidenceId: EntityIdSchema,
      visibility: VisibilitySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add_handover_info"),
      handoverId: EntityIdSchema,
      item: z.literal("last_report"),
    })
    .strict(),
  z
    .object({
      type: z.literal("confirm_handover"),
      handoverId: EntityIdSchema,
      actorId: EntityIdSchema,
      expectedVersion: VersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("activate_care_rule"),
      careRuleId: EntityIdSchema,
      actorId: EntityIdSchema,
      expectedVersion: VersionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("trigger_care_reminder"),
      careRuleId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("advance_demo_clock"),
      seconds: z.number().int().positive().max(86_400),
    })
    .strict(),
  z
    .object({
      type: z.literal("acknowledge_care"),
      careEventId: EntityIdSchema,
      actorId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("handle_escalation"),
      careEventId: EntityIdSchema,
      actorId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_evidence"),
      evidenceId: EntityIdSchema,
      actorId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("create_timetable_item"),
      ownerId: EntityIdSchema,
      title: z.string().trim().min(1).max(80),
      startsAt: z.iso.datetime({ offset: true }),
      durationMinutes: z.number().int().min(15).max(480),
      category: TimetableCategorySchema,
      domainId: EntityIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("complete_timetable_item"),
      itemId: EntityIdSchema,
    })
    .strict(),
]);

export type DemoAction = z.infer<typeof DemoActionSchema>;

export interface MemberProjection {
  readonly id: string;
  readonly displayName: string;
  readonly role: Role;
  readonly capacity: "available" | "limited";
}

export interface EvidenceProjection {
  readonly id: string;
  readonly speakerId: string;
  readonly occurredAt: string;
  readonly text: string;
  readonly visibility: Visibility;
  readonly deleted: boolean;
}

export interface SignalProjection {
  readonly id: string;
  readonly evidenceId: string;
  readonly summary: string;
  readonly status: "observed" | "confirmed" | "dismissed" | "needs_review";
}

export interface ResponsibilityStages {
  readonly discoveredBy: string | null;
  readonly deadlineKeptBy: string | null;
  readonly scheduledBy: string | null;
  readonly executedBy: string | null;
  readonly followedUpBy: string | null;
}

export interface ResponsibilityTaskProjection extends ResponsibilityStages {
  readonly id: string;
  readonly domainId: string;
  readonly title: string;
  readonly status: "open" | "completed" | "needs_review";
  readonly futureReminderOwnerId: string | null;
}

export interface ResponsibilityDomainProjection {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string | null;
  readonly status: "active" | "needs_review";
  readonly nextAction: string | null;
  readonly visibility: Visibility;
}

export interface ResponsibilityReportProjection {
  readonly title: string;
  readonly periodLabel: string;
  readonly tasks: readonly ResponsibilityTaskProjection[];
  readonly excludedNeedsReviewCount: number;
}

export interface HandoverProjection {
  readonly id: string;
  readonly domainId: string;
  readonly fromMemberId: string;
  readonly toMemberId: string;
  readonly state: "blocked" | "awaiting_confirmations" | "accepted";
  readonly missingItems: readonly ["last_report"] | readonly [];
  readonly confirmedBy: readonly string[];
  readonly version: number;
}

export interface CareRuleProjection {
  readonly id: string;
  readonly subjectId: string;
  readonly state: "draft" | "active";
  readonly scheduleLabel: string;
  readonly acknowledgementTimeoutSeconds: number;
  readonly escalationMemberIds: readonly string[];
  readonly version: number;
}

export interface CareEventProjection {
  readonly id: string;
  readonly careRuleId: string;
  readonly state: "reminded" | "escalated" | "acknowledged" | "closed";
  readonly remindedAt: string;
  readonly acknowledgedAt: string | null;
  readonly closedAt: string | null;
}

export const NotificationStatuses = [
  "queued",
  "deduplicated",
  "shown_in_app",
  "disabled",
  "sent_to_provider",
  "failed",
] as const;

export const NotificationStatusSchema = z.enum(NotificationStatuses);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export interface NotificationLogProjection {
  readonly id: string;
  readonly logicalEventId: string;
  readonly recipientId: string;
  readonly channel: Channel;
  readonly priority: Priority;
  readonly templateId: string;
  readonly status: NotificationStatus;
  readonly safeCode: SafeErrorCode | null;
  readonly occurredAt: string;
}

export interface TimetableItemProjection {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly category: TimetableCategory;
  readonly ownerId: string;
  readonly domainId: string | null;
  readonly status: TimetableStatus;
  readonly visibility: TimetableVisibility;
  readonly canComplete: boolean;
}

export interface RoleSafeProjection {
  readonly role: Role;
  readonly now: string;
  readonly members: readonly MemberProjection[];
  readonly evidence: readonly EvidenceProjection[];
  readonly signals: readonly SignalProjection[];
  readonly domains: readonly ResponsibilityDomainProjection[];
  readonly report: ResponsibilityReportProjection;
  readonly handovers: readonly HandoverProjection[];
  readonly careRules: readonly CareRuleProjection[];
  readonly careEvents: readonly CareEventProjection[];
  readonly notificationLogs: readonly NotificationLogProjection[];
  readonly timetableItems: readonly TimetableItemProjection[];
}

export const AgentQueryRequestSchema = z
  .object({
    targetMemberId: EntityIdSchema,
    message: z.string().trim().min(1).max(240),
    intentHint: AgentIntentSchema.optional(),
  })
  .strict();

export type AgentQueryRequest = z.infer<typeof AgentQueryRequestSchema>;

export interface AgentQueryResponse {
  readonly intent: AgentIntent;
  readonly targetMemberId: string;
  readonly text: string;
  readonly referencedItemIds: readonly string[];
  readonly suggestedActions: readonly (
    | "view_timetable"
    | "add_item"
    | "open_demo"
  )[];
  readonly engine: "stepfun" | "fixture_intent_router";
}

export const SafeErrorSchema = z
  .object({
    error: z
      .object({
        code: SafeErrorCodeSchema,
        message: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export type SafeError = z.infer<typeof SafeErrorSchema>;

export const NotificationAdapterRequestSchema = z
  .object({
    logicalEventId: EntityIdSchema,
    recipientId: EntityIdSchema,
    channel: ChannelSchema,
    priority: PrioritySchema,
    templateId: EntityIdSchema,
    text: z.string().min(1).max(500),
  })
  .strict();

export type NotificationAdapterRequest = z.infer<
  typeof NotificationAdapterRequestSchema
>;

export const NotificationAdapterResultSchema = z
  .object({
    status: z.enum([
      "shown_in_app",
      "disabled",
      "sent_to_provider",
      "failed",
    ]),
    safeCode: SafeErrorCodeSchema.nullable(),
  })
  .strict();

export type NotificationAdapterResult = z.infer<
  typeof NotificationAdapterResultSchema
>;

export interface NotificationAdapter {
  readonly channel: Channel;
  send(
    request: NotificationAdapterRequest,
  ): Promise<NotificationAdapterResult>;
}
