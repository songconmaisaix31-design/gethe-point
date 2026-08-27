import {
  FIXTURE_ACKNOWLEDGED_CARE_EVENT,
  FIXTURE_ACTORS,
  FIXTURE_AUDIT_ENTRY,
  FIXTURE_AWAITING_HANDOVER,
  FIXTURE_BLOCKED_HANDOVER,
  FIXTURE_CONVERSATION,
  FIXTURE_DOMAIN,
  FIXTURE_EVIDENCE,
  FIXTURE_IDS,
  FIXTURE_NOTIFIED_CARE_EVENT,
  FIXTURE_ESCALATED_CARE_EVENT,
  FIXTURE_HANDLED_CARE_EVENT,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_PROVENANCE,
  FIXTURE_REPORT,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_TASK,
  FIXTURE_TIMES,
  AcknowledgeCareEventResultSchema,
  DecideConsentResultSchema,
  DeleteEvidenceResultSchema,
  DeleteSpaceResultSchema,
  ExportMyDataResultSchema,
  GetAuditTrailResultSchema,
  GetCareInboxResultSchema,
  GetDomainWithEvidenceResultSchema,
  GetPendingHandoversResultSchema,
  GetResponsibilityReportResultSchema,
  GetVisibleSharedSignalsResultSchema,
  HandleCareEventResultSchema,
  OPERATION_EXAMPLES,
  RevokeAnalysisConsentResultSchema,
  SupplyHandoverInfoResultSchema,
  ConfirmHandoverFromResultSchema,
  ConfirmHandoverToResultSchema,
  type GetPrivateConversationResult,
  type GetRoleHomeResult,
  type MemberActor,
  type MemberRole,
} from "./contracts";

import type { ExperienceBundle, ExperienceClient } from "./client";

const FIXTURE_LATENCY_MS = 18;
const pageRequest = { cursor: null, limit: 20 } as const;
const emptyPage = { nextCursor: null, hasMore: false } as const;

const waitForFixture = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, FIXTURE_LATENCY_MS);
  });
};

const roleConversationCopy = Object.freeze({
  primary: "这周的复查安排还有哪些信息需要我记着？",
  partner: "我准备接手复查安排，请帮我核对交接范围。",
  subject: FIXTURE_PRIVATE_MESSAGE.content,
} as const satisfies Readonly<Record<MemberRole, string>>);

const roleHome = (role: MemberRole): GetRoleHomeResult => {
  switch (role) {
    case "primary":
      return {
        status: "ready",
        home: {
          role,
          dataMode: "fixture",
          rememberedItemCount: 7,
          domainIds: [FIXTURE_IDS.domain],
          pendingHandoverIds: [FIXTURE_IDS.handover],
          needsReviewCount: 0,
        },
      };
    case "partner":
      return {
        status: "ready",
        home: {
          role,
          dataMode: "fixture",
          ownedDomainIds: [FIXTURE_IDS.domain],
          pendingHandoverIds: [FIXTURE_IDS.handover],
          careInboxCount: 1,
        },
      };
    case "subject":
      return {
        status: "ready",
        home: {
          role,
          dataMode: "fixture",
          privateConversationId: FIXTURE_IDS.conversation,
          pendingCareEventIds: [FIXTURE_IDS.careEvent],
          oneStepAcknowledgement: true,
        },
      };
  }
};

const privateConversation = (actor: MemberActor): GetPrivateConversationResult => ({
  status: "ready",
  conversation: {
    conversation: {
      ...FIXTURE_CONVERSATION,
      participantMemberIds: [actor.memberId],
    },
    messages: [
      {
        ...FIXTURE_PRIVATE_MESSAGE,
        authorId: actor.memberId,
        content: roleConversationCopy[actor.role],
        visibility: { kind: "self", memberId: actor.memberId },
      },
    ],
    page: emptyPage,
  },
});

