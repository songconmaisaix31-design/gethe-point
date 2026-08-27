import type { OperationName } from "./operations";

export const FIXTURE_IDS = Object.freeze({
  space: "00000000-0000-4000-8000-000000000001",
  primary: "00000000-0000-4000-8000-000000000002",
  partner: "00000000-0000-4000-8000-000000000003",
  subject: "00000000-0000-4000-8000-000000000004",
  conversation: "00000000-0000-4000-8000-000000000010",
  message: "00000000-0000-4000-8000-000000000011",
  evidence: "00000000-0000-4000-8000-000000000012",
  signalDraft: "00000000-0000-4000-8000-000000000013",
  consent: "00000000-0000-4000-8000-000000000014",
  signal: "00000000-0000-4000-8000-000000000015",
  domain: "00000000-0000-4000-8000-000000000016",
  task: "00000000-0000-4000-8000-000000000017",
  handover: "00000000-0000-4000-8000-000000000018",
  missingInfo: "00000000-0000-4000-8000-000000000019",
  careRule: "00000000-0000-4000-8000-000000000020",
  careEvent: "00000000-0000-4000-8000-000000000021",
  audit: "00000000-0000-4000-8000-000000000022",
  export: "00000000-0000-4000-8000-000000000023",
  deletionReceipt: "00000000-0000-4000-8000-000000000024",
  notification: "00000000-0000-4000-8000-000000000025",
  clientMessage: "00000000-0000-4000-8000-000000000026",
  request: "00000000-0000-4000-8000-000000000101",
} as const);

export const FIXTURE_TIMES = Object.freeze({
  created: "2026-08-27T08:00:00+08:00",
  updated: "2026-08-27T08:05:00+08:00",
  confirmedFrom: "2026-08-27T08:10:00+08:00",
  confirmedTo: "2026-08-27T08:11:00+08:00",
  accepted: "2026-08-27T08:12:00+08:00",
  expires: "2026-08-28T08:00:00+08:00",
  scheduled: "2026-08-27T20:00:00+08:00",
  deadline: "2026-08-27T20:01:00+08:00",
  handled: "2026-08-27T20:03:00+08:00",
  periodEnd: "2026-08-28T00:00:00+08:00",
} as const);

const record = (id: string, version = 0) => ({
  id,
  spaceId: FIXTURE_IDS.space,
  createdAt: FIXTURE_TIMES.created,
  updatedAt: FIXTURE_TIMES.updated,
  version,
});

export const FIXTURE_ACTORS = Object.freeze({
  primary: Object.freeze({
    kind: "member",
    memberId: FIXTURE_IDS.primary,
    spaceId: FIXTURE_IDS.space,
    role: "primary",
    authentication: "fixture_demo",
  }),
  partner: Object.freeze({
    kind: "member",
    memberId: FIXTURE_IDS.partner,
    spaceId: FIXTURE_IDS.space,
    role: "partner",
    authentication: "fixture_demo",
  }),
  subject: Object.freeze({
    kind: "member",
    memberId: FIXTURE_IDS.subject,
    spaceId: FIXTURE_IDS.space,
    role: "subject",
    authentication: "fixture_demo",
  }),
  handoverService: Object.freeze({
    kind: "system",
    service: "handover_service",
    spaceId: FIXTURE_IDS.space,
    authentication: "internal_service",
  }),
  handoverExpiry: Object.freeze({
    kind: "system",
    service: "handover_expiry_service",
    spaceId: FIXTURE_IDS.space,
    authentication: "internal_service",
  }),
  careScheduler: Object.freeze({
    kind: "system",
    service: "care_scheduler",
    spaceId: FIXTURE_IDS.space,
    authentication: "internal_service",
  }),
} as const);

const spaceVisibility = { kind: "space" } as const;
const subjectVisibility = {
  kind: "self",
  memberId: FIXTURE_IDS.subject,
} as const;

export const FIXTURE_SPACE = Object.freeze({
  ...record(FIXTURE_IDS.space),
  name: "晨光家庭",
  createdBy: FIXTURE_IDS.primary,
  status: "active",
} as const);

