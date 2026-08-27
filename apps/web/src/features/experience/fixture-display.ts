import { z } from "zod";

import { MvpCoreReportSchema } from "./wire-contract";

const DisplayProjectionSchema = z.strictObject({
  title: z.string().min(1),
  fictionalNotice: z.string().min(1),
  truthBadges: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  contractTruthLabels: z.strictObject({
    data: z.string().min(1),
    account: z.string().min(1),
    authentication: z.string().min(1),
  }),
  memberNames: z.strictObject({
    primary: z.string().min(1),
    partner: z.string().min(1),
    subject: z.string().min(1),
  }),
  memberIds: z.strictObject({
    primary: z.uuid(),
    partner: z.uuid(),
    subject: z.uuid(),
  }),
  privateMessage: z.string().min(1),
  sharedConclusion: z.string().min(1),
  domain: z.strictObject({
    name: z.string().min(1),
    taskTitle: z.string().min(1),
    nextAction: z.string().min(1),
    scope: z.string().min(1),
  }),
  handover: z.strictObject({
    missingLabel: z.string().min(1),
    missingReason: z.string().min(1),
  }),
  reminder: z.strictObject({
    label: z.string().min(1),
  }),
});

/**
 * Exact, narrow display projection of the accepted QA-002 Fixture graph.
 * The state endpoint intentionally omits these display strings and private text.
 */
export const MVP_CORE_DISPLAY = DisplayProjectionSchema.parse({
  title: "晨光家庭（虚构演示）",
  fictionalNotice: "以下人物、消息、检查资料与事件均为虚构。",
  truthBadges: ["Fixture", "Local Demo", "Not Production Acceptance"],
  contractTruthLabels: {
    data: "演示数据 Fixture",
    account: "用于演示流程，不是账号实况",
    authentication: "演示角色切换，不是生产身份认证",
  },
  memberNames: {
    primary: "家人甲（虚构）",
    partner: "家人乙（虚构）",
    subject: "长辈甲（虚构）",
  },
  memberIds: {
    primary: "00000000-0000-4000-8000-000000000002",
    partner: "00000000-0000-4000-8000-000000000003",
    subject: "00000000-0000-4000-8000-000000000004",
  },
  privateMessage: "明天下午想请家人一起确认复查安排。",
  sharedConclusion: "需要确认近期复查的时间与陪同安排。",
  domain: {
    name: "近期复查安排",
    taskTitle: "确认复查时间",
    nextAction: "补齐上次检查结果并确认时间",
    scope: "负责本次复查预约、陪同与结果跟进。",
  },
  handover: {
    missingLabel: "上次检查结果",
    missingReason: "接手人需要这项信息才能继续安排。",
  },
  reminder: {
    label: "虚构提醒：确认下次复查安排",
  },
});

export const MVP_CORE_CANONICAL_REPORT = MvpCoreReportSchema.parse({
  spaceId: "00000000-0000-4000-8000-000000000001",
  period: {
    startAt: "2026-08-27T08:00:00+08:00",
    endAt: "2026-08-28T00:00:00+08:00",
  },
  generatedAt: "2026-08-28T00:00:00+08:00",
  rows: [
    {
      stage: "discoveredBy",
      counts: [{ memberId: "00000000-0000-4000-8000-000000000004", count: 1 }],
    },
    {
      stage: "deadlineKeptBy",
      counts: [{ memberId: "00000000-0000-4000-8000-000000000002", count: 1 }],
    },
    {
      stage: "scheduledBy",
      counts: [{ memberId: "00000000-0000-4000-8000-000000000002", count: 1 }],
    },
    {
      stage: "executedBy",
      counts: [{ memberId: "00000000-0000-4000-8000-000000000003", count: 1 }],
    },
    {
      stage: "followedUpBy",
      counts: [{ memberId: "00000000-0000-4000-8000-000000000002", count: 1 }],
    },
  ],
  unownedDomainCount: 0,
  excludedNeedsReviewCount: 0,
  narrative: "本周家庭协调工作集中在一位成员身上，执行已有分担，责任交接仍需完整确认。",
  source: "deterministic_template",
});

export const MVP_CORE_TEST_IDS = Object.freeze({
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
    consent: Object.freeze({
      root: "mvp-core-consent-card",
      title: "mvp-core-consent-title",
      content: "mvp-core-consent-content",
      state: "mvp-core-consent-state",
      actions: "mvp-core-consent-actions",
    }),
    report: Object.freeze({
      root: "mvp-core-report-card",
      title: "mvp-core-report-title",
      content: "mvp-core-report-content",
      state: "mvp-core-report-state",
      actions: "mvp-core-report-actions",
    }),
    responsibility: Object.freeze({
      root: "mvp-core-responsibility-card",
      title: "mvp-core-responsibility-title",
      content: "mvp-core-responsibility-content",
      state: "mvp-core-responsibility-state",
      actions: "mvp-core-responsibility-actions",
    }),
    handover: Object.freeze({
      root: "mvp-core-handover-card",
      title: "mvp-core-handover-title",
      content: "mvp-core-handover-content",
      state: "mvp-core-handover-state",
      actions: "mvp-core-handover-actions",
    }),
  }),
});

export const MVP_CORE_PATHS = Object.freeze({
  page: "/fixtures/mvp-core",
  state: "/api/fixtures/mvp-core/state",
  commands: "/api/fixtures/mvp-core/commands",
  reset: "/api/fixtures/mvp-core/reset",
});
