import type {
  CanonicalScenarioAction,
  CanonicalScenarioActionId,
  ExperienceSnapshot,
  HandoverConfirmation,
  HandoverView,
  ResponsibilityReport,
} from "./model";

export type FixtureScenarioStateId =
  | "consent"
  | "consent_limited"
  | "consent_private"
  | "report"
  | "blocked"
  | "awaiting_confirmations"
  | "source_confirmed"
  | "accepted";

const action = (
  id: CanonicalScenarioActionId,
  label: string,
  role: CanonicalScenarioAction["role"],
  tone: CanonicalScenarioAction["tone"] = "primary",
): CanonicalScenarioAction => Object.freeze({ id, label, role, tone });

const REPORT_ROWS = Object.freeze([
  Object.freeze({
    field: "discoveredBy",
    label: "发现问题",
    primaryCount: 3,
    partnerCount: 0,
  }),
  Object.freeze({
    field: "deadlineKeptBy",
    label: "记住截止",
    primaryCount: 3,
    partnerCount: 0,
  }),
  Object.freeze({
    field: "scheduledBy",
    label: "制定安排",
    primaryCount: 3,
    partnerCount: 0,
  }),
  Object.freeze({
    field: "executedBy",
    label: "实际执行",
    primaryCount: 2,
    partnerCount: 1,
  }),
  Object.freeze({
    field: "followedUpBy",
    label: "跟进结果",
    primaryCount: 3,
    partnerCount: 0,
  }),
] as const satisfies ResponsibilityReport["rows"]);

const createReport = (accepted: boolean): ResponsibilityReport =>
  Object.freeze({
    period: "8 月 19 日—8 月 25 日",
    rows: REPORT_ROWS,
    narrative:
      "本周家庭协调工作集中在一位成员身上。执行任务有所分担，但发现、安排与跟进尚未形成完整责任所有权。",
    evidence: "由 3 项任务的五个一等字段统计 · 仅含已同意的结构化结论",
    primaryRememberedItems: accepted ? 2 : 7,
    partnerOwnedDomains: accepted ? 2 : 1,
  });

const confirmations = (
  sourceConfirmed: boolean,
  recipientConfirmed: boolean,
): readonly HandoverConfirmation[] =>
  Object.freeze([
    Object.freeze({
      role: "primary",
      partyLabel: "家人甲 · 提出方",
      state: sourceConfirmed ? "confirmed" : "waiting",
      confirmedAt: sourceConfirmed ? "08:10" : null,
    }),
    Object.freeze({
      role: "partner",
      partyLabel: "家人乙 · 接手方",
      state: recipientConfirmed ? "confirmed" : "waiting",
      confirmedAt: recipientConfirmed ? "08:11" : null,
    }),
  ]);

const createHandover = (
  state: HandoverView["state"],
  sourceConfirmed = false,
  recipientConfirmed = false,
): HandoverView => {
  const isBlocked = state === "blocked";
  const isAccepted = state === "accepted";

  return Object.freeze({
    id: "H-021",
    domainTitle: "长辈近期复查安排",
    scope: "发现变化、记住复查时间、挂号与陪诊、保存检查结果、跟进下一次复诊。",
    nextStep: "本周内预约市三院骨科下午号，预约后把时间同步给长辈本人。",
    evidence: "5 条已同意的结构化记录 · 原始私聊仍仅本人可见",
    state,
    stateLabel: isAccepted
      ? "accepted · 已完成交接"
      : isBlocked
        ? "blocked · 信息不完整"
        : "awaiting_confirmations · 等待双方确认",
    stateDetail: isAccepted
      ? "双方确认已记录，所有权与后续提醒已一起转移。"
      : isBlocked
        ? "缺少上次检查结果；当前所有权仍属于家人甲，状态没有改变。"
        : "信息已经完整；双方各自确认前，所有权仍属于家人甲。",
    missingInformation: isBlocked ? Object.freeze(["上次检查结果"]) : Object.freeze([]),
    confirmations: confirmations(sourceConfirmed, recipientConfirmed),
    ownerLabel: isAccepted ? "当前负责人：家人乙" : "当前负责人：家人甲（未转移）",
    reminderLabel: isAccepted
      ? "后续提醒发送给家人乙；家人甲不再收到这一责任域的催办。"
      : "后续提醒仍发送给家人甲。",
  });
};

const getConsentSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "consent",
    stageTitle: "由本人决定是否分享",
    stageSummary: "一条私聊结论一次选择；默认不会进入家庭共享数据。",
    mobileRole: "subject",
    consentOutcome: null,
    report: null,
    handover: null,
    actions: Object.freeze([
      action("share_with_space", "告诉家里人", "subject"),
      action("share_with_primary", "只告诉家人甲", "subject", "secondary"),
      action("keep_private", "先别说", "subject", "secondary"),
    ]),
  });

