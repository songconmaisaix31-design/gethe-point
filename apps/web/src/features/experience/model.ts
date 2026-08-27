import {
  FIXTURE_SCREENSHOT_MANIFEST,
  MemberRoleSchema,
  ScreenIdSchema,
  UIStateSchema,
  type MemberRole,
  type ScreenId,
  type UIState,
} from "./contracts";

export type ScenarioId = (typeof FIXTURE_SCREENSHOT_MANIFEST)[number]["id"];

export type HandoverVariant = "blocked" | "awaiting" | "accepted";
export type CareVariant = "notified" | "escalated" | "handled";
export type PrivacyVariant = "available" | "deleted" | "denied";

export interface ExperienceRoute {
  readonly role: MemberRole;
  readonly surface: ScreenId;
  readonly scenario: ScenarioId | null;
  readonly forcedState: UIState | null;
  readonly handoverVariant: HandoverVariant;
  readonly careVariant: CareVariant;
  readonly privacyVariant: PrivacyVariant;
}

interface ScenarioRoute {
  readonly role: MemberRole;
  readonly surface: ScreenId;
  readonly forcedState: UIState | null;
  readonly handoverVariant: HandoverVariant;
  readonly careVariant: CareVariant;
  readonly privacyVariant: PrivacyVariant;
}

export const SCENARIO_ROUTES = Object.freeze({
  "primary-home-before-handover": {
    role: "primary",
    surface: "role-home",
    forcedState: null,
    handoverVariant: "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "handover-blocked-missing-result": {
    role: "primary",
    surface: "handover",
    forcedState: null,
    handoverVariant: "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "handover-accepted-workload-release": {
    role: "primary",
    surface: "handover",
    forcedState: null,
    handoverVariant: "accepted",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "partner-pending-handover": {
    role: "partner",
    surface: "handover",
    forcedState: null,
    handoverVariant: "awaiting",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "subject-private-consent": {
    role: "subject",
    surface: "signal-consent",
    forcedState: null,
    handoverVariant: "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "subject-care-acknowledgement": {
    role: "subject",
    surface: "care-inbox",
    forcedState: null,
    handoverVariant: "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  },
  "care-escalated-and-handled": {
    role: "partner",
    surface: "care-inbox",
    forcedState: null,
    handoverVariant: "awaiting",
    careVariant: "handled",
    privacyVariant: "available",
  },
  "evidence-deleted-needs-review": {
    role: "primary",
    surface: "evidence-and-privacy",
    forcedState: "evidence_missing",
    handoverVariant: "accepted",
    careVariant: "handled",
    privacyVariant: "deleted",
  },
  "denied-private-evidence": {
    role: "partner",
    surface: "evidence-and-privacy",
    forcedState: "denied",
    handoverVariant: "awaiting",
    careVariant: "notified",
    privacyVariant: "denied",
  },
  "provider-fallback-human-review": {
    role: "primary",
    surface: "private-conversation",
    forcedState: "needs_human_review",
    handoverVariant: "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  },
} as const satisfies Readonly<Record<ScenarioId, ScenarioRoute>>);

export const ROLE_LABELS = Object.freeze({
  primary: "主要照护者",
  partner: "协作家人",
  subject: "长辈本人",
} as const satisfies Readonly<Record<MemberRole, string>>);

export const ROLE_DESCRIPTIONS = Object.freeze({
  primary: "看清仍由我记住的责任，以及哪些工作已经完整交出。",
  partner: "看清我已接住的完整责任，以及等待双方确认的交接。",
  subject: "只看我的私密对话和需要我一步确认的照护消息。",
} as const satisfies Readonly<Record<MemberRole, string>>);

export const ROLE_SURFACES = Object.freeze({
  primary: [
    "role-home",
    "private-conversation",
    "family-activity",
    "responsibility-report",
    "handover",
    "care-inbox",
    "evidence-and-privacy",
  ],
  partner: [
    "role-home",
    "private-conversation",
    "family-activity",
    "responsibility-report",
    "handover",
    "care-inbox",
    "evidence-and-privacy",
  ],
  subject: [
    "role-home",
    "private-conversation",
    "signal-consent",
    "care-inbox",
    "evidence-and-privacy",
  ],
} as const satisfies Readonly<Record<MemberRole, readonly ScreenId[]>>);

export const SURFACE_LABELS = Object.freeze({
  "role-home": "今天",
  "private-conversation": "私密对话",
  "signal-consent": "分享确认",
  "family-activity": "家庭动态",
  "responsibility-report": "责任记录",
  handover: "责任交接",
  "care-inbox": "照护收件箱",
  "evidence-and-privacy": "来源与隐私",
} as const satisfies Readonly<Record<ScreenId, string>>);

type SearchValue = string | readonly string[] | undefined;
export type ExperienceSearchParams = Readonly<Record<string, SearchValue>>;

const first = (value: SearchValue): string | undefined =>
  typeof value === "string" ? value : value?.[0];

const isScenarioId = (value: string): value is ScenarioId =>
  FIXTURE_SCREENSHOT_MANIFEST.some((scenario) => scenario.id === value);

export const resolveExperienceRoute = (
  searchParams: ExperienceSearchParams,
): ExperienceRoute => {
  const scenarioValue = first(searchParams["scenario"]);
  if (scenarioValue !== undefined && isScenarioId(scenarioValue)) {
    return {
      ...SCENARIO_ROUTES[scenarioValue],
      scenario: scenarioValue,
    };
  }

  const parsedRole = MemberRoleSchema.safeParse(first(searchParams["role"]));
  const role = parsedRole.success ? parsedRole.data : "primary";
  const parsedSurface = ScreenIdSchema.safeParse(first(searchParams["view"]));
  const candidateSurface = parsedSurface.success ? parsedSurface.data : "role-home";
  const surface = ROLE_SURFACES[role].some((item) => item === candidateSurface)
    ? candidateSurface
    : "role-home";
  const parsedState = UIStateSchema.safeParse(first(searchParams["state"]));

  return {
    role,
    surface,
    scenario: null,
    forcedState: parsedState.success ? parsedState.data : null,
    handoverVariant: role === "partner" ? "awaiting" : "blocked",
    careVariant: "notified",
    privacyVariant: "available",
  };
};

export const routeHref = (
  role: MemberRole,
  surface: ScreenId = "role-home",
): string => `/?role=${role}&view=${surface}`;
