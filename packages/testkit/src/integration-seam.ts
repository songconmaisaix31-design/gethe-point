import { z } from "zod";

import {
  EntityIdSchema,
  MemberRoleSchema,
  ResponsibilityReportSchema,
} from "../../contracts/src/index";

import { MVP_CORE_SCENARIO_ID } from "../../../fixtures/mvp-core";

export const MVP_CORE_COMMANDS = [
  "read_private_message",
  "share_private_message",
  "record_share_consent",
  "record_no_consent",
  "publish_consented_signal",
  "generate_report",
  "supply_handover_info",
  "confirm_handover_from",
  "confirm_handover_to",
] as const;

export const MvpCoreCommandSchema = z.enum(MVP_CORE_COMMANDS);
export type MvpCoreCommand = z.infer<typeof MvpCoreCommandSchema>;

/**
 * The client selects only a server-owned scenario, a local-demo role, and a
 * named command. Actor IDs, space IDs, private content, and resolved health
 * information are intentionally absent and rejected as unknown keys.
 */
export const MvpCoreCommandRequestSchema = z.strictObject({
  scenarioId: z.string().min(1).max(64),
  role: MemberRoleSchema,
  command: MvpCoreCommandSchema,
  targetId: EntityIdSchema.optional(),
});
export type MvpCoreCommandRequest = z.infer<typeof MvpCoreCommandRequestSchema>;

export const MvpCoreSnapshotSchema = z.strictObject({
  scenarioId: z.literal(MVP_CORE_SCENARIO_ID),
  revision: z.number().int().nonnegative(),
  writeCount: z.number().int().nonnegative(),
  sharedWriteCount: z.number().int().nonnegative(),
  consent: z.enum(["pending", "shared", "discarded"]),
  sharedRows: z.number().int().nonnegative(),
  reportRows: z.number().int().nonnegative(),
  domainOwnerId: EntityIdSchema,
  reminderOwnerId: EntityIdSchema,
  handover: z.strictObject({
    status: z.enum(["blocked", "awaiting_confirmations", "accepted"]),
    fromConfirmed: z.boolean(),
    toConfirmed: z.boolean(),
  }),
});
export type MvpCoreSnapshot = z.infer<typeof MvpCoreSnapshotSchema>;

export const MvpCoreErrorCodeSchema = z.enum([
  "invalid_request",
  "unknown_scenario",
  "not_found",
  "forbidden",
  "consent_required",
  "raw_private_share_denied",
  "handover_blocked",
  "transition_denied",
]);
export type MvpCoreErrorCode = z.infer<typeof MvpCoreErrorCodeSchema>;

const SuccessResultSchema = z.strictObject({
  privateMessage: z
    .strictObject({ id: EntityIdSchema, content: z.string().min(1) })
    .optional(),
  report: ResponsibilityReportSchema.optional(),
});

export const MvpCoreCommandResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    command: MvpCoreCommandSchema,
    state: MvpCoreSnapshotSchema,
    result: SuccessResultSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    command: MvpCoreCommandSchema.nullable(),
    code: MvpCoreErrorCodeSchema,
    state: MvpCoreSnapshotSchema,
  }),
]);
export type MvpCoreCommandResponse = z.infer<typeof MvpCoreCommandResponseSchema>;

export const MVP_CORE_SEAM = Object.freeze({
  pagePath: "/fixtures/mvp-core",
  api: Object.freeze({
    commandPath: "/api/fixtures/mvp-core/commands",
    resetPath: "/api/fixtures/mvp-core/reset",
    statePath: "/api/fixtures/mvp-core/state",
  }),
  query: Object.freeze({ scenario: "scenario", role: "role" }),
  testIds: Object.freeze({
    root: "mvp-core-root",
    fictionalNotice: "mvp-core-fictional-notice",
    scenarioRail: "mvp-core-scenario-rail",
    subjectSurface: "mvp-core-role-subject",
    primarySurface: "mvp-core-role-primary",
    partnerSurface: "mvp-core-role-partner",
    privateMessage: "mvp-core-private-message",
    shareConsent: "mvp-core-consent-share",
    noConsent: "mvp-core-consent-decline",
    publishSignal: "mvp-core-publish-signal",
    sharedSignal: "mvp-core-shared-signal",
    generateReport: "mvp-core-generate-report",
    report: "mvp-core-report",
    responsibilityCard: "mvp-core-responsibility-card",
    handoverCard: "mvp-core-handover-card",
    handoverStatus: "mvp-core-handover-status",
    domainOwner: "mvp-core-domain-owner",
    reminderOwner: "mvp-core-reminder-owner",
    supplyHandoverInfo: "mvp-core-supply-handover-info",
    confirmFrom: "mvp-core-confirm-from",
    confirmTo: "mvp-core-confirm-to",
    fromConfirmation: "mvp-core-from-confirmation",
    toConfirmation: "mvp-core-to-confirmation",
    acceptHandover: "mvp-core-accept-handover",
    sharedRowCount: "mvp-core-shared-row-count",
    writeCount: "mvp-core-write-count",
  }),
} as const);
