import {
  FIXTURE_ACCEPTED_HANDOVER,
  FIXTURE_ACTORS,
  FIXTURE_AWAITING_HANDOVER,
  FIXTURE_BLOCKED_HANDOVER,
  FIXTURE_BOTH_CONFIRMED_HANDOVER,
  FIXTURE_CONSENT,
  FIXTURE_CONVERSATION,
  FIXTURE_DOMAIN,
  FIXTURE_FROM_CONFIRMED_HANDOVER,
  FIXTURE_IDS,
  FIXTURE_MEMBERS,
  FIXTURE_PRIVATE_MESSAGE,
  FIXTURE_REPORT,
  FIXTURE_SHARED_SIGNAL,
  FIXTURE_SIGNAL_DRAFT,
  FIXTURE_SPACE,
  FIXTURE_TASK,
  FIXTURE_TIMES,
  FIXTURE_TRUTH_LABELS,
  REQUIRED_VIEWPORTS,
  type MemberRole,
} from "../packages/contracts/src/index";

export const MVP_CORE_SCENARIO_ID = "mvp-core" as const;

export const MVP_CORE_ROLES = Object.freeze([
  "primary",
  "partner",
  "subject",
] as const satisfies readonly MemberRole[]);

export const MVP_CORE_STYLE_A_CSS_VARIABLES = Object.freeze({
  "--style-a-background": "#F4F1EA",
  "--style-a-surface": "#FFFFFF",
  "--style-a-text": "#1F1C17",
  "--style-a-primary": "#33513F",
  "--style-a-accent": "#8A5A3B",
  "--style-a-warning": "#9C4E22",
} as const);

const reminderId = "00000000-0000-4000-8000-000000000027";
const verticalZones = Object.freeze(["title", "content", "state", "actions"] as const);
const tabletViewport = Object.freeze({ id: "tablet", width: 1024, height: 768 } as const);

/**
 * Canonical fictional graph consumed by Fixture UI, modules, database seeders,
 * and acceptance. Consumers import values from this object rather than
 * recreating private text, IDs, ownership, copy, or visual thresholds.
 */