export const fixtureExperienceClient: ExperienceClient = {
  query: {
    async getRoleHome({ actor }) {
      await waitForFixture();
      return roleHome(actor.role);
    },
    async getPrivateConversation({ actor }) {
      await waitForFixture();
      return privateConversation(actor);
    },
    async getVisibleSharedSignals() {
      await waitForFixture();
      return GetVisibleSharedSignalsResultSchema.parse({
        status: "ready",
        signals: [FIXTURE_SHARED_SIGNAL],
        page: emptyPage,
      });
    },
    async getResponsibilityReport() {
      await waitForFixture();
      return GetResponsibilityReportResultSchema.parse({
        status: "ready",
        report: FIXTURE_REPORT,
      });
    },
    async getDomainWithEvidence() {
      await waitForFixture();
      return GetDomainWithEvidenceResultSchema.parse({
        status: "ready",
        domain: {
          domain: FIXTURE_DOMAIN,
          tasks: [FIXTURE_TASK],
          evidence: [{ view: "provenance", evidence: FIXTURE_PROVENANCE }],
        },
      });
    },
    async getPendingHandovers({ actor }) {
      await waitForFixture();
      const handovers =
        actor.role === "primary"
          ? [FIXTURE_BLOCKED_HANDOVER]
          : actor.role === "partner"
            ? [FIXTURE_AWAITING_HANDOVER]
            : [];
      return GetPendingHandoversResultSchema.parse({
        status: "ready",
        handovers,
        page: emptyPage,
      });
    },
    async getCareInbox({ actor }) {
      await waitForFixture();
      const event =
        actor.role === "subject"
          ? FIXTURE_NOTIFIED_CARE_EVENT
          : actor.role === "partner"
            ? FIXTURE_ESCALATED_CARE_EVENT
            : FIXTURE_HANDLED_CARE_EVENT;
      return GetCareInboxResultSchema.parse({
        status: "ready",
        events: [event],
        page: emptyPage,
      });
    },
    async getAuditTrail() {
      await waitForFixture();
      return GetAuditTrailResultSchema.parse({
        status: "ready",
        entries: [FIXTURE_AUDIT_ENTRY],
        page: emptyPage,
      });
    },
  },
  command: {
    async decideConsent() {
      await waitForFixture();
      return DecideConsentResultSchema.parse(OPERATION_EXAMPLES.DecideConsent.result);
    },
    async supplyHandoverInfo() {
      await waitForFixture();
      return SupplyHandoverInfoResultSchema.parse(
        OPERATION_EXAMPLES.SupplyHandoverInfo.result,
      );
    },
    async confirmHandoverFrom() {
      await waitForFixture();
      return ConfirmHandoverFromResultSchema.parse(
        OPERATION_EXAMPLES.ConfirmHandoverFrom.result,
      );
    },
    async confirmHandoverTo() {
      await waitForFixture();
      return ConfirmHandoverToResultSchema.parse(
        OPERATION_EXAMPLES.ConfirmHandoverTo.result,
      );
    },
    async acknowledgeCareEvent() {
      await waitForFixture();
      return AcknowledgeCareEventResultSchema.parse({
        status: "acknowledged",
        careEvent: FIXTURE_ACKNOWLEDGED_CARE_EVENT,
      });
    },
    async handleCareEvent() {
      await waitForFixture();
      return HandleCareEventResultSchema.parse(OPERATION_EXAMPLES.HandleCareEvent.result);
    },
    async deleteEvidence() {
      await waitForFixture();
      return DeleteEvidenceResultSchema.parse(OPERATION_EXAMPLES.DeleteEvidence.result);
    },
    async revokeAnalysisConsent() {
      await waitForFixture();
      return RevokeAnalysisConsentResultSchema.parse(
        OPERATION_EXAMPLES.RevokeAnalysisConsent.result,
      );
    },
    async exportMyData() {
      await waitForFixture();
      return ExportMyDataResultSchema.parse(OPERATION_EXAMPLES.ExportMyData.result);
    },
    async deleteSpace() {
      await waitForFixture();
      return DeleteSpaceResultSchema.parse(OPERATION_EXAMPLES.DeleteSpace.result);
    },
  },
};

export const getFixtureActor = (role: MemberRole): MemberActor => FIXTURE_ACTORS[role];

export const loadExperienceBundle = async (
  client: ExperienceClient,
  role: MemberRole,
): Promise<ExperienceBundle> => {
  const actor = getFixtureActor(role);
  const baseRequest = { requestId: FIXTURE_IDS.request } as const;
  const page = pageRequest;

  const reportPromise =
    role === "subject"
      ? Promise.resolve(null)
      : client.query
          .getResponsibilityReport({
            actor,
            request: {
              ...baseRequest,
              spaceId: FIXTURE_IDS.space,
              period: FIXTURE_REPORT.period,
            },
          })
          .then(({ report }) => report);

  const [
    { home },
    { conversation },
    { signals },
    report,
    { domain },
    { handovers },
    { events: careEvents },
    { entries: auditEntries },
  ] = await Promise.all([
    client.query.getRoleHome({
      actor,
      request: { ...baseRequest, spaceId: FIXTURE_IDS.space },
    }),
    client.query.getPrivateConversation({
      actor,
      request: { ...baseRequest, conversationId: FIXTURE_IDS.conversation, page },
    }),
    client.query.getVisibleSharedSignals({
      actor,
      request: { ...baseRequest, spaceId: FIXTURE_IDS.space, page },
    }),
    reportPromise,
    client.query.getDomainWithEvidence({
      actor,
      request: { ...baseRequest, domainId: FIXTURE_IDS.domain },
    }),
    client.query.getPendingHandovers({
      actor,
      request: { ...baseRequest, spaceId: FIXTURE_IDS.space, page },
    }),
    client.query.getCareInbox({
      actor,
      request: { ...baseRequest, spaceId: FIXTURE_IDS.space, page },
    }),
    client.query.getAuditTrail({
      actor,
      request: { ...baseRequest, spaceId: FIXTURE_IDS.space, target: null, page },
    }),
  ]);

  return {
    home,
    conversation,
    signals,
    report,
    domain,
    handovers,
    careEvents,
    auditEntries,
  };
};

export const FIXTURE_ACTION_CONTEXT = Object.freeze({
  requestId: FIXTURE_IDS.request,
  idempotencyKey: "idem_fixture_experience_0001",
  occurredAt: FIXTURE_TIMES.updated,
  evidence: FIXTURE_EVIDENCE,
});