export const FIXTURE_MEMBERS = Object.freeze({
  primary: Object.freeze({
    ...record(FIXTURE_IDS.primary),
    role: "primary",
    displayName: "家人甲",
    status: "active",
    joinedAt: FIXTURE_TIMES.created,
    analysisConsent: "enabled",
  }),
  partner: Object.freeze({
    ...record(FIXTURE_IDS.partner),
    role: "partner",
    displayName: "家人乙",
    status: "active",
    joinedAt: FIXTURE_TIMES.created,
    analysisConsent: "enabled",
  }),
  subject: Object.freeze({
    ...record(FIXTURE_IDS.subject),
    role: "subject",
    displayName: "长辈甲",
    status: "active",
    joinedAt: FIXTURE_TIMES.created,
    analysisConsent: "enabled",
  }),
} as const);

export const FIXTURE_CONVERSATION = Object.freeze({
  ...record(FIXTURE_IDS.conversation),
  type: "agent_dm",
  participantMemberIds: [FIXTURE_IDS.subject],
} as const);

export const FIXTURE_PRIVATE_MESSAGE = Object.freeze({
  ...record(FIXTURE_IDS.message),
  conversationId: FIXTURE_IDS.conversation,
  authorId: FIXTURE_IDS.subject,
  clientMessageId: FIXTURE_IDS.clientMessage,
  content: "明天下午想请家人一起确认复查安排。",
  occurredAt: FIXTURE_TIMES.created,
  visibility: subjectVisibility,
} as const);

export const FIXTURE_EVIDENCE = Object.freeze({
  ...record(FIXTURE_IDS.evidence),
  sourceType: "agent_dm",
  speakerId: FIXTURE_IDS.subject,
  occurredAt: FIXTURE_TIMES.created,
  rawRef: "device://fixture/evidence-1",
  visibility: subjectVisibility,
  state: "available",
} as const);

export const FIXTURE_PROVENANCE = Object.freeze({
  evidenceId: FIXTURE_IDS.evidence,
  sourceType: "agent_dm",
  speakerId: FIXTURE_IDS.subject,
  occurredAt: FIXTURE_TIMES.created,
  state: "available",
} as const);

export const FIXTURE_SIGNAL_DRAFT = Object.freeze({
  ...record(FIXTURE_IDS.signalDraft),
  speakerId: FIXTURE_IDS.subject,
  sourceMessageId: FIXTURE_IDS.message,
  evidenceIds: [FIXTURE_IDS.evidence],
  kind: "potential_task",
  redactedExcerpt: "长辈希望家人确认复查安排。",
  proposedConclusion: "需要确认近期复查的时间与陪同安排。",
  candidateDomainId: FIXTURE_IDS.domain,
  confidence: 0.92,
  missingInfo: [],
  promptVersion: "signal-draft-v1",
  source: "fixture",
} as const);

export const FIXTURE_CONSENT = Object.freeze({
  ...record(FIXTURE_IDS.consent),
  signalDraftId: FIXTURE_IDS.signalDraft,
  speakerId: FIXTURE_IDS.subject,
  decidedAt: FIXTURE_TIMES.updated,
  recordState: "active",
  outcome: "share",
  visibility: {
    kind: "care_related",
    subjectId: FIXTURE_IDS.subject,
    memberIds: [FIXTURE_IDS.subject, FIXTURE_IDS.primary, FIXTURE_IDS.partner],
  },
  expiresAt: null,
  revokedAt: null,
} as const);

export const FIXTURE_SHARED_SIGNAL = Object.freeze({
  ...record(FIXTURE_IDS.signal),
  speakerId: FIXTURE_IDS.subject,
  consentDecisionId: FIXTURE_IDS.consent,
  redactedExcerpt: "长辈希望家人确认复查安排。",
  conclusion: "需要确认近期复查的时间与陪同安排。",
  purpose: "care_information",
  visibility: FIXTURE_CONSENT.visibility,
  provenance: [FIXTURE_PROVENANCE],
  evidenceState: "available",
} as const);

export const FIXTURE_DOMAIN = Object.freeze({
  ...record(FIXTURE_IDS.domain, 2),
  name: "近期复查安排",
  ownerId: FIXTURE_IDS.primary,
  status: "active",
  nextAction: "补齐上次检查结果并确认时间",
  visibility: spaceVisibility,
  evidenceIds: [FIXTURE_IDS.evidence],
} as const);

