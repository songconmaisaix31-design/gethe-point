import { MVP_CORE_DISPLAY, MVP_CORE_TEST_IDS } from "../features/experience/fixture-display";
import type {
  ExperienceActionId,
  ExperienceSnapshot,
  MemberRole,
} from "../features/experience/model";
import {
  ConsentCard,
  HandoverCard,
  PartnerConfirmationPanel,
  ReportCard,
  ResponsibilityCard,
} from "./CoreCards";

const ROLE_COPY = Object.freeze({
  primary: Object.freeze({
    name: MVP_CORE_DISPLAY.memberNames.primary,
    role: "主责任人",
    home: "责任地图",
    summary: "先看责任落在哪里，再处理报告和整块交接。",
  }),
  partner: Object.freeze({
    name: MVP_CORE_DISPLAY.memberNames.partner,
    role: "接手方",
    home: "我的责任",
    summary: "确认自己真正拥有的责任，并独立决定是否接收交接。",
  }),
  subject: Object.freeze({
    name: MVP_CORE_DISPLAY.memberNames.subject,
    role: "本人",
    home: "我的对话",
    summary: "这是一段只属于你的私密对话，分享决定不会被预先选择。",
  }),
});

const ROLE_TEST_IDS = Object.freeze({
  primary: MVP_CORE_TEST_IDS.primarySurface,
  partner: MVP_CORE_TEST_IDS.partnerSurface,
  subject: MVP_CORE_TEST_IDS.subjectSurface,
});

export interface RoleSurfaceProps {
  readonly role: MemberRole;
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: ExperienceActionId | null;
  readonly commandsDisabled: boolean;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

export const RoleSurface = ({
  role,
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: RoleSurfaceProps) => {
  const copy = ROLE_COPY[role];
  const cardProps = { snapshot, pendingActionId, commandsDisabled, onAction } as const;

  return (
    <section
      className="role-surface"
      data-role={role}
      data-testid={ROLE_TEST_IDS[role]}
      aria-label={`${copy.name} · ${copy.role}`}
    >
      <header className="role-context">
        <span className="role-avatar" aria-hidden="true">
          {role === "primary" ? "主" : role === "partner" ? "接" : "本"}
        </span>
        <div>
          <p>{copy.home}</p>
          <h2>{copy.name}</h2>
          <span>{copy.role} · {copy.summary}</span>
        </div>
        <span className="sync-state">已同步 · r{snapshot.server.revision}</span>
      </header>

      <div className="role-card-grid" data-role={role} aria-label={`${copy.name} 当前内容`}>
        {role === "subject" ? <ConsentCard {...cardProps} /> : null}
        {role === "primary" ? (
          <>
            <ResponsibilityCard snapshot={snapshot} />
            <ReportCard {...cardProps} />
            <HandoverCard {...cardProps} />
          </>
        ) : null}
        {role === "partner" ? (
          <>
            <ResponsibilityCard snapshot={snapshot} />
            <PartnerConfirmationPanel {...cardProps} />
          </>
        ) : null}
      </div>
    </section>
  );
};
