import { describe, expect, it } from "vitest";

import {
  AcceptedHandoverSchema,
  AuditEntrySchema,
  CareEventSchema,
  CareRuleSchema,
  DomainSchema,
  EntityIdSchema,
  EvidenceSchema,
  FIXTURE_ACCEPTED_HANDOVER,
  FIXTURE_ACTIVE_CARE_RULE,
  FIXTURE_ACTORS,
  FIXTURE_AUDIT_ENTRY,
  FIXTURE_DOMAIN,
  FIXTURE_EVIDENCE,
  FIXTURE_HANDLED_CARE_EVENT,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SPACE,
  FIXTURE_TASK,
  FIXTURE_TIMES,
  MemberSchema,
  PrivateMessageSchema,
  SharedSignalSchema,
  SpaceSchema,
  TaskSchema,
  type EntityId,
} from "../../../packages/contracts/src/index";
import {
  createPrivacyService,
  filterReportEligibleTasks,
} from "../src/index";
import {
  MemoryPrivacyStore,
  type MemoryPrivacyState,
} from "./memory-store";

const RAW_CONTENT = "明天下午想请家人一起确认复查安排。";
const GENERATED_AT = "2026-08-27T10:00:00.000Z";
const GUESSED_ID = "00000000-0000-4000-8000-000000000099";
const SECOND_SIGNAL_ID = "00000000-0000-4000-8000-000000000030";
const SECOND_TASK_ID = "00000000-0000-4000-8000-000000000031";
const SECOND_DOMAIN_ID = "00000000-0000-4000-8000-000000000032";
const SELF_AUDIT_ID = "00000000-0000-4000-8000-000000000033";

const createState = (): MemoryPrivacyState => ({
  spaces: [SpaceSchema.parse(FIXTURE_SPACE)],
  members: [
    MemberSchema.parse(FIXTURE_MEMBERS.primary),
    MemberSchema.parse(FIXTURE_MEMBERS.partner),
    MemberSchema.parse(FIXTURE_MEMBERS.subject),
  ],
  privateMessages: [PrivateMessageSchema.parse(FIXTURE_PRIVATE_MESSAGE)],
  evidence: [
    {
      evidence: EvidenceSchema.parse(FIXTURE_EVIDENCE),
      rawContent: RAW_CONTENT,
    },
  ],
  signals: [SharedSignalSchema.parse(FIXTURE_SHARED_SIGNAL)],
  domains: [DomainSchema.parse(FIXTURE_DOMAIN)],
  tasks: [TaskSchema.parse(FIXTURE_TASK)],
  handovers: [AcceptedHandoverSchema.parse(FIXTURE_ACCEPTED_HANDOVER)],
  careRules: [CareRuleSchema.parse(FIXTURE_ACTIVE_CARE_RULE)],
  careEvents: [CareEventSchema.parse(FIXTURE_HANDLED_CARE_EVENT)],
  auditEntries: [AuditEntrySchema.parse(FIXTURE_AUDIT_ENTRY)],
  idempotencyRecords: [],
});

const createIdFactory = (): (() => EntityId) => {
  let next = 200;

  return () => {
    const suffix = String(next).padStart(12, "0");
    next += 1;
    return EntityIdSchema.parse(`00000000-0000-4000-8000-${suffix}`);
  };
};

const createHarness = (state = createState()) => {
  const store = new MemoryPrivacyStore(state);
  const service = createPrivacyService({
    store,
    clock: { now: () => new Date(GENERATED_AT) },
    idFactory: createIdFactory(),
  });

  return { service, store };
};

const page = { cursor: null, limit: 100 } as const;