export const FIXTURE_TASK = Object.freeze({
  ...record(FIXTURE_IDS.task, 1),
  domainId: FIXTURE_IDS.domain,
  title: "确认复查时间",
  dueAt: FIXTURE_TIMES.expires,
  status: "open",
  reviewState: "current",
  visibility: spaceVisibility,
  evidenceIds: [FIXTURE_IDS.evidence],
  discoveredBy: FIXTURE_IDS.subject,
  deadlineKeptBy: FIXTURE_IDS.primary,
  scheduledBy: FIXTURE_IDS.primary,
  executedBy: FIXTURE_IDS.partner,
  followedUpBy: FIXTURE_IDS.primary,
} as const);

export const FIXTURE_HANDOVER_PACKET = Object.freeze({
  scope: "负责本次复查预约、陪同与结果跟进。",
  history: ["已确认需要近期复查。"],
  constraints: ["时间需与长辈确认。"],
  contacts: [{ label: "门诊", redactedValue: "示例联系人" }],
  knownInformation: ["责任域当前由家人甲负责。"],
  nextAction: "查看上次检查结果。",
  evidenceIds: [FIXTURE_IDS.evidence],
} as const);

const handoverBase = {
  ...record(FIXTURE_IDS.handover),
  domainId: FIXTURE_IDS.domain,
  fromMemberId: FIXTURE_IDS.primary,
  toMemberId: FIXTURE_IDS.partner,
  packet: FIXTURE_HANDOVER_PACKET,
  expiresAt: FIXTURE_TIMES.expires,
} as const;

export const FIXTURE_BLOCKED_HANDOVER = Object.freeze({
  ...handoverBase,
  status: "blocked",
  missingInfo: [
    {
      id: FIXTURE_IDS.missingInfo,
      label: "上次检查结果",
      reason: "接手人需要这项信息才能继续安排。",
    },
  ],
  fromConfirmedAt: null,
  toConfirmedAt: null,
  acceptedAt: null,
  terminalAt: null,
  declinedBy: null,
  declineReason: null,
} as const);

export const FIXTURE_AWAITING_HANDOVER = Object.freeze({
  ...handoverBase,
  version: 2,
  status: "awaiting_confirmations",
  missingInfo: [],
  fromConfirmedAt: null,
  toConfirmedAt: null,
  acceptedAt: null,
  terminalAt: null,
  declinedBy: null,
  declineReason: null,
} as const);

export const FIXTURE_FROM_CONFIRMED_HANDOVER = Object.freeze({
  ...FIXTURE_AWAITING_HANDOVER,
  version: 3,
  fromConfirmedAt: FIXTURE_TIMES.confirmedFrom,
} as const);

export const FIXTURE_BOTH_CONFIRMED_HANDOVER = Object.freeze({
  ...FIXTURE_FROM_CONFIRMED_HANDOVER,
  version: 4,
  toConfirmedAt: FIXTURE_TIMES.confirmedTo,
} as const);

export const FIXTURE_ACCEPTED_HANDOVER = Object.freeze({
  ...handoverBase,
  version: 5,
  status: "accepted",
  missingInfo: [],
  fromConfirmedAt: FIXTURE_TIMES.confirmedFrom,
  toConfirmedAt: FIXTURE_TIMES.confirmedTo,
  acceptedAt: FIXTURE_TIMES.accepted,
  terminalAt: FIXTURE_TIMES.accepted,
  declinedBy: null,
  declineReason: null,
} as const);

export const FIXTURE_DECLINED_HANDOVER = Object.freeze({
  ...handoverBase,
  version: 3,
  status: "declined",
  missingInfo: [],
  fromConfirmedAt: FIXTURE_TIMES.confirmedFrom,
  toConfirmedAt: null,
  acceptedAt: null,
  terminalAt: FIXTURE_TIMES.confirmedTo,
  declinedBy: FIXTURE_IDS.partner,
  declineReason: "当前时间安排无法接手。",
} as const);

