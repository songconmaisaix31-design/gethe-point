import { z } from "zod";

import { MemberRoleSchema, type MemberRole } from "./actors";

export const FIXTURE_TRUTH_LABELS = Object.freeze({
  data: "演示数据 Fixture",
  account: "用于演示流程，不是账号实况",
  authentication: "演示角色切换，不是生产身份认证",
} as const);

export const UI_TOKENS = Object.freeze({
  color: Object.freeze({
    canvas: "#FAF7F2",
    surface: "#FFFFFF",
    surfaceMuted: "#F2ECE4",
    textPrimary: "#211A13",
    textSecondary: "#51483F",
    border: "#D8CEC1",
    actionPrimary: "#5A3E2B",
    onActionPrimary: "#FFFFFF",
    focus: "#005FCC",
    infoBackground: "#EAF2FA",
    infoText: "#173B5E",
    successBackground: "#E7F3E9",
    successText: "#174A2A",
    blockedBackground: "#FFF1C7",
    blockedText: "#493500",
    errorBackground: "#FBE9E9",
    errorText: "#6B1F1F",
  }),
  typography: Object.freeze({
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    bodyPx: 16,
    bodyLineHeight: 1.6,
    headingPx: 24,
    subjectBodyPx: 20,
    subjectHeadingPx: 26,
    subjectLineHeight: 1.6,
  }),
  spacingPx: Object.freeze([4, 8, 12, 16, 24, 32, 48] as const),
  radiusPx: Object.freeze({ small: 8, medium: 12, large: 16 }),
  targetPx: Object.freeze({ defaultMinimum: 44, subjectPrimaryMinimum: 60 }),
  focus: Object.freeze({ widthPx: 3, offsetPx: 2 }),
  motionMs: Object.freeze({ fast: 120, standard: 200 }),
  reducedMotion: Object.freeze({ disableNonEssentialMotion: true }),
  shadow: Object.freeze({
    surface: "0 6px 20px rgba(55, 42, 30, 0.08)",
  }),
} as const);

export const UI_CSS_VARIABLES = Object.freeze({
  "--color-canvas": UI_TOKENS.color.canvas,
  "--color-surface": UI_TOKENS.color.surface,
  "--color-surface-muted": UI_TOKENS.color.surfaceMuted,
  "--color-text-primary": UI_TOKENS.color.textPrimary,
  "--color-text-secondary": UI_TOKENS.color.textSecondary,
  "--color-border": UI_TOKENS.color.border,
  "--color-action-primary": UI_TOKENS.color.actionPrimary,
  "--color-on-action-primary": UI_TOKENS.color.onActionPrimary,
  "--color-focus": UI_TOKENS.color.focus,
  "--color-info-background": UI_TOKENS.color.infoBackground,
  "--color-info-text": UI_TOKENS.color.infoText,
  "--color-success-background": UI_TOKENS.color.successBackground,
  "--color-success-text": UI_TOKENS.color.successText,
  "--color-blocked-background": UI_TOKENS.color.blockedBackground,
  "--color-blocked-text": UI_TOKENS.color.blockedText,
  "--color-error-background": UI_TOKENS.color.errorBackground,
  "--color-error-text": UI_TOKENS.color.errorText,
  "--font-family-body": UI_TOKENS.typography.fontFamily,
  "--shadow-surface": UI_TOKENS.shadow.surface,
} as const);

export const UIStateSchema = z.enum([
  "loading",
  "empty",
  "blocked",
  "denied",
  "error",
  "retry",
  "success",
  "needs_human_review",
  "evidence_missing",
  "unresolved",
]);
export type UIState = z.infer<typeof UIStateSchema>;

export const REQUIRED_OPERATION_UI_STATES = [
  "loading",
  "empty",
  "blocked",
  "denied",
  "error",
  "retry",
  "success",
] as const satisfies readonly UIState[];

export const UI_STATE_VOCABULARY = Object.freeze({
  loading: Object.freeze({
    heading: "正在加载",
    detail: "请稍候，不会自动提交任何操作。",
  }),
  empty: Object.freeze({
    heading: "暂无内容",
    detail: "这里还没有可显示的记录。",
  }),
  blocked: Object.freeze({
    heading: "暂时无法继续",
    detail: "信息或确认尚未完整，当前状态没有改变。",
  }),
  denied: Object.freeze({
    heading: "无法查看",
    detail: "你没有权限查看此内容。",
  }),
  error: Object.freeze({
    heading: "操作未完成",
    detail: "当前状态没有改变，请稍后重试。",
  }),
  retry: Object.freeze({ heading: "重试", detail: "再次尝试同一操作。" }),
  success: Object.freeze({ heading: "已完成", detail: "操作结果已经确认。" }),
  needs_human_review: Object.freeze({
    heading: "需要人工确认",
    detail: "AI 未能生成可靠结果，未执行后续操作。",
  }),
  evidence_missing: Object.freeze({
    heading: "证据已缺失",
    detail: "相关结论需要重新确认，暂不计入报告。",
  }),
  unresolved: Object.freeze({
    heading: "仍未解决",
    detail: "升级流程已留痕，请由家人现场确认。",
  }),
} as const satisfies Readonly<
  Record<UIState, Readonly<{ heading: string; detail: string }>>
>);

