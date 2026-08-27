import {
  CareEventSchema,
  CareRuleSchema,
  ConsentDecisionSchema,
  ConversationSchema,
  DeleteEvidenceResultSchema,
  DomainSchema,
  EvidenceSchema,
  FIXTURE_TRUTH_LABELS,
  HandoverSchema,
  MemberActorSchema,
  MemberSchema,
  ResponsibilityReportSchema,
  SharedSignalSchema,
  SignalDraftSchema,
  SpaceSchema,
  SystemActorSchema,
  TaskSchema,
  type AuthenticationEvidence,
  type CareEvent,
  type CareRule,
  type Clock,
  type ConsentDecision,
  type Conversation,
  type DeleteEvidenceResult,
  type Domain,
  type EntityId,
  type Evidence,
  type EvidenceSourceType,
  type Handover,
  type Member,
  type MemberActor,
  type MemberRole,
  type ResponsibilityReport,
  type SharedSignal,
  type SharedSignalPurpose,
  type SharedVisibility,
  type SignalDraft,
  type Space,
  type SystemActor,
  type Task,
  type Timestamp,
} from "../../contracts/src/index";

import {
  DEFAULT_FIXTURE_INSTANT,
  DEFAULT_ID_NAMESPACE,
  createFixedClock,
  createStableIdFactory,
  timestampAt,
  type StableIdFactory,
} from "./determinism";

export const GOLDEN_FIXTURE_ID = "golden-household-v1";