describe("privacy authorization", () => {
  it("returns the same non-enumerating denial for guessed and unauthorized raw evidence", async () => {
    const { service } = createHarness();
    const request = {
      requestId: FIXTURE_IDS.request,
      evidenceId: FIXTURE_IDS.evidence,
    };

    const ownResult = await service.readRawEvidence(
      FIXTURE_ACTORS.subject,
      request,
    );
    expect(ownResult.ok).toBe(true);
    if (ownResult.ok) {
      expect(ownResult.result.evidence.rawContent).toBe(RAW_CONTENT);
    }

    const unauthorized = await service.readRawEvidence(
      FIXTURE_ACTORS.primary,
      request,
    );
    const guessed = await service.readRawEvidence(FIXTURE_ACTORS.primary, {
      ...request,
      evidenceId: GUESSED_ID,
    });

    expect(unauthorized.ok).toBe(false);
    expect(guessed.ok).toBe(false);
    if (!unauthorized.ok && !guessed.ok) {
      expect(unauthorized.error).toEqual(guessed.error);
      expect(unauthorized.error.code).toBe("not_found");
    }
  });

  it("returns only redacted shared conclusions that match visibility", async () => {
    const state = createState();
    state.signals.push(
      SharedSignalSchema.parse({
        ...FIXTURE_SHARED_SIGNAL,
        id: SECOND_SIGNAL_ID,
        consentDecisionId: GUESSED_ID,
        visibility: {
          kind: "members",
          memberIds: [FIXTURE_IDS.subject],
        },
      }),
    );
    const { service } = createHarness(state);

    const visible = await service.readSharedConclusion(FIXTURE_ACTORS.partner, {
      requestId: FIXTURE_IDS.request,
      signalId: FIXTURE_IDS.signal,
    });
    expect(visible.ok).toBe(true);
    if (visible.ok) {
      const serialized = JSON.stringify(visible.result);
      expect(serialized).not.toContain("rawContent");
      expect(serialized).not.toContain("rawRef");
      expect(serialized).not.toContain(RAW_CONTENT);
      expect(visible.result.signal.redactedExcerpt).toBe(
        FIXTURE_SHARED_SIGNAL.redactedExcerpt,
      );
    }

    const hidden = await service.readSharedConclusion(FIXTURE_ACTORS.partner, {
      requestId: FIXTURE_IDS.request,
      signalId: SECOND_SIGNAL_ID,
    });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.error.code).toBe("not_found");
    }
  });

  it("filters audit history by entry visibility and binds cursors to the actor", async () => {
    const state = createState();
    state.auditEntries.push(
      AuditEntrySchema.parse({
        ...FIXTURE_AUDIT_ENTRY,
        id: SELF_AUDIT_ID,
        actor: {
          kind: "member",
          memberId: FIXTURE_IDS.subject,
          spaceId: FIXTURE_IDS.space,
          role: "subject",
        },
        targetType: "member",
        targetId: FIXTURE_IDS.subject,
        visibility: { kind: "self", memberId: FIXTURE_IDS.subject },
        occurredAt: FIXTURE_TIMES.accepted,
      }),
    );
    const { service } = createHarness(state);

    const subjectPage = await service.getAuditTrail(FIXTURE_ACTORS.subject, {
      requestId: FIXTURE_IDS.request,
      spaceId: FIXTURE_IDS.space,
      target: null,
      page: { cursor: null, limit: 1 },
    });
    expect(subjectPage.ok).toBe(true);
    if (!subjectPage.ok) {
      return;
    }
    expect(subjectPage.result.entries.map(({ id }) => id)).toEqual([
      SELF_AUDIT_ID,
    ]);
    expect(subjectPage.result.page.hasMore).toBe(true);

    const partnerWithSubjectCursor = await service.getAuditTrail(
      FIXTURE_ACTORS.partner,
      {
        requestId: FIXTURE_IDS.request,
        spaceId: FIXTURE_IDS.space,
        target: null,
        page: {
          cursor: subjectPage.result.page.nextCursor,
          limit: 1,
        },
      },
    );
    expect(partnerWithSubjectCursor.ok).toBe(false);
    if (!partnerWithSubjectCursor.ok) {
      expect(partnerWithSubjectCursor.error.code).toBe("invalid_request");
    }

    const partnerAudit = await service.getAuditTrail(FIXTURE_ACTORS.partner, {
      requestId: FIXTURE_IDS.request,
      spaceId: FIXTURE_IDS.space,
      target: null,
      page,
    });
    expect(partnerAudit.ok).toBe(true);
    if (partnerAudit.ok) {
      expect(partnerAudit.result.entries.map(({ id }) => id)).toEqual([
        FIXTURE_IDS.audit,
      ]);
    }
  });
});