export const FIXTURE_EXPIRED_HANDOVER = Object.freeze({
  ...handoverBase,
  version: 3,
  status: "expired",
  missingInfo: [],
  fromConfirmedAt: null,
  toConfirmedAt: null,
  acceptedAt: null,
  terminalAt: FIXTURE_TIMES.expires,
  declinedBy: null,
  declineReason: null,
} as const);

export const FIXTURE_CARE_SCHEDULE = Object.freeze({
  kind: "daily",
  timezone: "Asia/Shanghai",
  times: ["20:00"],
} as const);

export const FIXTURE_ESCALATION_CHAIN = Object.freeze([
  Object.freeze({
    level: 1,
    delaySec: 60,
    targetMemberIds: [FIXTURE_IDS.partner],
    action: "notify",
  }),
  Object.freeze({
    level: 2,
    delaySec: 60,
    targetMemberIds: [FIXTURE_IDS.primary],
    action: "request_in_person_check",
  }),
] as const);

export const FIXTURE_ACTIVE_CARE_RULE = Object.freeze({
  ...record(FIXTURE_IDS.careRule, 1),
  subjectId: FIXTURE_IDS.subject,
  title: "晚间确认",
  schedule: FIXTURE_CARE_SCHEDULE,
  requireAck: true,
  ackTimeoutSec: 60,
  escalationChain: FIXTURE_ESCALATION_CHAIN,
  primaryCaregiverId: FIXTURE_IDS.primary,
  createdFromEvidenceId: FIXTURE_IDS.evidence,
  terminalBehavior: "unresolved_after_chain",
  status: "active",
  confirmedBy: FIXTURE_IDS.primary,
  confirmedAt: FIXTURE_TIMES.updated,
} as const);

const careEventBase = {
  ...record(FIXTURE_IDS.careEvent, 1),
  careRuleId: FIXTURE_IDS.careRule,
  subjectId: FIXTURE_IDS.subject,
  occurrenceKey: "care-rule-1:2026-08-27T20:00:00+08:00",
  scheduledFor: FIXTURE_TIMES.scheduled,
  acknowledgementDeadline: FIXTURE_TIMES.deadline,
  notificationIntentIds: [FIXTURE_IDS.notification],
} as const;

export const FIXTURE_NOTIFIED_CARE_EVENT = Object.freeze({
  ...careEventBase,
  state: "notified",
  notifiedAt: FIXTURE_TIMES.scheduled,
  acknowledgedAt: null,
  timedOutAt: null,
  escalationLevel: 0,
  escalatedAt: null,
  handledAt: null,
  closedAt: null,
  unresolvedAt: null,
} as const);

export const FIXTURE_ACKNOWLEDGED_CARE_EVENT = Object.freeze({
  ...FIXTURE_NOTIFIED_CARE_EVENT,
  version: 2,
  state: "acknowledged",
  acknowledgedAt: FIXTURE_TIMES.deadline,
} as const);

export const FIXTURE_ESCALATED_CARE_EVENT = Object.freeze({
  ...FIXTURE_NOTIFIED_CARE_EVENT,
  version: 3,
  state: "escalated",
  timedOutAt: FIXTURE_TIMES.deadline,
  escalationLevel: 1,
  escalatedAt: FIXTURE_TIMES.handled,
} as const);

export const FIXTURE_HANDLED_CARE_EVENT = Object.freeze({
  ...FIXTURE_ESCALATED_CARE_EVENT,
  version: 4,
  state: "handled",
  handledAt: FIXTURE_TIMES.handled,
} as const);

export const FIXTURE_AUDIT_ENTRY = Object.freeze({
  id: FIXTURE_IDS.audit,
  spaceId: FIXTURE_IDS.space,
  actor: {
    kind: "member",
    memberId: FIXTURE_IDS.primary,
    spaceId: FIXTURE_IDS.space,
    role: "primary",
  },
  action: "task_attribution_corrected",
  targetType: "task",
  targetId: FIXTURE_IDS.task,
  beforeVersion: 0,
  afterVersion: 1,
  changes: [
    {
      field: "executedBy",
      before: { kind: "id", value: FIXTURE_IDS.primary },
      after: { kind: "id", value: FIXTURE_IDS.partner },
    },
  ],
  visibility: spaceVisibility,
  occurredAt: FIXTURE_TIMES.updated,
  retention: "until_space_deleted",
} as const);

