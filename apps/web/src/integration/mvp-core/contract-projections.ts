import { z } from "zod";

import type { PrivateSharingStatePort } from "../../../../../modules/boundary/src/index";
import type { ConversationStatePort } from "../../../../../modules/conversation/src/index";
import type { HandoverStatePort } from "../../../../../modules/handover/src/index";
import type {
  ResponsibilityDraftResult,
  ResponsibilitySourceContext,
} from "../../../../../modules/responsibility/src/index";
import type {
  MvpCoreCommandResponse,
  MvpCoreFixtureSession,
} from "../../../../../packages/testkit/src/integration-seam";

export type MvpCoreMemberRole = MvpCoreFixtureSession["role"];

export interface MvpCoreMemberActor {
  readonly authentication: "fixture_demo" | "verified_session";
  readonly kind: "member";
  readonly memberId: string;
  readonly role: MvpCoreMemberRole;
  readonly spaceId: string;
}

export type MvpCoreConversation = NonNullable<
  Awaited<ReturnType<ConversationStatePort["getConversation"]>>
>;
export type MvpCoreMember = NonNullable<
  Awaited<ReturnType<ConversationStatePort["getMember"]>>
>;
export type MvpCorePrivateMessageContext = NonNullable<
  Awaited<ReturnType<ConversationStatePort["getPrivateMessage"]>>
>;

export type MvpCoreConfirmSignalRequest = Parameters<
  PrivateSharingStatePort["confirmSignal"]
>[1];
export type MvpCoreDecideConsentRequest = Parameters<
  PrivateSharingStatePort["decideConsent"]
>[1];
export type MvpCoreConsentDecision = Awaited<
  ReturnType<PrivateSharingStatePort["decideConsent"]>
>;
export type MvpCoreSharedSignal = Awaited<
  ReturnType<PrivateSharingStatePort["confirmSignal"]>
>;
export type MvpCoreSharedVisibility = Extract<
  MvpCoreDecideConsentRequest,
  { readonly decision: "share" }
>["visibility"];

export type MvpCoreSpace = ResponsibilitySourceContext["space"];
export type MvpCoreResponsibilityMember = ResponsibilitySourceContext["actorMember"];
export type MvpCoreEvidence = ResponsibilitySourceContext["evidence"][number];
export type MvpCoreSignalDraft = ResponsibilitySourceContext["draft"];
type ReadyResponsibilityDraft = Extract<
  ResponsibilityDraftResult,
  { readonly status: "ready" }
>;
export type MvpCoreDomain = ReadyResponsibilityDraft["domain"];
export type MvpCoreTask = ReadyResponsibilityDraft["task"];

export type MvpCoreHandover = NonNullable<
  Awaited<ReturnType<HandoverStatePort["getById"]>>
>;
export type MvpCoreHandoverMutationResult = Awaited<
  ReturnType<HandoverStatePort["transition"]>
>;

type SuccessfulCommandResponse = Extract<
  MvpCoreCommandResponse,
  { readonly ok: true }
>;
export type MvpCoreResponsibilityReport = NonNullable<
  SuccessfulCommandResponse["result"]["report"]
>;

const EntityIdSchema = z.uuid();
const TimestampSchema = z.iso.datetime({ offset: true });
const ShortTextSchema = z.string().trim().min(1).max(160);
const DetailTextSchema = z.string().trim().min(1).max(2_000);

const SharedVisibilitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("space") }),
  z.strictObject({
    kind: z.literal("members"),
    memberIds: z.array(EntityIdSchema).min(1).max(3),
  }),
  z.strictObject({
    kind: z.literal("care_related"),
    memberIds: z.array(EntityIdSchema).min(1).max(3),
    subjectId: EntityIdSchema,
  }),
]);

const RecordMetadataSchema = z.strictObject({
  createdAt: TimestampSchema,
  id: EntityIdSchema,
  spaceId: EntityIdSchema,
  updatedAt: TimestampSchema,
  version: z.number().int().nonnegative(),
});