export const ViewportSchema = z.strictObject({
  id: z.enum(["mobile", "desktop"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const REQUIRED_VIEWPORTS = Object.freeze([
  Object.freeze({ id: "mobile", width: 390, height: 844 }),
  Object.freeze({ id: "desktop", width: 1440, height: 900 }),
] as const);

export const ACCESSIBILITY_CONTRACT = Object.freeze({
  standard: "WCAG 2.2 AA",
  subjectBodyContrastMinimum: 7,
  subjectBodyTextPxMinimum: 20,
  subjectHeadingPxMinimum: 26,
  subjectPrimaryTargetPxMinimum: 60,
  defaultTargetPxMinimum: 44,
  supportsSystemTextScaling: true,
  colorOnlyMeaningAllowed: false,
  visibleKeyboardFocusRequired: true,
  reducedMotionRequired: true,
  subjectPrimaryElementsMaximum: 3,
  subjectNestedNavigationAllowed: false,
  acknowledgementMaximumSteps: 1,
} as const);

export const ScreenIdSchema = z.enum([
  "role-home",
  "private-conversation",
  "signal-consent",
  "family-activity",
  "responsibility-report",
  "handover",
  "care-inbox",
  "evidence-and-privacy",
]);
export type ScreenId = z.infer<typeof ScreenIdSchema>;

export const FixedScreenContractSchema = z.strictObject({
  id: ScreenIdSchema,
  roles: z.array(MemberRoleSchema).min(1).max(3),
  requiredStates: z.array(UIStateSchema).min(7),
  primaryFact: z.string().min(1).max(240),
});
export interface FixedScreenContract {
  readonly id: ScreenId;
  readonly roles: readonly MemberRole[];
  readonly requiredStates: readonly UIState[];
  readonly primaryFact: string;
}

export const FIXED_SCREEN_CONTRACTS = Object.freeze([
  {
    id: "role-home",
    roles: ["primary", "partner", "subject"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Role-specific output with fixture and authentication truth labels.",
  },
  {
    id: "private-conversation",
    roles: ["primary", "partner", "subject"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Only the active member's private agent conversation is visible.",
  },
  {
    id: "signal-consent",
    roles: ["primary", "partner", "subject"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "No sharing choice is preselected; consent is one item at a time.",
  },
  {
    id: "family-activity",
    roles: ["primary", "partner"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Only consented structured conclusions appear; raw private text does not.",
  },
  {
    id: "responsibility-report",
    roles: ["primary", "partner"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Five-stage counts and neutral deterministic copy contain no scores or blame.",
  },
  {
    id: "handover",
    roles: ["primary", "partner"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Missing information and each confirmation are visible; blocked never moves ownership.",
  },
  {
    id: "care-inbox",
    roles: ["primary", "partner", "subject"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Subject acknowledgement comes first and escalation remains visible without diagnosis.",
  },
  {
    id: "evidence-and-privacy",
    roles: ["primary", "partner", "subject"],
    requiredStates: REQUIRED_OPERATION_UI_STATES,
    primaryFact: "Provenance, evidence deletion, analysis revocation, export, and authorized space deletion are explicit.",
  },
] as const satisfies readonly FixedScreenContract[]);

export const ScreenshotScenarioSchema = z.strictObject({
  id: z.enum([
    "primary-home-before-handover",
    "handover-blocked-missing-result",
    "handover-accepted-workload-release",
    "partner-pending-handover",
    "subject-private-consent",
    "subject-care-acknowledgement",
    "care-escalated-and-handled",
    "evidence-deleted-needs-review",
    "denied-private-evidence",
    "provider-fallback-human-review",
  ]),
  viewports: z.array(z.enum(["mobile", "desktop"])).length(2),
  requiredFacts: z.array(z.string().min(1).max(200)).min(1),
});
export interface ScreenshotScenario {
  readonly id: z.infer<typeof ScreenshotScenarioSchema>["id"];
  readonly viewports: readonly ("mobile" | "desktop")[];
  readonly requiredFacts: readonly string[];
}

export const FIXTURE_SCREENSHOT_MANIFEST = Object.freeze([
  {
    id: "primary-home-before-handover",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["fixture_labels_visible", "remembered_items_seven", "neutral_copy"],
  },
  {
    id: "handover-blocked-missing-result",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["missing_result_emphasized", "owner_unchanged", "confirmations_visible"],
  },
  {
    id: "handover-accepted-workload-release",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["new_owner_visible", "old_reminder_absent", "accepted_terminal"],
  },
  {
    id: "partner-pending-handover",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["domain_boundary_visible", "recipient_confirmation_action"],
  },
  {
    id: "subject-private-consent",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["large_text", "three_consent_choices", "no_preselected_share"],
  },
  {
    id: "subject-care-acknowledgement",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["sixty_pixel_target", "one_step", "safety_copy"],
  },
  {
    id: "care-escalated-and-handled",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["escalation_trail", "handled_or_closed_visible"],
  },
  {
    id: "evidence-deleted-needs-review",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["evidence_missing_copy", "report_exclusion", "accepted_handover_preserved"],
  },
  {
    id: "denied-private-evidence",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["non_enumerating_denial", "no_private_content"],
  },
  {
    id: "provider-fallback-human-review",
    viewports: ["mobile", "desktop"],
    requiredFacts: ["needs_human_review_copy", "no_implied_mutation"],
  },
] as const satisfies readonly ScreenshotScenario[]);

export const CONSENT_ACTION_COPY = Object.freeze({
  shareWithSpace: "告诉家里人",
  discard: "先别说",
  shareWithMembers: "只告诉指定成员",
} as const);

export const SAFETY_COPY = Object.freeze({
  medicalBoundary: "本产品不是医疗设备，不提供诊断，也不替代急救。",
  urgentAction: "如有紧急危险，请立即联系当地急救或专业机构。",
} as const);