export const FIXTURE_REPORT = Object.freeze({
  spaceId: FIXTURE_IDS.space,
  period: {
    startAt: FIXTURE_TIMES.created,
    endAt: FIXTURE_TIMES.periodEnd,
  },
  generatedAt: FIXTURE_TIMES.periodEnd,
  rows: [
    { stage: "discoveredBy", counts: [{ memberId: FIXTURE_IDS.subject, count: 1 }] },
    { stage: "deadlineKeptBy", counts: [{ memberId: FIXTURE_IDS.primary, count: 1 }] },
    { stage: "scheduledBy", counts: [{ memberId: FIXTURE_IDS.primary, count: 1 }] },
    { stage: "executedBy", counts: [{ memberId: FIXTURE_IDS.partner, count: 1 }] },
    { stage: "followedUpBy", counts: [{ memberId: FIXTURE_IDS.primary, count: 1 }] },
  ],
  unownedDomainCount: 0,
  excludedNeedsReviewCount: 0,
  narrative: "本周家庭协调工作集中在一位成员身上，执行已有分担，责任交接仍需完整确认。",
  source: "deterministic_template",
} as const);

const requestContext = { requestId: FIXTURE_IDS.request } as const;
const idempotentContext = {
  ...requestContext,
  idempotencyKey: "idem_fixture_contract_0001",
} as const;
const emptyPage = { nextCursor: null, hasMore: false } as const;

export interface OperationExample {
  readonly actor: unknown;
  readonly request: unknown;
  readonly result: unknown;
}