export const MVP_CORE_FIXTURE = Object.freeze({
  scenarioId: MVP_CORE_SCENARIO_ID,
  fixtureVersion: 3,
  roles: MVP_CORE_ROLES,
  display: Object.freeze({
    title: "晨光家庭（虚构演示）",
    fictionalNotice: "以下人物、消息、检查资料与事件均为虚构。",
    truthBadges: Object.freeze(["Fixture", "Local Demo", "Not Production Acceptance"]),
    contractTruthLabels: FIXTURE_TRUTH_LABELS,
    memberNames: Object.freeze({
      primary: `${FIXTURE_MEMBERS.primary.displayName}（虚构）`,
      partner: `${FIXTURE_MEMBERS.partner.displayName}（虚构）`,
      subject: `${FIXTURE_MEMBERS.subject.displayName}（虚构）`,
    }),
  }),
  ids: Object.freeze({
    ...FIXTURE_IDS,
    reminder: reminderId,
  }),
  actors: FIXTURE_ACTORS,
  space: FIXTURE_SPACE,
  members: Object.freeze([
    FIXTURE_MEMBERS.primary,
    FIXTURE_MEMBERS.partner,
    FIXTURE_MEMBERS.subject,
  ]),
  privateConversation: Object.freeze({
    conversation: FIXTURE_CONVERSATION,
    message: FIXTURE_PRIVATE_MESSAGE,
    derivedDraft: FIXTURE_SIGNAL_DRAFT,
    consentedSignal: FIXTURE_SHARED_SIGNAL,
    consentDecision: FIXTURE_CONSENT,
  }),
  responsibility: Object.freeze({
    domain: FIXTURE_DOMAIN,
    task: FIXTURE_TASK,
    report: FIXTURE_REPORT,
    stageOwners: Object.freeze({
      discoveredBy: FIXTURE_TASK.discoveredBy,
      deadlineKeptBy: FIXTURE_TASK.deadlineKeptBy,
      scheduledBy: FIXTURE_TASK.scheduledBy,
      executedBy: FIXTURE_TASK.executedBy,
      followedUpBy: FIXTURE_TASK.followedUpBy,
    }),
  }),
  handover: Object.freeze({
    blocked: FIXTURE_BLOCKED_HANDOVER,
    awaitingConfirmations: FIXTURE_AWAITING_HANDOVER,
    fromConfirmed: FIXTURE_FROM_CONFIRMED_HANDOVER,
    bothConfirmed: FIXTURE_BOTH_CONFIRMED_HANDOVER,
    accepted: FIXTURE_ACCEPTED_HANDOVER,
    supplyAction: Object.freeze({
      operation: "SupplyHandoverInfo",
      label: "补齐上次检查结果",
      resolvedItem: Object.freeze({
        missingInfoId: FIXTURE_IDS.missingInfo,
        value: "虚构资料：上次常规检查结果已归档，仅用于演示交接。",
        evidenceIds: Object.freeze([FIXTURE_IDS.evidence]),
      }),
    }),
  }),
  reminder: Object.freeze({
    id: reminderId,
    domainId: FIXTURE_IDS.domain,
    label: "虚构提醒：确认下次复查安排",
    scheduledFor: "2026-09-03T09:00:00+08:00",
    initialOwnerId: FIXTURE_IDS.primary,
    acceptedOwnerId: FIXTURE_IDS.partner,
    status: "active",
  }),
  eventTimeline: Object.freeze({
    createdAt: FIXTURE_TIMES.created,
    consentedAt: FIXTURE_TIMES.updated,
    fromConfirmedAt: FIXTURE_TIMES.confirmedFrom,
    toConfirmedAt: FIXTURE_TIMES.confirmedTo,
    acceptedAt: FIXTURE_TIMES.accepted,
  }),
  layoutAcceptance: Object.freeze({
    viewports: Object.freeze({
      desktop: REQUIRED_VIEWPORTS[1],
      tablet: tabletViewport,
      mobile: REQUIRED_VIEWPORTS[0],
    }),
    selectedRoleWebApp: Object.freeze({
      desktop: Object.freeze({
        sidebarVisible: true,
        selectedRoleWorkspaceCount: 1,
        workspaceWiderThanSidebar: true,
      }),
      tablet: Object.freeze({
        selectedRoleWorkspaceCount: 1,
        reflowsWithoutClipping: true,
      }),
      mobile: Object.freeze({
        persistentSidebarVisible: false,
        compactNavigationVisible: true,
        selectedRoleWorkspaceCount: 1,
        fullWidthCurrentRolePage: true,
      }),
      roleNavigationTargets: MVP_CORE_ROLES,
      deviceFramingAllowed: false,
      documentHorizontalOverflowAllowed: false,
      panelHorizontalOverflowAllowed: false,
      truthLabelEllipsisAllowed: false,
    }),
    styleA: Object.freeze({
      cssVariables: MVP_CORE_STYLE_A_CSS_VARIABLES,
      cardVerticalPaddingPx: Object.freeze({ minimum: 16, maximum: 20 }),
      compactRailMaximumWidthPx: 330,
      zoneGapPxMinimum: 8,
      zoneSpanPxMinimum: 128,
      coreCards: Object.freeze({
        consent: Object.freeze({ minimumHeightPx: 240, zones: verticalZones }),
        report: Object.freeze({ minimumHeightPx: 240, zones: verticalZones }),
        responsibility: Object.freeze({ minimumHeightPx: 260, zones: verticalZones }),
        handover: Object.freeze({ minimumHeightPx: 300, zones: verticalZones }),
      }),
    }),
  }),
} as const);

export type MvpCoreFixture = typeof MVP_CORE_FIXTURE;
