import { z } from "zod";

const EntityIdSchema = z.uuid();

export const VISIBLE_MVP_CORE_COMMANDS = Object.freeze([
  "record_share_consent",
  "record_no_consent",
  "publish_consented_signal",
  "generate_report",
  "supply_handover_info",
  "confirm_handover_from",
  "confirm_handover_to",
] as const);

export const VisibleMvpCoreCommandSchema = z.enum(VISIBLE_MVP_CORE_COMMANDS);
export type VisibleMvpCoreCommand = z.infer<typeof VisibleMvpCoreCommandSchema>;

const ResponsibilityOwnersSchema = z.strictObject({
  discoveredBy: EntityIdSchema,
  deadlineKeptBy: EntityIdSchema,
  scheduledBy: EntityIdSchema,
  executedBy: EntityIdSchema,
  followedUpBy: EntityIdSchema,
});

export const MvpCoreSnapshotSchema = z.strictObject({
  scenarioId: z.literal("mvp-core"),
  revision: z.number().int().nonnegative(),
  writeCount: z.number().int().nonnegative(),
  sharedWriteCount: z.number().int().nonnegative(),
  consent: z.enum(["pending", "shared", "discarded"]),
  sharedRows: z.number().int().nonnegative(),
  reportRows: z.number().int().nonnegative(),
  responsibilityOwners: ResponsibilityOwnersSchema,
  domainOwnerId: EntityIdSchema,
  futureReminderCount: z.literal(1),
  reminderOwnerId: EntityIdSchema,
  handover: z.strictObject({
    status: z.enum(["blocked", "awaiting_confirmations", "accepted"]),
    fromConfirmed: z.boolean(),
    toConfirmed: z.boolean(),
  }),
});
export type MvpCoreSnapshot = z.infer<typeof MvpCoreSnapshotSchema>;

const ReportStageSchema = z.enum([
  "discoveredBy",
  "deadlineKeptBy",
  "scheduledBy",
  "executedBy",
  "followedUpBy",
]);

export const MvpCoreReportSchema = z.strictObject({
  spaceId: EntityIdSchema,
  period: z.strictObject({
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
  }).refine(({ endAt, startAt }) => Date.parse(endAt) > Date.parse(startAt), {
    message: "endAt must be later than startAt",
    path: ["endAt"],
  }),
  generatedAt: z.iso.datetime({ offset: true }),
  rows: z.array(
    z.strictObject({
      stage: ReportStageSchema,
      counts: z.array(
        z.strictObject({
          memberId: EntityIdSchema,
          count: z.number().int().nonnegative(),
        }),
      ).min(1).max(3),
    }),
  ).length(5),
  unownedDomainCount: z.number().int().nonnegative(),
  excludedNeedsReviewCount: z.number().int().nonnegative(),
  narrative: z.string().trim().min(1).max(2_000),
  source: z.literal("deterministic_template"),
});
export type MvpCoreReport = z.infer<typeof MvpCoreReportSchema>;

const SuccessResultSchema = z.strictObject({
  report: MvpCoreReportSchema.optional(),
});

const MvpCoreErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_session",
  "not_found",
  "forbidden",
  "consent_required",
  "raw_private_share_denied",
  "handover_blocked",
  "transition_denied",
]);

export const MvpCoreCommandResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    command: VisibleMvpCoreCommandSchema,
    state: MvpCoreSnapshotSchema,
    result: SuccessResultSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    command: VisibleMvpCoreCommandSchema.nullable(),
    code: MvpCoreErrorCodeSchema,
    state: MvpCoreSnapshotSchema,
  }),
]);
export type MvpCoreCommandResponse = z.infer<typeof MvpCoreCommandResponseSchema>;

const snapshotIsCoherent = (snapshot: MvpCoreSnapshot): boolean => {
  if (snapshot.consent !== "shared" && snapshot.sharedRows > 0) {
    return false;
  }
  if (snapshot.reportRows > 0 && snapshot.sharedRows === 0) {
    return false;
  }
  if (
    snapshot.handover.status === "accepted" &&
    (!snapshot.handover.fromConfirmed || !snapshot.handover.toConfirmed)
  ) {
    return false;
  }
  // Both confirmations are persisted before the separate atomic acceptance operation.
  if (
    snapshot.handover.status === "blocked" &&
    snapshot.handover.fromConfirmed &&
    snapshot.handover.toConfirmed
  ) {
    return false;
  }
  return true;
};

export const decodeMvpCoreSnapshot = (input: unknown): MvpCoreSnapshot | undefined => {
  const parsed = MvpCoreSnapshotSchema.safeParse(input);
  return parsed.success && snapshotIsCoherent(parsed.data) ? parsed.data : undefined;
};