export const OPERATION_EXAMPLES = Object.freeze({
  CreatePrivateMessage: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...requestContext,
      conversationId: FIXTURE_IDS.conversation,
      clientMessageId: FIXTURE_IDS.clientMessage,
      content: FIXTURE_PRIVATE_MESSAGE.content,
      occurredAt: FIXTURE_TIMES.created,
    },
    result: { status: "created", message: FIXTURE_PRIVATE_MESSAGE },
  },
  CreateSignalDraft: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...requestContext,
      privateMessageId: FIXTURE_IDS.message,
      evidenceIds: [FIXTURE_IDS.evidence],
      purpose: "signal_draft",
      promptVersion: "signal-draft-v1",
    },
    result: {
      status: "draft_created",
      draft: FIXTURE_SIGNAL_DRAFT,
      metadata: {
        requestId: FIXTURE_IDS.request,
        purpose: "signal_draft",
        promptVersion: "signal-draft-v1",
        attempts: 1,
        providerOutcome: "fixture",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        contentLogged: false,
      },
    },
  },
  DecideConsent: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...requestContext,
      signalDraftId: FIXTURE_IDS.signalDraft,
      decision: "share",
      visibility: FIXTURE_CONSENT.visibility,
      decidedAt: FIXTURE_TIMES.updated,
      expiresAt: null,
    },
    result: { status: "decision_recorded", decision: FIXTURE_CONSENT },
  },
  ConfirmSignal: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...idempotentContext,
      signalDraftId: FIXTURE_IDS.signalDraft,
      consentDecisionId: FIXTURE_IDS.consent,
      expectedDraftVersion: 0,
    },
    result: { status: "confirmed", signal: FIXTURE_SHARED_SIGNAL },
  },
  CorrectTaskAttribution: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      taskId: FIXTURE_IDS.task,
      attribution: {
        discoveredBy: FIXTURE_IDS.subject,
        deadlineKeptBy: FIXTURE_IDS.primary,
        scheduledBy: FIXTURE_IDS.primary,
        executedBy: FIXTURE_IDS.partner,
        followedUpBy: FIXTURE_IDS.primary,
      },
      reason: "按已确认的实际执行人修正。",
      expectedVersion: 0,
    },
    result: {
      status: "corrected",
      task: FIXTURE_TASK,
      auditEntryId: FIXTURE_IDS.audit,
    },
  },
  ProposeHandover: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      domainId: FIXTURE_IDS.domain,
      toMemberId: FIXTURE_IDS.partner,
      packet: FIXTURE_HANDOVER_PACKET,
      missingInfo: FIXTURE_BLOCKED_HANDOVER.missingInfo,
      expiresAt: FIXTURE_TIMES.expires,
      expectedDomainVersion: 2,
    },
    result: {
      status: "proposal_recorded",
      handover: FIXTURE_BLOCKED_HANDOVER,
    },
  },
  SupplyHandoverInfo: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      resolvedItems: [
        {
          missingInfoId: FIXTURE_IDS.missingInfo,
          value: "已在授权范围内补充示例检查结果。",
          evidenceIds: [FIXTURE_IDS.evidence],
        },
      ],
      expectedVersion: 1,
    },
    result: {
      status: "information_recorded",
      handover: FIXTURE_AWAITING_HANDOVER,
    },
  },
  ConfirmHandoverFrom: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      confirmedAt: FIXTURE_TIMES.confirmedFrom,
      expectedVersion: 2,
    },
    result: {
      status: "confirmation_recorded",
      handover: FIXTURE_FROM_CONFIRMED_HANDOVER,
    },
  },
  ConfirmHandoverTo: {
    actor: FIXTURE_ACTORS.partner,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      confirmedAt: FIXTURE_TIMES.confirmedTo,
      expectedVersion: 3,
    },
    result: {
      status: "confirmation_recorded",
      handover: FIXTURE_BOTH_CONFIRMED_HANDOVER,
    },
  },
  AcceptHandover: {
    actor: FIXTURE_ACTORS.handoverService,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      expectedHandoverVersion: 4,
      expectedDomainVersion: 2,
    },
    result: {
      status: "accepted",
      handover: FIXTURE_ACCEPTED_HANDOVER,
      migration: {
        domainId: FIXTURE_IDS.domain,
        previousOwnerId: FIXTURE_IDS.primary,
        newOwnerId: FIXTURE_IDS.partner,
        futureTaskDefaultsUpdated: true,
        migratedReminderIds: [],
        auditEntryId: FIXTURE_IDS.audit,
      },
    },
  },
  DeclineHandover: {
    actor: FIXTURE_ACTORS.partner,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      reason: "当前时间安排无法接手。",
      declinedAt: FIXTURE_TIMES.confirmedTo,
      expectedVersion: 2,
    },
    result: { status: "declined", handover: FIXTURE_DECLINED_HANDOVER },
  },
  ExpireHandover: {
    actor: FIXTURE_ACTORS.handoverExpiry,
    request: {
      ...idempotentContext,
      handoverId: FIXTURE_IDS.handover,
      observedAt: FIXTURE_TIMES.expires,
      expectedVersion: 2,
    },
    result: { status: "expired", handover: FIXTURE_EXPIRED_HANDOVER },
  },
  ConfirmCareRule: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      careRuleId: FIXTURE_IDS.careRule,
      schedule: FIXTURE_CARE_SCHEDULE,
      requireAck: true,
      ackTimeoutSec: 60,
      escalationChain: FIXTURE_ESCALATION_CHAIN,
      terminalBehavior: "unresolved_after_chain",
      confirmedAt: FIXTURE_TIMES.updated,
      expectedVersion: 0,
    },
    result: { status: "active", careRule: FIXTURE_ACTIVE_CARE_RULE },
  },
  TickCareScheduler: {
    actor: FIXTURE_ACTORS.careScheduler,
    request: {
      ...idempotentContext,
      observedAt: FIXTURE_TIMES.scheduled,
      batchSize: 20,
    },
    result: {
      status: "processed",
      replayed: false,
      events: [FIXTURE_NOTIFIED_CARE_EVENT],
      notificationIntents: [
        {
          id: FIXTURE_IDS.notification,
          careEventId: FIXTURE_IDS.careEvent,
          targetMemberId: FIXTURE_IDS.subject,
          channel: "agent_dm",
          escalationLevel: 0,
          idempotencyKey: "idem_fixture_notification_0001",
          status: "pending",
        },
      ],
    },
  },
  AcknowledgeCareEvent: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...idempotentContext,
      careEventId: FIXTURE_IDS.careEvent,
      acknowledgedAt: FIXTURE_TIMES.deadline,
      expectedVersion: 1,
    },
    result: {
      status: "acknowledged",
      careEvent: FIXTURE_ACKNOWLEDGED_CARE_EVENT,
    },
  },
  HandleCareEvent: {
    actor: FIXTURE_ACTORS.partner,
    request: {
      ...idempotentContext,
      careEventId: FIXTURE_IDS.careEvent,
      resolution: "in_person_check_started",
      handledAt: FIXTURE_TIMES.handled,
      expectedVersion: 3,
    },
    result: { status: "handled", careEvent: FIXTURE_HANDLED_CARE_EVENT },
  },
  DeleteEvidence: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...idempotentContext,
      evidenceId: FIXTURE_IDS.evidence,
      expectedVersion: 0,
    },
    result: {
      status: "deleted",
      receipt: {
        evidenceId: FIXTURE_IDS.evidence,
        invalidatedSignalIds: [FIXTURE_IDS.signal],
        needsReviewTaskIds: [FIXTURE_IDS.task],
        needsReviewDomainIds: [FIXTURE_IDS.domain],
        preservedAcceptedHandoverIds: [FIXTURE_IDS.handover],
        excludedFromFutureReports: true,
        acceptedHandoversReversed: false,
        auditEntryId: FIXTURE_IDS.audit,
      },
    },
  },
  RevokeAnalysisConsent: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...idempotentContext,
      effectiveAt: FIXTURE_TIMES.updated,
      expectedMemberVersion: 0,
    },
    result: {
      status: "revoked",
      memberId: FIXTURE_IDS.subject,
      effectiveAt: FIXTURE_TIMES.updated,
      futureAnalysisEnabled: false,
      priorAuthorizedEventsPreserved: true,
      auditEntryId: FIXTURE_IDS.audit,
    },
  },
  ExportMyData: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...idempotentContext,
      format: "json",
      requestedAt: FIXTURE_TIMES.updated,
    },
    result: {
      status: "exported",
      exportId: FIXTURE_IDS.export,
      bundle: {
        generatedAt: FIXTURE_TIMES.updated,
        member: FIXTURE_MEMBERS.subject,
        privateMessages: [FIXTURE_PRIVATE_MESSAGE],
        evidence: [
          { evidence: FIXTURE_EVIDENCE, rawContent: FIXTURE_PRIVATE_MESSAGE.content },
        ],
        visibleSignals: [FIXTURE_SHARED_SIGNAL],
        visibleDomains: [FIXTURE_DOMAIN],
        visibleTasks: [FIXTURE_TASK],
        visibleHandovers: [FIXTURE_ACCEPTED_HANDOVER],
        visibleCareRules: [FIXTURE_ACTIVE_CARE_RULE],
        visibleCareEvents: [FIXTURE_NOTIFIED_CARE_EVENT],
      },
      auditEntryId: FIXTURE_IDS.audit,
    },
  },
  DeleteSpace: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...idempotentContext,
      spaceId: FIXTURE_IDS.space,
      expectedSpaceName: FIXTURE_SPACE.name,
      typedSpaceName: FIXTURE_SPACE.name,
      expectedVersion: 0,
    },
    result: {
      status: "deleted",
      deletionReceiptId: FIXTURE_IDS.deletionReceipt,
      deletedAt: FIXTURE_TIMES.updated,
      persistedAfterDeletion: false,
      containsProductContent: false,
    },
  },
  GetRoleHome: {
    actor: FIXTURE_ACTORS.primary,
    request: { ...requestContext, spaceId: FIXTURE_IDS.space },
    result: {
      status: "ready",
      home: {
        role: "primary",
        dataMode: "fixture",
        rememberedItemCount: 7,
        domainIds: [FIXTURE_IDS.domain],
        pendingHandoverIds: [FIXTURE_IDS.handover],
        needsReviewCount: 0,
      },
    },
  },
  GetPrivateConversation: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...requestContext,
      conversationId: FIXTURE_IDS.conversation,
      page: { cursor: null, limit: 20 },
    },
    result: {
      status: "ready",
      conversation: {
        conversation: FIXTURE_CONVERSATION,
        messages: [FIXTURE_PRIVATE_MESSAGE],
        page: emptyPage,
      },
    },
  },
  GetVisibleSharedSignals: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...requestContext,
      spaceId: FIXTURE_IDS.space,
      page: { cursor: null, limit: 20 },
    },
    result: {
      status: "ready",
      signals: [FIXTURE_SHARED_SIGNAL],
      page: emptyPage,
    },
  },
  GetResponsibilityReport: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...requestContext,
      spaceId: FIXTURE_IDS.space,
      period: FIXTURE_REPORT.period,
    },
    result: { status: "ready", report: FIXTURE_REPORT },
  },
  GetDomainWithEvidence: {
    actor: FIXTURE_ACTORS.primary,
    request: { ...requestContext, domainId: FIXTURE_IDS.domain },
    result: {
      status: "ready",
      domain: {
        domain: FIXTURE_DOMAIN,
        tasks: [FIXTURE_TASK],
        evidence: [{ view: "provenance", evidence: FIXTURE_PROVENANCE }],
      },
    },
  },
  GetPendingHandovers: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...requestContext,
      spaceId: FIXTURE_IDS.space,
      page: { cursor: null, limit: 20 },
    },
    result: {
      status: "ready",
      handovers: [FIXTURE_BLOCKED_HANDOVER],
      page: emptyPage,
    },
  },
  GetCareInbox: {
    actor: FIXTURE_ACTORS.subject,
    request: {
      ...requestContext,
      spaceId: FIXTURE_IDS.space,
      page: { cursor: null, limit: 20 },
    },
    result: {
      status: "ready",
      events: [FIXTURE_NOTIFIED_CARE_EVENT],
      page: emptyPage,
    },
  },
  GetAuditTrail: {
    actor: FIXTURE_ACTORS.primary,
    request: {
      ...requestContext,
      spaceId: FIXTURE_IDS.space,
      target: { type: "task", id: FIXTURE_IDS.task },
      page: { cursor: null, limit: 20 },
    },
    result: {
      status: "ready",
      entries: [FIXTURE_AUDIT_ENTRY],
      page: emptyPage,
    },
  },
} satisfies Readonly<Record<OperationName, OperationExample>>);