describe("analysis consent", () => {
  it("blocks future analysis while preserving prior authorized records and events", async () => {
    const { service, store } = createHarness();
    const analysisRequest = {
      requestId: FIXTURE_IDS.request,
      evidenceIds: [FIXTURE_IDS.evidence],
    };
    const before = await store.snapshot();

    const authorized = await service.authorizeFutureAnalysis(
      FIXTURE_ACTORS.subject,
      analysisRequest,
    );
    expect(authorized.ok).toBe(true);

    const revokeRequest = {
      requestId: FIXTURE_IDS.request,
      idempotencyKey: "privacy_revoke_0001",
      effectiveAt: FIXTURE_TIMES.accepted,
      expectedMemberVersion: FIXTURE_MEMBERS.subject.version,
    };
    const revoked = await service.revokeAnalysisConsent(
      FIXTURE_ACTORS.subject,
      revokeRequest,
    );
    expect(revoked.ok).toBe(true);
    if (revoked.ok) {
      expect(revoked.result.priorAuthorizedEventsPreserved).toBe(true);
      expect(revoked.result.futureAnalysisEnabled).toBe(false);
    }

    const denied = await service.authorizeFutureAnalysis(
      FIXTURE_ACTORS.subject,
      analysisRequest,
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("consent_invalid");
    }

    const after = await store.snapshot();
    expect(after.signals).toEqual(before.signals);
    expect(after.auditEntries[0]).toEqual(before.auditEntries[0]);
    expect(
      after.members.find(({ id }) => id === FIXTURE_IDS.subject)
        ?.analysisConsent,
    ).toBe("revoked");
    expect(after.auditEntries).toHaveLength(before.auditEntries.length + 1);

    const replay = await service.revokeAnalysisConsent(
      FIXTURE_ACTORS.subject,
      revokeRequest,
    );
    expect(replay).toEqual(revoked);
    expect((await store.snapshot()).auditEntries).toHaveLength(
      before.auditEntries.length + 1,
    );
  });
});

describe("evidence deletion", () => {
  it("invalidates every dependent projection and preserves accepted handover history", async () => {
    const state = createState();
    state.signals.push(
      SharedSignalSchema.parse({
        ...FIXTURE_SHARED_SIGNAL,
        id: SECOND_SIGNAL_ID,
        consentDecisionId: GUESSED_ID,
      }),
    );
    state.tasks.push(
      TaskSchema.parse({
        ...FIXTURE_TASK,
        id: SECOND_TASK_ID,
      }),
    );
    state.domains.push(
      DomainSchema.parse({
        ...FIXTURE_DOMAIN,
        id: SECOND_DOMAIN_ID,
        name: "第二责任域",
      }),
    );
    const acceptedBefore = structuredClone(state.handovers);
    const { service, store } = createHarness(state);
    const request = {
      requestId: FIXTURE_IDS.request,
      idempotencyKey: "privacy_delete_evidence_0001",
      evidenceId: FIXTURE_IDS.evidence,
      expectedVersion: FIXTURE_EVIDENCE.version,
    };

    const deleted = await service.deleteEvidence(
      FIXTURE_ACTORS.subject,
      request,
    );
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      return;
    }

    expect(deleted.result.receipt).toMatchObject({
      evidenceId: FIXTURE_IDS.evidence,
      invalidatedSignalIds: [FIXTURE_IDS.signal, SECOND_SIGNAL_ID],
      needsReviewTaskIds: [FIXTURE_IDS.task, SECOND_TASK_ID],
      needsReviewDomainIds: [FIXTURE_IDS.domain, SECOND_DOMAIN_ID],
      preservedAcceptedHandoverIds: [FIXTURE_IDS.handover],
      excludedFromFutureReports: true,
      acceptedHandoversReversed: false,
    });

    const snapshot = await store.snapshot();
    expect(snapshot.evidence[0]).toMatchObject({
      rawContent: null,
      evidence: { state: "deleted", rawRef: "deleted" },
    });
    expect(snapshot.signals).toHaveLength(2);
    expect(
      snapshot.signals.every(
        (signal) =>
          signal.evidenceState === "evidence_missing" &&
          signal.provenance.every(({ state: itemState }) =>
            itemState === "deleted",
          ),
      ),
    ).toBe(true);
    expect(snapshot.tasks.every(({ reviewState }) => reviewState === "needs_review")).toBe(
      true,
    );
    expect(snapshot.domains.every(({ status }) => status === "needs_review")).toBe(
      true,
    );
    expect(snapshot.domains[0]?.ownerId).toBe(FIXTURE_DOMAIN.ownerId);
    expect(snapshot.handovers).toEqual(acceptedBefore);
    expect(
      filterReportEligibleTasks(
        snapshot.tasks,
        snapshot.evidence.map(({ evidence }) => evidence),
      ),
    ).toEqual([]);

    const rawAfterDeletion = await service.readRawEvidence(
      FIXTURE_ACTORS.subject,
      {
        requestId: FIXTURE_IDS.request,
        evidenceId: FIXTURE_IDS.evidence,
      },
    );
    expect(rawAfterDeletion.ok).toBe(false);
    if (!rawAfterDeletion.ok) {
      expect(rawAfterDeletion.error.code).toBe("not_found");
    }

    const replay = await service.deleteEvidence(
      FIXTURE_ACTORS.subject,
      request,
    );
    expect(replay).toEqual(deleted);
    expect((await store.snapshot()).auditEntries).toHaveLength(2);
  });
});