export const MvpCoreSharedSignalSchema: z.ZodType<MvpCoreSharedSignal> =
  RecordMetadataSchema.extend({
    conclusion: DetailTextSchema,
    consentDecisionId: EntityIdSchema,
    evidenceState: z.enum(["available", "evidence_missing"]),
    provenance: z
      .array(
        z.strictObject({
          evidenceId: EntityIdSchema,
          occurredAt: TimestampSchema,
          sourceType: z.enum([
            "agent_dm",
            "family_group",
            "screenshot",
            "voice",
            "forward",
          ]),
          speakerId: EntityIdSchema,
          state: z.enum(["available", "deleted"]),
        }),
      )
      .min(1)
      .max(10),
    purpose: z.enum([
      "responsibility",
      "care_information",
      "family_information",
    ]),
    redactedExcerpt: z.string().trim().min(1).max(280),
    speakerId: EntityIdSchema,
    visibility: SharedVisibilitySchema,
  });

const HandoverPacketSchema = z.strictObject({
  constraints: z.array(DetailTextSchema).max(20),
  contacts: z
    .array(
      z.strictObject({
        label: ShortTextSchema,
        redactedValue: ShortTextSchema,
      }),
    )
    .max(20),
  evidenceIds: z.array(EntityIdSchema).min(1).max(50),
  history: z.array(DetailTextSchema).max(20),
  knownInformation: z.array(DetailTextSchema).max(50),
  nextAction: DetailTextSchema,
  scope: DetailTextSchema,
});

const HandoverMissingInfoSchema = z.strictObject({
  id: EntityIdSchema,
  label: ShortTextSchema,
  reason: DetailTextSchema,
});

const HandoverBaseSchema = RecordMetadataSchema.extend({
  domainId: EntityIdSchema,
  expiresAt: TimestampSchema,
  fromMemberId: EntityIdSchema,
  packet: HandoverPacketSchema,
  toMemberId: EntityIdSchema,
});

const BlockedHandoverSchema = HandoverBaseSchema.extend({
  acceptedAt: z.null(),
  declineReason: z.null(),
  declinedBy: z.null(),
  fromConfirmedAt: z.null(),
  missingInfo: z.array(HandoverMissingInfoSchema).min(1).max(20),
  status: z.literal("blocked"),
  terminalAt: z.null(),
  toConfirmedAt: z.null(),
});

const AwaitingConfirmationsHandoverSchema = HandoverBaseSchema.extend({
  acceptedAt: z.null(),
  declineReason: z.null(),
  declinedBy: z.null(),
  fromConfirmedAt: TimestampSchema.nullable(),
  missingInfo: z.array(HandoverMissingInfoSchema).max(0),
  status: z.literal("awaiting_confirmations"),
  terminalAt: z.null(),
  toConfirmedAt: TimestampSchema.nullable(),
});

const FromConfirmedHandoverSchema =
  AwaitingConfirmationsHandoverSchema.extend({
    fromConfirmedAt: TimestampSchema,
  });

const ToConfirmedHandoverSchema = AwaitingConfirmationsHandoverSchema.extend({
  toConfirmedAt: TimestampSchema,
});

const AcceptedHandoverSchema = HandoverBaseSchema.extend({
  acceptedAt: TimestampSchema,
  declineReason: z.null(),
  declinedBy: z.null(),
  fromConfirmedAt: TimestampSchema,
  missingInfo: z.array(HandoverMissingInfoSchema).max(0),
  status: z.literal("accepted"),
  terminalAt: TimestampSchema,
  toConfirmedAt: TimestampSchema,
});

export const MvpCoreHandoverSchema: z.ZodType<MvpCoreHandover> =
  z.discriminatedUnion("status", [
    BlockedHandoverSchema,
    AwaitingConfirmationsHandoverSchema,
    AcceptedHandoverSchema,
  ]);

export const MvpCoreHandoverMutationResultSchema: z.ZodType<MvpCoreHandoverMutationResult> =
  z.union([
    z.strictObject({
      handover: z.union([
        BlockedHandoverSchema,
        AwaitingConfirmationsHandoverSchema,
      ]),
      status: z.literal("information_recorded"),
    }),
    z.strictObject({
      handover: FromConfirmedHandoverSchema,
      status: z.literal("confirmation_recorded"),
    }),
    z.strictObject({
      handover: ToConfirmedHandoverSchema,
      status: z.literal("confirmation_recorded"),
    }),
  ]);

export const MvpCoreResponsibilityReportReceiptSchema = z.strictObject({
  generated: z.literal(true),
  sourceSignalId: EntityIdSchema,
});
