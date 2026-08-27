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
  primary: Object.freeze({ name: MVP_CORE_DISPLAY.memberNames.primary, role: "主责任人", home: "责任地图" }),
  partner: Object.freeze({ name: MVP_CORE_DISPLAY.memberNames.partner, role: "接手方", home: "我的责任" }),
  subject: Object.freeze({ name: MVP_CORE_DISPLAY.memberNames.subject, role: "本人", home: "我的对话" }),
});

const ROLE_TEST_IDS = Object.freeze({
  primary: MVP_CORE_TEST_IDS.primarySurface,
  partner: MVP_CORE_TEST_IDS.partnerSurface,
  subject: MVP_CORE_TEST_IDS.subjectSurface,
});

export interface RoleSurfaceProps {
  readonly role: MemberRole;
  readonly selectedRole: MemberRole;
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: ExperienceActionId | null;
  readonly commandsDisabled: boolean;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

export const RoleSurface = ({
  role,
  selectedRole,
  snapshot,
  pendingActionId,
  commandsDisabled,
  onAction,
}: RoleSurfaceProps) => {
  const copy = ROLE_COPY[role];
  const cardProps = { snapshot, pendingActionId, commandsDisabled, onAction } as const;

  return (
    <section
      className="role-column"
      data-role={role}
      data-mobile-active={selectedRole === role}
      data-testid={ROLE_TEST_IDS[role]}
      aria-label={`${copy.name} · ${copy.role}`}
    >
      <header className="role-caption">
        <strong>{copy.name}</strong>
        <span>{copy.role}</span>
      </header>

      <article className={`role-device${role === "subject" ? " subject-device" : ""}`}>
        <header className="role-topbar">
          <div>
            <p>{copy.home}</p>
            <h2>{copy.name}</h2>
          </div>
          <span className="sync-state">同步 · r{snapshot.server.revision}</span>
        </header>

        <div className="role-scroll" tabIndex={0} aria-label={`${copy.name} 当前内容`}>
          {role === "subject" ? <ConsentCard {...cardProps} /> : null}
          {role === "primary" ? (
            <>
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
      </article>
    </section>
  );
};