describe("personal export", () => {
  it("includes only currently authorized records and persists content-free replay metadata", async () => {
    const { service, store } = createHarness();

    const partnerExport = await service.exportMyData(FIXTURE_ACTORS.partner, {
      requestId: FIXTURE_IDS.request,
      idempotencyKey: "privacy_export_partner_0001",
      format: "json",
      requestedAt: FIXTURE_TIMES.accepted,
    });
    expect(partnerExport.ok).toBe(true);
    if (partnerExport.ok) {
      expect(partnerExport.result.bundle.privateMessages).toEqual([]);
      expect(partnerExport.result.bundle.evidence).toEqual([]);
      expect(partnerExport.result.bundle.visibleSignals).toHaveLength(1);
      expect(partnerExport.result.bundle.member.id).toBe(FIXTURE_IDS.partner);
    }

    const request = {
      requestId: FIXTURE_IDS.request,
      idempotencyKey: "privacy_export_subject_0001",
      format: "json" as const,
      requestedAt: FIXTURE_TIMES.accepted,
    };
    const subjectExport = await service.exportMyData(
      FIXTURE_ACTORS.subject,
      request,
    );
    expect(subjectExport.ok).toBe(true);
    if (subjectExport.ok) {
      expect(subjectExport.result.bundle.privateMessages).toHaveLength(1);
      expect(subjectExport.result.bundle.evidence).toHaveLength(1);
      expect(subjectExport.result.bundle.member.id).toBe(FIXTURE_IDS.subject);
    }

    const replay = await service.exportMyData(FIXTURE_ACTORS.subject, request);
    expect(replay).toEqual(subjectExport);

    const snapshot = await store.snapshot();
    const replayRecords = JSON.stringify(snapshot.idempotencyRecords);
    expect(replayRecords).not.toContain(RAW_CONTENT);
    expect(replayRecords).not.toContain(FIXTURE_PRIVATE_MESSAGE.content);
    expect(replayRecords).not.toContain(FIXTURE_EVIDENCE.rawRef);
    expect(replayRecords).not.toContain("token");

    const exportAudits = snapshot.auditEntries.filter(
      ({ action }) => action === "personal_data_exported",
    );
    expect(exportAudits).toHaveLength(2);
    expect(exportAudits.every(({ changes }) => changes.length === 0)).toBe(true);
    expect(JSON.stringify(exportAudits)).not.toContain(RAW_CONTENT);
  });
});

describe("space deletion", () => {
  it("requires the exact creator and confirmation, then removes all in-space content", async () => {
    const { service, store } = createHarness();
    const request = {
      requestId: FIXTURE_IDS.request,
      idempotencyKey: "privacy_delete_space_0001",
      spaceId: FIXTURE_IDS.space,
      expectedSpaceName: FIXTURE_SPACE.name,
      typedSpaceName: FIXTURE_SPACE.name,
      expectedVersion: FIXTURE_SPACE.version,
    };

    const unauthorized = await service.deleteSpace(
      FIXTURE_ACTORS.partner,
      request,
    );
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) {
      expect(unauthorized.error.code).toBe("not_found");
    }
    expect((await store.snapshot()).spaces).toHaveLength(1);

    const mismatch = await service.deleteSpace(FIXTURE_ACTORS.primary, {
      ...request,
      typedSpaceName: `${FIXTURE_SPACE.name} `,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.error.code).toBe("deletion_confirmation_required");
    }

    const deleted = await service.deleteSpace(FIXTURE_ACTORS.primary, request);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.result).toMatchObject({
        status: "deleted",
        persistedAfterDeletion: false,
        containsProductContent: false,
      });
      expect(Object.keys(deleted.result).sort()).toEqual([
        "containsProductContent",
        "deletedAt",
        "deletionReceiptId",
        "persistedAfterDeletion",
        "status",
      ]);
    }

    const snapshot = await store.snapshot();
    const remainingRecordCount =
      snapshot.spaces.length +
      snapshot.members.length +
      snapshot.privateMessages.length +
      snapshot.evidence.length +
      snapshot.signals.length +
      snapshot.domains.length +
      snapshot.tasks.length +
      snapshot.handovers.length +
      snapshot.careRules.length +
      snapshot.careEvents.length +
      snapshot.auditEntries.length +
      snapshot.idempotencyRecords.length;
    expect(remainingRecordCount).toBe(0);

    const replayAfterDeletion = await service.deleteSpace(
      FIXTURE_ACTORS.primary,
      request,
    );
    expect(replayAfterDeletion.ok).toBe(false);
    if (!replayAfterDeletion.ok) {
      expect(replayAfterDeletion.error.code).toBe("not_found");
    }
  });
});