export const REPRESENTATIVE_ERROR_EXAMPLES = Object.freeze({
  privateEvidenceNotFound: Object.freeze({
    code: "not_found",
    requestId: FIXTURE_IDS.request,
    message: "The requested record is unavailable.",
    retryable: false,
  }),
  handoverBlocked: Object.freeze({
    code: "handover_blocked",
    requestId: FIXTURE_IDS.request,
    message: "Required handover information is incomplete.",
    retryable: false,
  }),
  idempotencyConflict: Object.freeze({
    code: "idempotency_conflict",
    requestId: FIXTURE_IDS.request,
    message: "The idempotency key was already used for another request.",
    retryable: false,
  }),
} as const);

export const NEEDS_HUMAN_REVIEW_EXAMPLE = Object.freeze({
  status: "needs_human_review",
  reason: "provider_invalid_output",
  attempts: 2,
  consequentialMutationAllowed: false,
  metadata: {
    requestId: FIXTURE_IDS.request,
    purpose: "signal_draft",
    promptVersion: "signal-draft-v1",
    attempts: 2,
    providerOutcome: "invalid_output",
    latencyMs: 1200,
    inputTokens: 0,
    outputTokens: 0,
    contentLogged: false,
  },
} as const);

export const FAIL_CLOSED_INPUT_EXAMPLES = Object.freeze({
  taskMissingResponsibilityField: {
    ...FIXTURE_TASK,
    followedUpBy: undefined,
  },
  sharedConsentWithSelfVisibility: {
    ...requestContext,
    signalDraftId: FIXTURE_IDS.signalDraft,
    decision: "share",
    visibility: subjectVisibility,
    decidedAt: FIXTURE_TIMES.updated,
    expiresAt: null,
  },
  acceptedHandoverMissingRecipientConfirmation: {
    ...FIXTURE_ACCEPTED_HANDOVER,
    toConfirmedAt: null,
  },
  unknownCareState: {
    ...FIXTURE_NOTIFIED_CARE_EVENT,
    state: "silently_completed",
  },
  requestWithUnknownAuthorityField: {
    ...OPERATION_EXAMPLES.CreatePrivateMessage.request,
    actorId: FIXTURE_IDS.primary,
  },
} as const);