export const EVIDENCE_LEVELS = [
  "raw_private",
  "provenance_only",
  "shared_redacted",
  "deleted_missing",
  "denied",
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export interface FixtureMessageFact {
  readonly id: EntityId;
  readonly conversationId: EntityId;
  readonly speakerId: EntityId;
  readonly sourceType: EvidenceSourceType;
  readonly content: string;
  readonly classification: "potential_task" | "discussion_only";
  readonly evidenceId: EntityId;
  readonly occurredAt: Timestamp;
}

interface ConsentedSignalBundle {
  readonly domainKey: DomainKey;
  readonly message: FixtureMessageFact;
  readonly evidence: Evidence;
  readonly draft: SignalDraft;
  readonly consent: ConsentDecision;
  readonly signal: SharedSignal;
}

interface DiscussionBundle {
  readonly message: FixtureMessageFact;
  readonly evidence: Evidence;
  readonly draft: SignalDraft;
}

export interface GoldenFixture {
  readonly metadata: {
    readonly fixtureId: typeof GOLDEN_FIXTURE_ID;
    readonly fixtureVersion: 1;
    readonly source: "authored_fiction";
    readonly fictional: true;
    readonly fixedInstant: string;
    readonly idNamespace: string;
    readonly labels: typeof FIXTURE_TRUTH_LABELS;
    readonly authenticationEvidenceLevels: readonly AuthenticationEvidence[];
    readonly evidenceLevels: typeof EVIDENCE_LEVELS;
    readonly prohibitedRealDataCategories: readonly string[];
  };
  readonly space: Space;
  readonly members: Readonly<Record<MemberRole, Member>>;
  readonly actors: {
    readonly members: Readonly<Record<MemberRole, MemberActor>>;
    readonly services: readonly SystemActor[];
  };
  readonly conversations: {
    readonly family: Conversation;
    readonly subjectAgent: Conversation;
  };
  readonly messages: readonly FixtureMessageFact[];
  readonly evidence: readonly Evidence[];
  readonly signalDrafts: readonly SignalDraft[];
  readonly consents: readonly ConsentDecision[];
  readonly sharedSignals: readonly SharedSignal[];
  readonly discussionOnlyMessages: readonly FixtureMessageFact[];
  readonly deniedConsent: ConsentDecision;
  readonly domains: readonly Domain[];
  readonly tasks: readonly Task[];
  readonly responsibilityReports: {
    readonly beforeDeletion: ResponsibilityReport;
    readonly afterDeletion: ResponsibilityReport;
  };
  readonly handover: {
    readonly blocked: Handover;
    readonly awaitingConfirmations: Handover;
    readonly fromConfirmed: Handover;
    readonly bothConfirmed: Handover;
    readonly accepted: Handover;
    readonly domainAfterAcceptance: Domain;
    readonly rememberedItemIdsBefore: readonly EntityId[];
    readonly rememberedItemIdsAfter: readonly EntityId[];
    readonly removedReminderIds: readonly EntityId[];
  };
  readonly care: {
    readonly rule: CareRule;
    readonly notified: CareEvent;
    readonly acknowledged: CareEvent;
    readonly timedOut: CareEvent;
    readonly escalated: CareEvent;
    readonly handled: CareEvent;
  };
  readonly deletion: {
    readonly evidenceBefore: Evidence;
    readonly evidenceAfter: Evidence;
    readonly signalAfter: SharedSignal;
    readonly taskAfter: Task;
    readonly domainAfter: Domain;
    readonly result: DeleteEvidenceResult;
  };
}

export interface GoldenFixtureOptions {
  readonly clock?: Clock;
  readonly idFactory?: StableIdFactory;
  readonly idNamespace?: string;
}

type DomainKey = "review" | "supplies" | "meals";

interface SignalTemplate {
  readonly key: string;
  readonly domainKey: DomainKey;
  readonly speaker: MemberRole;
  readonly sourceType: EvidenceSourceType;
  readonly content: string;
  readonly redactedExcerpt: string;
  readonly conclusion: string;
  readonly purpose: SharedSignalPurpose;
}

const CONSENTED_SIGNAL_TEMPLATES = [
  {
    key: "review-request",
    domainKey: "review",
    speaker: "subject",
    sourceType: "agent_dm",
    content: "今天走路有些不舒服，想请家里人一起确认复查安排。",
    redactedExcerpt: "长辈希望家人确认近期复查安排。",
    conclusion: "需要确认近期复查的时间与陪同安排。",
    purpose: "care_information",
  },
  {
    key: "review-result",
    domainKey: "review",
    speaker: "primary",
    sourceType: "family_group",
    content: "上次的检查结果还放在文件夹里，预约前需要整理。",
    redactedExcerpt: "预约前需要整理既有检查信息。",
    conclusion: "预约前需要补齐并核对既有检查信息。",
    purpose: "responsibility",
  },
  {
    key: "review-transport",
    domainKey: "review",
    speaker: "partner",
    sourceType: "family_group",
    content: "复查当天我可以负责往返安排，但需要先确认时间。",
    redactedExcerpt: "家人可在时间确认后负责往返安排。",
    conclusion: "时间确认后由家人乙负责往返安排。",
    purpose: "responsibility",
  },
  {
    key: "supplies-list",
    domainKey: "supplies",
    speaker: "primary",
    sourceType: "family_group",
    content: "本周常用物品需要先盘点，再统一补充。",
    redactedExcerpt: "本周需要盘点常用物品。",
    conclusion: "完成常用物品盘点并形成补充清单。",
    purpose: "responsibility",
  },
  {
    key: "supplies-order",
    domainKey: "supplies",
    speaker: "partner",
    sourceType: "family_group",
    content: "清单确认后我来安排补充，并记录到货情况。",
    redactedExcerpt: "家人将在清单确认后安排补充。",
    conclusion: "清单确认后由家人乙安排补充并跟进。",
    purpose: "responsibility",
  },
  {
    key: "meals-plan",
    domainKey: "meals",
    speaker: "subject",
    sourceType: "agent_dm",
    content: "这周想吃得清淡一些，也想提前知道每天的安排。",
    redactedExcerpt: "长辈希望本周安排更清淡并提前确认。",
    conclusion: "提前确认本周清淡餐食安排。",
    purpose: "family_information",
  },
  {
    key: "meals-shopping",
    domainKey: "meals",
    speaker: "primary",
    sourceType: "family_group",
    content: "菜单确认后我会整理需要准备的食材。",
    redactedExcerpt: "菜单确认后需要整理准备清单。",
    conclusion: "菜单确认后由家人甲整理准备清单。",
    purpose: "responsibility",
  },
  {
    key: "meals-follow-up",
    domainKey: "meals",
    speaker: "partner",
    sourceType: "family_group",
    content: "晚饭后我来确认第二天的安排有没有变化。",
    redactedExcerpt: "家人将确认次日安排是否变化。",
    conclusion: "由家人乙在晚饭后跟进次日安排。",
    purpose: "responsibility",
  },
] as const satisfies readonly SignalTemplate[];

const DISCUSSION_ONLY_TEMPLATES = [
  {
    key: "movie-chat",
    speaker: "primary",
    content: "周末如果天气合适，也许可以一起看一部电影。",
    conclusion: "这是一项开放讨论，不应建立任务。",
  },
  {
    key: "cup-chat",
    speaker: "partner",
    content: "刚看到一套颜色很好看的杯子，只是随口分享。",
    conclusion: "这是一项随口分享，不应建立任务。",
  },
] as const;

const DOMAIN_TEMPLATES = [
  {
    key: "review",
    name: "近期复查协调",
    owner: "primary",
    nextAction: "补齐既有检查信息并确认时间",
  },
  {
    key: "supplies",
    name: "家庭物品补充",
    owner: "partner",
    nextAction: "完成盘点并确认补充清单",
  },
  {
    key: "meals",
    name: "本周餐食安排",
    owner: "primary",
    nextAction: "确认菜单与准备清单",
  },
] as const satisfies readonly {
  readonly key: DomainKey;
  readonly name: string;
  readonly owner: MemberRole;
  readonly nextAction: string;
}[];

const TASK_TEMPLATES = [
  { key: "review-time", domainKey: "review", signalIndex: 0, title: "确认复查时间" },
  { key: "review-result", domainKey: "review", signalIndex: 1, title: "整理既有检查信息" },
  { key: "review-transport", domainKey: "review", signalIndex: 2, title: "确认往返安排" },
  { key: "supplies-list", domainKey: "supplies", signalIndex: 3, title: "完成常用物品盘点" },
  { key: "supplies-order", domainKey: "supplies", signalIndex: 4, title: "安排物品补充" },
  { key: "meals-plan", domainKey: "meals", signalIndex: 5, title: "确认本周菜单" },
  { key: "meals-follow-up", domainKey: "meals", signalIndex: 7, title: "跟进次日安排" },
] as const;

const requireValue = <Value>(
  value: Value | undefined,
  description: string,
): Value => {
  if (value === undefined) {
    throw new Error(`Golden fixture is missing ${description}.`);
  }

  return value;
};

export const createGoldenFixture = (
  options: GoldenFixtureOptions = {},
): GoldenFixture => {
  const clock = options.clock ?? createFixedClock(DEFAULT_FIXTURE_INSTANT);
  const idNamespace = options.idNamespace ?? DEFAULT_ID_NAMESPACE;
  const ids = options.idFactory ?? createStableIdFactory(idNamespace);
  const spaceId = ids.forKey("space");
  const createdAt = timestampAt(clock);
  const updatedAt = timestampAt(clock, 5 * 60);
  const acceptedAt = timestampAt(clock, 12 * 60);
  const expiresAt = timestampAt(clock, 24 * 60 * 60);
  const reportEnd = timestampAt(clock, 7 * 24 * 60 * 60);

  const record = (
    key: string,
    version = 0,
    recordUpdatedAt = updatedAt,
  ) => ({
    id: ids.forKey(key),
    spaceId,
    createdAt,
    updatedAt: recordUpdatedAt,
    version,
  });

  const space = SpaceSchema.parse({
    ...record("space"),
    name: "虚构家庭甲",
    createdBy: ids.forKey("member:primary"),
    status: "active",
  });

  const members = Object.freeze({
    primary: MemberSchema.parse({
      ...record("member:primary"),
      role: "primary",
      displayName: "家人甲",
      status: "active",
      joinedAt: createdAt,
      analysisConsent: "enabled",
    }),
    partner: MemberSchema.parse({
      ...record("member:partner"),
      role: "partner",
      displayName: "家人乙",
      status: "active",
      joinedAt: createdAt,
      analysisConsent: "enabled",
    }),
    subject: MemberSchema.parse({
      ...record("member:subject"),
      role: "subject",
      displayName: "长辈甲",
      status: "active",
      joinedAt: createdAt,
      analysisConsent: "enabled",
    }),
  } satisfies Record<MemberRole, Member>);

  const memberActors = Object.freeze({
    primary: MemberActorSchema.parse({
      kind: "member",
      memberId: members.primary.id,
      spaceId,
      role: "primary",
      authentication: "fixture_demo",
    }),
    partner: MemberActorSchema.parse({
      kind: "member",
      memberId: members.partner.id,
      spaceId,
      role: "partner",
      authentication: "fixture_demo",
    }),
    subject: MemberActorSchema.parse({
      kind: "member",
      memberId: members.subject.id,
      spaceId,
      role: "subject",
      authentication: "fixture_demo",
    }),
  } satisfies Record<MemberRole, MemberActor>);

  const services = Object.freeze(
    ([
      "handover_service",
      "handover_expiry_service",
      "care_scheduler",
      "privacy_service",
    ] as const).map((service) =>
      SystemActorSchema.parse({
        kind: "system",
        service,
        spaceId,
        authentication: "internal_service",
      }),
    ),
  );

  const conversations = Object.freeze({
    family: ConversationSchema.parse({
      ...record("conversation:family"),
      type: "family_group",
      participantMemberIds: [members.primary.id, members.partner.id, members.subject.id],
    }),
    subjectAgent: ConversationSchema.parse({
      ...record("conversation:subject-agent"),
      type: "agent_dm",
      participantMemberIds: [members.subject.id],
    }),
  });

  const domainIds = Object.freeze({
    review: ids.forKey("domain:review"),
    supplies: ids.forKey("domain:supplies"),
    meals: ids.forKey("domain:meals"),
  } satisfies Record<DomainKey, EntityId>);

  const sharedVisibility = (
    template: SignalTemplate,
  ): SharedVisibility =>
    template.purpose === "care_information"
      ? {
          kind: "care_related",
          subjectId: members.subject.id,
          memberIds: [members.subject.id, members.primary.id, members.partner.id],
        }
      : { kind: "space" };

  const consentedBundles: readonly ConsentedSignalBundle[] =
    CONSENTED_SIGNAL_TEMPLATES.map((template, index) => {
      const messageId = ids.forKey(`message:${template.key}`);
      const evidenceId = ids.forKey(`evidence:${template.key}`);
      const speaker = members[template.speaker];
      const occurredAt = timestampAt(clock, index * 60);
      const visibility = sharedVisibility(template);
      const message: FixtureMessageFact = Object.freeze({
        id: messageId,
        conversationId:
          template.sourceType === "agent_dm"
            ? conversations.subjectAgent.id
            : conversations.family.id,
        speakerId: speaker.id,
        sourceType: template.sourceType,
        content: template.content,
        classification: "potential_task",
        evidenceId,
        occurredAt,
      });
      const evidence = EvidenceSchema.parse({
        ...record(`evidence:${template.key}`),
        sourceType: template.sourceType,
        speakerId: speaker.id,
        occurredAt,
        rawRef: `fixture://golden-household/${template.key}`,
        visibility: { kind: "self", memberId: speaker.id },
        state: "available",
      });
      const draft = SignalDraftSchema.parse({
        ...record(`draft:${template.key}`),
        speakerId: speaker.id,
        sourceMessageId: messageId,
        evidenceIds: [evidenceId],
        kind: "potential_task",
        redactedExcerpt: template.redactedExcerpt,
        proposedConclusion: template.conclusion,
        candidateDomainId: domainIds[template.domainKey],
        confidence: 0.9,
        missingInfo: [],
        promptVersion: "golden-signal-draft-v1",
        source: "fixture",
      });
      const consent = ConsentDecisionSchema.parse({
        ...record(`consent:${template.key}`),
        signalDraftId: draft.id,
        speakerId: speaker.id,
        decidedAt: updatedAt,
        recordState: "active",
        outcome: "share",
        visibility,
        expiresAt: null,
        revokedAt: null,
      });
      const signal = SharedSignalSchema.parse({
        ...record(`signal:${template.key}`),
        speakerId: speaker.id,
        consentDecisionId: consent.id,
        redactedExcerpt: template.redactedExcerpt,
        conclusion: template.conclusion,
        purpose: template.purpose,
        visibility,
        provenance: [
          {
            evidenceId,
            sourceType: template.sourceType,
            speakerId: speaker.id,
            occurredAt,
            state: "available",
          },
        ],
        evidenceState: "available",
      });

      return Object.freeze({
        domainKey: template.domainKey,
        message,
        evidence,
        draft,
        consent,
        signal,
      });
    });

  const discussionBundles: readonly DiscussionBundle[] =
    DISCUSSION_ONLY_TEMPLATES.map((template, index) => {
      const speaker = members[template.speaker];
      const messageId = ids.forKey(`message:${template.key}`);
      const evidenceId = ids.forKey(`evidence:${template.key}`);
      const occurredAt = timestampAt(
        clock,
        (CONSENTED_SIGNAL_TEMPLATES.length + index) * 60,
      );
      const message: FixtureMessageFact = Object.freeze({
        id: messageId,
        conversationId: conversations.family.id,
        speakerId: speaker.id,
        sourceType: "family_group",
        content: template.content,
        classification: "discussion_only",
        evidenceId,
        occurredAt,
      });
      const evidence = EvidenceSchema.parse({
        ...record(`evidence:${template.key}`),
        sourceType: "family_group",
        speakerId: speaker.id,
        occurredAt,
        rawRef: `fixture://golden-household/${template.key}`,
        visibility: { kind: "self", memberId: speaker.id },
        state: "available",
      });
      const draft = SignalDraftSchema.parse({
        ...record(`draft:${template.key}`),
        speakerId: speaker.id,
        sourceMessageId: messageId,
        evidenceIds: [evidenceId],
        kind: "discussion_only",
        redactedExcerpt: "仅讨论，不形成家庭任务。",
        proposedConclusion: template.conclusion,
        candidateDomainId: null,
        confidence: 0.98,
        missingInfo: [],
        promptVersion: "golden-signal-draft-v1",
        source: "fixture",
      });

      return Object.freeze({ message, evidence, draft });
    });

  const deniedSpeaker = members.subject;
  const deniedMessageId = ids.forKey("message:denied-album");
  const deniedEvidenceId = ids.forKey("evidence:denied-album");
  const deniedOccurredAt = timestampAt(clock, 10 * 60);
  const deniedMessage: FixtureMessageFact = Object.freeze({
    id: deniedMessageId,
    conversationId: conversations.subjectAgent.id,
    speakerId: deniedSpeaker.id,
    sourceType: "agent_dm",
    content: "旧相册我想先自己整理，这件事先别告诉其他人。",
    classification: "potential_task",
    evidenceId: deniedEvidenceId,
    occurredAt: deniedOccurredAt,
  });
  const deniedEvidence = EvidenceSchema.parse({
    ...record("evidence:denied-album"),
    sourceType: "agent_dm",
    speakerId: deniedSpeaker.id,
    occurredAt: deniedOccurredAt,
    rawRef: "fixture://golden-household/denied-album",
    visibility: { kind: "self", memberId: deniedSpeaker.id },
    state: "available",
  });
  const deniedDraft = SignalDraftSchema.parse({
    ...record("draft:denied-album"),
    speakerId: deniedSpeaker.id,
    sourceMessageId: deniedMessageId,
    evidenceIds: [deniedEvidenceId],
    kind: "potential_task",
    redactedExcerpt: "长辈提到一项个人整理事项。",
    proposedConclusion: "是否共享个人整理事项由说话者决定。",
    candidateDomainId: null,
    confidence: 0.88,
    missingInfo: [],
    promptVersion: "golden-signal-draft-v1",
    source: "fixture",
  });
  const deniedConsent = ConsentDecisionSchema.parse({
    ...record("consent:denied-album"),
    signalDraftId: deniedDraft.id,
    speakerId: deniedSpeaker.id,
    decidedAt: updatedAt,
    recordState: "discarded",
    outcome: "discard",
    visibility: null,
    expiresAt: null,
    revokedAt: null,
  });

  const domains = DOMAIN_TEMPLATES.map((template) =>
    DomainSchema.parse({
      ...record(`domain:${template.key}`, 1),
      name: template.name,
      ownerId: members[template.owner].id,
      status: "active",
      nextAction: template.nextAction,
      visibility: { kind: "space" },
      evidenceIds: consentedBundles
        .filter((bundle) => bundle.domainKey === template.key)
        .map((bundle) => bundle.evidence.id),
    }),
  );

  const tasks = TASK_TEMPLATES.map((template, index) => {
    const bundle = requireValue(
      consentedBundles[template.signalIndex],
      `consented signal ${String(template.signalIndex)}`,
    );

    return TaskSchema.parse({
      ...record(`task:${template.key}`, 1),
      domainId: domainIds[template.domainKey],
      title: template.title,
      dueAt: timestampAt(clock, (index + 1) * 24 * 60 * 60),
      status: "open",
      reviewState: "current",
      visibility: { kind: "space" },
      evidenceIds: [bundle.evidence.id],
      discoveredBy: bundle.message.speakerId,
      deadlineKeptBy: members.primary.id,
      scheduledBy: members.primary.id,
      executedBy: index % 2 === 0 ? members.partner.id : members.primary.id,
      followedUpBy: members.primary.id,
    });
  });

  const reviewDomain = requireValue(
    domains.find((domain) => domain.id === domainIds.review),
    "review domain",
  );
  const handoverEvidence = requireValue(
    consentedBundles[0],
    "handover evidence",
  ).evidence;
  const handoverBase = {
    ...record("handover:review", 1),
    domainId: reviewDomain.id,
    fromMemberId: members.primary.id,
    toMemberId: members.partner.id,
    packet: {
      scope: "负责本次复查预约、往返安排与结果跟进。",
      history: ["已确认需要安排近期复查。"],
      constraints: ["时间需要与长辈再次确认。"],
      contacts: [{ label: "虚构服务台", redactedValue: "fixture-contact" }],
      knownInformation: ["当前责任域由家人甲负责。"],
      nextAction: "补齐既有检查信息。",
      evidenceIds: [handoverEvidence.id],
    },
    expiresAt,
  };
  const blockedHandover = HandoverSchema.parse({
    ...handoverBase,
    status: "blocked",
    missingInfo: [
      {
        id: ids.forKey("handover:missing-info"),
        label: "既有检查信息",
        reason: "接手人需要完整信息才能继续安排。",
      },
    ],
    fromConfirmedAt: null,
    toConfirmedAt: null,
    acceptedAt: null,
    terminalAt: null,
    declinedBy: null,
    declineReason: null,
  });
  const awaitingHandover = HandoverSchema.parse({
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
  });
  const fromConfirmedHandover = HandoverSchema.parse({
    ...awaitingHandover,
    version: 3,
    fromConfirmedAt: timestampAt(clock, 10 * 60),
  });
  const bothConfirmedHandover = HandoverSchema.parse({
    ...fromConfirmedHandover,
    version: 4,
    toConfirmedAt: timestampAt(clock, 11 * 60),
  });
  const acceptedHandover = HandoverSchema.parse({
    ...handoverBase,
    version: 5,
    status: "accepted",
    missingInfo: [],
    fromConfirmedAt: timestampAt(clock, 10 * 60),
    toConfirmedAt: timestampAt(clock, 11 * 60),
    acceptedAt,
    terminalAt: acceptedAt,
    declinedBy: null,
    declineReason: null,
  });
  const domainAfterAcceptance = DomainSchema.parse({
    ...reviewDomain,
    ownerId: members.partner.id,
    version: reviewDomain.version + 1,
    updatedAt: acceptedAt,
  });
  const rememberedItemIdsBefore = tasks.map((task) => task.id);
  const rememberedItemIdsAfter = rememberedItemIdsBefore.slice(-2);
  const removedReminderIds = rememberedItemIdsBefore.slice(0, 5);

  const careEvidence = requireValue(
    consentedBundles[0],
    "care evidence",
  ).evidence;
  const careRule = CareRuleSchema.parse({
    ...record("care-rule:evening", 1),
    subjectId: members.subject.id,
    title: "晚间确认",
    schedule: { kind: "daily", timezone: "Asia/Shanghai", times: ["20:00"] },
    requireAck: true,
    ackTimeoutSec: 60,
    escalationChain: [
      {
        level: 1,
        delaySec: 60,
        targetMemberIds: [members.primary.id, members.partner.id],
        action: "notify",
      },
    ],
    primaryCaregiverId: members.partner.id,
    createdFromEvidenceId: careEvidence.id,
    terminalBehavior: "close_on_handle",
    status: "active",
    confirmedBy: members.primary.id,
    confirmedAt: updatedAt,
  });
  const scheduledFor = timestampAt(clock, 12 * 60 * 60);
  const acknowledgementDeadline = timestampAt(clock, 12 * 60 * 60 + 60);
  const careEventBase = {
    ...record("care-event:evening", 1),
    careRuleId: careRule.id,
    subjectId: members.subject.id,
    occurrenceKey: "golden-evening:2026-08-27",
    scheduledFor,
    acknowledgementDeadline,
    notificationIntentIds: [ids.forKey("notification:subject")],
  };
  const notifiedCareEvent = CareEventSchema.parse({
    ...careEventBase,
    state: "notified",
    notifiedAt: scheduledFor,
    acknowledgedAt: null,
    timedOutAt: null,
    escalationLevel: 0,
    escalatedAt: null,
    handledAt: null,
    closedAt: null,
    unresolvedAt: null,
  });
  const acknowledgedCareEvent = CareEventSchema.parse({
    ...notifiedCareEvent,
    version: 2,
    state: "acknowledged",
    acknowledgedAt: timestampAt(clock, 12 * 60 * 60 + 30),
  });
  const timedOutCareEvent = CareEventSchema.parse({
    ...notifiedCareEvent,
    version: 2,
    state: "timed_out",
    timedOutAt: acknowledgementDeadline,
  });
  const escalatedAt = timestampAt(clock, 12 * 60 * 60 + 120);
  const escalatedCareEvent = CareEventSchema.parse({
    ...notifiedCareEvent,
    version: 3,
    state: "escalated",
    timedOutAt: acknowledgementDeadline,
    escalationLevel: 1,
    escalatedAt,
  });
  const handledCareEvent = CareEventSchema.parse({
    ...escalatedCareEvent,
    version: 4,
    state: "handled",
    handledAt: timestampAt(clock, 12 * 60 * 60 + 180),
  });

  const reportRows = [
    { stage: "discoveredBy", counts: [{ memberId: members.subject.id, count: 3 }] },
    { stage: "deadlineKeptBy", counts: [{ memberId: members.primary.id, count: 7 }] },
    { stage: "scheduledBy", counts: [{ memberId: members.primary.id, count: 7 }] },
    {
      stage: "executedBy",
      counts: [
        { memberId: members.primary.id, count: 3 },
        { memberId: members.partner.id, count: 4 },
      ],
    },
    { stage: "followedUpBy", counts: [{ memberId: members.primary.id, count: 7 }] },
  ] as const;
  const reportBeforeDeletion = ResponsibilityReportSchema.parse({
    spaceId,
    period: { startAt: createdAt, endAt: reportEnd },
    generatedAt: reportEnd,
    rows: reportRows,
    unownedDomainCount: 0,
    excludedNeedsReviewCount: 0,
    narrative: "本周协调记录主要集中在家人甲，具体执行已有家人共同参与。",
    source: "deterministic_template",
  });
  const reportAfterDeletion = ResponsibilityReportSchema.parse({
    ...reportBeforeDeletion,
    excludedNeedsReviewCount: 1,
    narrative: "一项记录因证据缺失暂不计入，本周其余协调事实保持中性展示。",
  });

  const deletionBundle = requireValue(
    consentedBundles[0],
    "deletion signal",
  );
  const deletionTask = requireValue(tasks[0], "deletion task");
  const deletionAt = timestampAt(clock, 13 * 60 * 60);
  const evidenceAfterDeletion = EvidenceSchema.parse({
    ...deletionBundle.evidence,
    state: "deleted",
    version: deletionBundle.evidence.version + 1,
    updatedAt: deletionAt,
  });
  const signalAfterDeletion = SharedSignalSchema.parse({
    ...deletionBundle.signal,
    evidenceState: "evidence_missing",
    provenance: deletionBundle.signal.provenance.map((item) => ({
      ...item,
      state: "deleted",
    })),
    version: deletionBundle.signal.version + 1,
    updatedAt: deletionAt,
  });
  const taskAfterDeletion = TaskSchema.parse({
    ...deletionTask,
    reviewState: "needs_review",
    version: deletionTask.version + 1,
    updatedAt: deletionAt,
  });
  const domainAfterDeletion = DomainSchema.parse({
    ...reviewDomain,
    status: "needs_review",
    version: reviewDomain.version + 1,
    updatedAt: deletionAt,
  });
  const deletionResult = DeleteEvidenceResultSchema.parse({
    status: "deleted",
    receipt: {
      evidenceId: deletionBundle.evidence.id,
      invalidatedSignalIds: [deletionBundle.signal.id],
      needsReviewTaskIds: [deletionTask.id],
      needsReviewDomainIds: [reviewDomain.id],
      preservedAcceptedHandoverIds: [acceptedHandover.id],
      excludedFromFutureReports: true,
      acceptedHandoversReversed: false,
      auditEntryId: ids.forKey("audit:evidence-deleted"),
    },
  });

  return Object.freeze({
    metadata: Object.freeze({
      fixtureId: GOLDEN_FIXTURE_ID,
      fixtureVersion: 1,
      source: "authored_fiction",
      fictional: true,
      fixedInstant: clock.now().toISOString(),
      idNamespace,
      labels: FIXTURE_TRUTH_LABELS,
      authenticationEvidenceLevels: [
        "fixture_demo",
        "verified_session",
      ] as const,
      evidenceLevels: EVIDENCE_LEVELS,
      prohibitedRealDataCategories: [],
    }),
    space,
    members,
    actors: Object.freeze({ members: memberActors, services }),
    conversations,
    messages: Object.freeze([
      ...consentedBundles.map((bundle) => bundle.message),
      ...discussionBundles.map((bundle) => bundle.message),
      deniedMessage,
    ]),
    evidence: Object.freeze([
      ...consentedBundles.map((bundle) => bundle.evidence),
      ...discussionBundles.map((bundle) => bundle.evidence),
      deniedEvidence,
    ]),
    signalDrafts: Object.freeze([
      ...consentedBundles.map((bundle) => bundle.draft),
      ...discussionBundles.map((bundle) => bundle.draft),
      deniedDraft,
    ]),
    consents: Object.freeze([
      ...consentedBundles.map((bundle) => bundle.consent),
      deniedConsent,
    ]),
    sharedSignals: Object.freeze(
      consentedBundles.map((bundle) => bundle.signal),
    ),
    discussionOnlyMessages: Object.freeze(
      discussionBundles.map((bundle) => bundle.message),
    ),
    deniedConsent,
    domains: Object.freeze(domains),
    tasks: Object.freeze(tasks),
    responsibilityReports: Object.freeze({
      beforeDeletion: reportBeforeDeletion,
      afterDeletion: reportAfterDeletion,
    }),
    handover: Object.freeze({
      blocked: blockedHandover,
      awaitingConfirmations: awaitingHandover,
      fromConfirmed: fromConfirmedHandover,
      bothConfirmed: bothConfirmedHandover,
      accepted: acceptedHandover,
      domainAfterAcceptance,
      rememberedItemIdsBefore: Object.freeze(rememberedItemIdsBefore),
      rememberedItemIdsAfter: Object.freeze(rememberedItemIdsAfter),
      removedReminderIds: Object.freeze(removedReminderIds),
    }),
    care: Object.freeze({
      rule: careRule,
      notified: notifiedCareEvent,
      acknowledged: acknowledgedCareEvent,
      timedOut: timedOutCareEvent,
      escalated: escalatedCareEvent,
      handled: handledCareEvent,
    }),
    deletion: Object.freeze({
      evidenceBefore: deletionBundle.evidence,
      evidenceAfter: evidenceAfterDeletion,
      signalAfter: signalAfterDeletion,
      taskAfter: taskAfterDeletion,
      domainAfter: domainAfterDeletion,
      result: deletionResult,
    }),
  });
};