const getConsentRecordedSnapshot = (
  revision: number,
  outcome: "limited" | "private",
): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "consent_recorded",
    stageTitle: outcome === "limited" ? "已按指定范围分享" : "已留在本人侧",
    stageSummary:
      outcome === "limited"
        ? "只有家人甲能看到这条结构化结论；其他成员不可见。"
        : "这条内容没有进入家庭共享数据，也不会计入报告。",
    mobileRole: "subject",
    consentOutcome: outcome,
    report: null,
    handover: null,
    actions: Object.freeze([action("restart_fixture", "重新开始 Fixture", "subject")]),
  });

const getReportSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "report",
    stageTitle: "五阶段责任分布",
    stageSummary: "数字只呈现分布，不评分、不排名，也不判断谁对谁错。",
    mobileRole: "primary",
    consentOutcome: "shared",
    report: createReport(false),
    handover: null,
    actions: Object.freeze([
      action("propose_handover", "准备整块责任交接", "primary"),
    ]),
  });

const getBlockedSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "blocked",
    stageTitle: "交接被信息缺口阻断",
    stageSummary: "缺少必要信息时不转移所有权，避免责任落空。",
    mobileRole: "primary",
    consentOutcome: "shared",
    report: createReport(false),
    handover: createHandover("blocked"),
    actions: Object.freeze([
      action("supply_last_check_result", "补齐上次检查结果", "primary"),
    ]),
  });

const getAwaitingSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "awaiting_confirmations",
    stageTitle: "信息已完整，等待双方确认",
    stageSummary: "补齐信息不等于完成交接；两个确认缺一不可。",
    mobileRole: "primary",
    consentOutcome: "shared",
    report: createReport(false),
    handover: createHandover("awaiting_confirmations"),
    actions: Object.freeze([
      action("confirm_handover_source", "我确认移交这一整块", "primary"),
    ]),
  });

const getSourceConfirmedSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "source_confirmed",
    stageTitle: "提出方已确认，等待接手方",
    stageSummary: "家人甲的确认已记录；所有权仍未转移。",
    mobileRole: "partner",
    consentOutcome: "shared",
    report: createReport(false),
    handover: createHandover("awaiting_confirmations", true),
    actions: Object.freeze([
      action("confirm_handover_recipient", "我确认接收这一整块", "partner"),
    ]),
  });

const getAcceptedSnapshot = (revision: number): ExperienceSnapshot =>
  Object.freeze({
    revision,
    stage: "accepted",
    stageTitle: "责任与提醒已经转移",
    stageSummary: "责任域有了新主人，原负责人可见地卸下协调工作。",
    mobileRole: "primary",
    consentOutcome: "shared",
    report: createReport(true),
    handover: createHandover("accepted", true, true),
    actions: Object.freeze([action("restart_fixture", "重新开始 Fixture", "primary")]),
  });

export const getFixtureSnapshot = (
  state: FixtureScenarioStateId,
  revision: number,
): ExperienceSnapshot => {
  switch (state) {
    case "consent":
      return getConsentSnapshot(revision);
    case "consent_limited":
      return getConsentRecordedSnapshot(revision, "limited");
    case "consent_private":
      return getConsentRecordedSnapshot(revision, "private");
    case "report":
      return getReportSnapshot(revision);
    case "blocked":
      return getBlockedSnapshot(revision);
    case "awaiting_confirmations":
      return getAwaitingSnapshot(revision);
    case "source_confirmed":
      return getSourceConfirmedSnapshot(revision);
    case "accepted":
      return getAcceptedSnapshot(revision);
  }
};

export const FIXTURE_TRANSITIONS: Readonly<
  Record<
    FixtureScenarioStateId,
    Partial<Record<CanonicalScenarioActionId, FixtureScenarioStateId>>
  >
> = Object.freeze({
  consent: Object.freeze({
    share_with_space: "report",
    share_with_primary: "consent_limited",
    keep_private: "consent_private",
  }),
  consent_limited: Object.freeze({ restart_fixture: "consent" }),
  consent_private: Object.freeze({ restart_fixture: "consent" }),
  report: Object.freeze({ propose_handover: "blocked" }),
  blocked: Object.freeze({ supply_last_check_result: "awaiting_confirmations" }),
  awaiting_confirmations: Object.freeze({ confirm_handover_source: "source_confirmed" }),
  source_confirmed: Object.freeze({ confirm_handover_recipient: "accepted" }),
  accepted: Object.freeze({ restart_fixture: "consent" }),
});
