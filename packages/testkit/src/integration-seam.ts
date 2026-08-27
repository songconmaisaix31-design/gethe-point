import {
  EntityIdSchema,
  MemberRoleSchema,
  ResponsibilityReportSchema,
  type MemberRole,
} from "../../contracts/src/index";
import { z } from "zod";

import {
  MVP_CORE_FIXTURE,
  MVP_CORE_SCENARIO_ID,
} from "../../../fixtures/mvp-core";

export const MVP_CORE_COMMANDS = Object.freeze([
  "read_private_message",
  "share_private_message",
  "record_share_consent",
  "record_no_consent",
  "publish_consented_signal",
  "generate_report",
  "supply_handover_info",
  "confirm_handover_from",
  "confirm_handover_to",
] as const);

export const MvpCoreCommandSchema = z.enum(MVP_CORE_COMMANDS);
export type MvpCoreCommand = z.infer<typeof MvpCoreCommandSchema>;

export const ReadPrivateMessageCommandRequestSchema = z.strictObject({
  command: z.literal("read_private_message"),
  targetId: EntityIdSchema,
});

export const SharePrivateMessageCommandRequestSchema = z.strictObject({
  command: z.literal("share_private_message"),
  targetId: EntityIdSchema,
});

export const RecordShareConsentCommandRequestSchema = z.strictObject({
  command: z.literal("record_share_consent"),
});

export const RecordNoConsentCommandRequestSchema = z.strictObject({
  command: z.literal("record_no_consent"),
});

export const PublishConsentedSignalCommandRequestSchema = z.strictObject({
  command: z.literal("publish_consented_signal"),
});

export const GenerateReportCommandRequestSchema = z.strictObject({
  command: z.literal("generate_report"),
});

export const SupplyHandoverInfoCommandRequestSchema = z.strictObject({
  command: z.literal("supply_handover_info"),
});

export const ConfirmHandoverFromCommandRequestSchema = z.strictObject({
  command: z.literal("confirm_handover_from"),
});

export const ConfirmHandoverToCommandRequestSchema = z.strictObject({
  command: z.literal("confirm_handover_to"),
});

/**
 * Every union branch is strict. Only explicit private-message probes carry a
 * target ID; authority and content never cross this request boundary.
 */
export const MvpCoreCommandRequestSchema = z.discriminatedUnion("command", [
  ReadPrivateMessageCommandRequestSchema,
  SharePrivateMessageCommandRequestSchema,
  RecordShareConsentCommandRequestSchema,
  RecordNoConsentCommandRequestSchema,
  PublishConsentedSignalCommandRequestSchema,
  GenerateReportCommandRequestSchema,
  SupplyHandoverInfoCommandRequestSchema,
  ConfirmHandoverFromCommandRequestSchema,
  ConfirmHandoverToCommandRequestSchema,
]);
export type MvpCoreCommandRequest = z.infer<typeof MvpCoreCommandRequestSchema>;

export const MvpCoreResetRequestSchema = z.strictObject({});

const FixtureSessionSelectionSchema = z.strictObject({
  scenarioId: z.literal(MVP_CORE_SCENARIO_ID),
  role: MemberRoleSchema,
});

const fixtureSessionBrand: unique symbol = Symbol("mvp-core-fixture-session");

export interface MvpCoreFixtureSession {
  readonly scenarioId: typeof MVP_CORE_SCENARIO_ID;
  readonly role: MemberRole;
  readonly actorId: string;
  readonly spaceId: string;
  readonly [fixtureSessionBrand]: true;
}

const issuedFixtureSessions = new WeakSet<object>();

/**
 * Called only after a server adapter resolves its isolated Fixture session.
 * Runtime issuance prevents a body-shaped object from being treated as
 * authority even when its fields happen to match canonical identifiers.
 */
export const issueMvpCoreFixtureSession = (
  serverSelection: unknown,
): MvpCoreFixtureSession | undefined => {
  const parsed = FixtureSessionSelectionSchema.safeParse(serverSelection);
  if (!parsed.success) {
    return undefined;
  }

  const actor = MVP_CORE_FIXTURE.actors[parsed.data.role];
  const session = Object.freeze({
    scenarioId: MVP_CORE_SCENARIO_ID,
    role: parsed.data.role,
    actorId: actor.memberId,
    spaceId: actor.spaceId,
    [fixtureSessionBrand]: true as const,
  });
  issuedFixtureSessions.add(session);
  return session;
};

export const isMvpCoreFixtureSession = (
  value: unknown,
): value is MvpCoreFixtureSession =>
  typeof value === "object" && value !== null && issuedFixtureSessions.has(value);

const ResponsibilityOwnersSchema = z.strictObject({
  discoveredBy: EntityIdSchema,
  deadlineKeptBy: EntityIdSchema,
  scheduledBy: EntityIdSchema,
  executedBy: EntityIdSchema,
  followedUpBy: EntityIdSchema,
});

export const MvpCoreSnapshotSchema = z.strictObject({
  scenarioId: z.literal(MVP_CORE_SCENARIO_ID),
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

export const MvpCoreErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_session",
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

const cardZoneIds = (card: string) =>
  Object.freeze({
    root: `mvp-core-${card}-card`,
    title: `mvp-core-${card}-title`,
    content: `mvp-core-${card}-content`,
    state: `mvp-core-${card}-state`,
    actions: `mvp-core-${card}-actions`,
  });

export const MVP_CORE_SEAM = Object.freeze({
  pagePath: "/fixtures/mvp-core",
  api: Object.freeze({
    commandPath: "/api/fixtures/mvp-core/commands",
    resetPath: "/api/fixtures/mvp-core/reset",
    statePath: "/api/fixtures/mvp-core/state",
  }),
  sessionSelection: Object.freeze({
    roleQuery: "role",
    serverScenarioId: MVP_CORE_SCENARIO_ID,
  }),
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
    cards: Object.freeze({
      consent: cardZoneIds("consent"),
      report: cardZoneIds("report"),
      responsibility: cardZoneIds("responsibility"),
      handover: cardZoneIds("handover"),
    }),
  }),
} as const);
