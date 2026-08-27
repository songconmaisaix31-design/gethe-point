import type {
  CanonicalScenarioActionId,
  ExperienceSnapshot,
  MemberRole,
} from "../features/experience/model";
import type { ExperienceClientError } from "../features/experience/client";
import { HandoverCard } from "./HandoverCard";
import { ResponsibilityReportCard } from "./ResponsibilityReportCard";
import { TruthLabels } from "./TruthLabels";

const ROLE_COPY = {
  primary: {
    name: "家人甲",
    role: "主责任人",
    home: "责任地图",
  },
  partner: {
    name: "家人乙",
    role: "接手方",
    home: "我的责任",
  },
  subject: {
    name: "长辈甲",
    role: "本人",
    home: "我的对话",
  },
} as const satisfies Readonly<Record<MemberRole, Readonly<Record<string, string>>>>;

export interface RoleSurfaceProps {
  readonly role: MemberRole;
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: CanonicalScenarioActionId | null;
  readonly error: ExperienceClientError | null;
  readonly onAction: (actionId: CanonicalScenarioActionId) => void;
  readonly onRetry: () => void;
}

const ConsentCard = () => (
  <section className="content-card consent-card" aria-labelledby="consent-card-title">
    <header className="card-title-zone">
      <div>
        <p className="eyebrow">待确认的结构化结论</p>
        <h3 id="consent-card-title">要不要让家里人知道？</h3>
      </div>
      <span className="paper-tag">默认仅自己</span>
    </header>
    <div className="card-body-zone subject-copy">
      <p className="subject-statement">复查安排需要家人一起确认。</p>
      <p>只分享这条结论，不会把你的私聊原文发给家里人。</p>
    </div>
    <div className="state-zone">
      <strong>还没有选择分享范围</strong>
      <p>你可以告诉全家、只告诉家人甲，或先留在自己这里。</p>
    </div>
    <footer className="evidence-zone">
      <span>来源</span>
      <p>来自你刚才的私聊 · 原文仍仅你可见</p>
    </footer>
  </section>
);

const ConsentRecordedCard = ({ snapshot }: { readonly snapshot: ExperienceSnapshot }) => (
  <section className="content-card decision-card" aria-live="polite">
    <header className="card-title-zone">
      <div>
        <p className="eyebrow">分享决定已记录</p>
        <h3>{snapshot.stageTitle}</h3>
      </div>
      <span className="state-badge state-accepted">已完成</span>
    </header>
    <div className="card-body-zone subject-copy">
      <p>{snapshot.stageSummary}</p>
    </div>
    <div className="state-zone state-zone-accepted">
      <strong>本次决定只作用于这一条结论</strong>
      <p>没有自动开启后续分享，也没有改变其他私聊内容的可见范围。</p>
    </div>
  </section>
);

const WaitingCard = ({ role, snapshot }: { readonly role: MemberRole; readonly snapshot: ExperienceSnapshot }) => {
  const isSubject = role === "subject";
  return (
    <section className="content-card waiting-card">
      <header className="card-title-zone">
        <div>
          <p className="eyebrow">同步状态</p>
          <h3>{isSubject ? "你的分享决定已记录" : "等待本人完成分享决定"}</h3>
        </div>
        <span className="paper-tag">只读</span>
      </header>
      <div className="card-body-zone">
        <p>
          {isSubject
            ? "家庭侧只会看到你已同意分享的结构化结论，不会看到私聊原文。"
            : "在本人明确选择前，家庭侧看不到这条结论，也不会将它计入责任报告。"}
        </p>
      </div>
      <div className="state-zone">
        <strong>{snapshot.stageTitle}</strong>
        <p>{snapshot.stageSummary}</p>
      </div>
    </section>
  );
};

const RoleContent = ({ role, snapshot }: { readonly role: MemberRole; readonly snapshot: ExperienceSnapshot }) => {
  if (role === "subject") {
    if (snapshot.stage === "consent") {
      return <ConsentCard />;
    }
    if (snapshot.stage === "consent_recorded") {
      return <ConsentRecordedCard snapshot={snapshot} />;
    }
    return <WaitingCard role={role} snapshot={snapshot} />;
  }

  if (snapshot.stage === "consent" || snapshot.stage === "consent_recorded") {
    return <WaitingCard role={role} snapshot={snapshot} />;
  }

  return (
    <>
      {snapshot.handover === null ? null : (
        <HandoverCard handover={snapshot.handover} role={role} />
      )}
      {snapshot.report === null ? null : (
        <ResponsibilityReportCard report={snapshot.report} role={role} />
      )}
    </>
  );
};

export const RoleSurface = ({
  role,
  snapshot,
  pendingActionId,
  error,
  onAction,
  onRetry,
}: RoleSurfaceProps) => {
  const roleCopy = ROLE_COPY[role];
  const actions = snapshot.actions.filter((candidate) => candidate.role === role);
  const isPending = pendingActionId !== null;
  const showError = error !== null && actions.some(({ id }) => id === pendingActionId);

  return (
    <section
      className="role-column"
      data-role={role}
      data-mobile-active={snapshot.mobileRole === role}
      aria-label={`${roleCopy.name} · ${roleCopy.role}`}
    >
      <header className="role-caption">
        <strong>{roleCopy.name}</strong>
        <span>{roleCopy.role}</span>
      </header>

      <article className={`role-device${role === "subject" ? " subject-device" : ""}`}>
        <TruthLabels />

        <header className="role-topbar">
          <div>
            <p>{roleCopy.home}</p>
            <h2>{roleCopy.name}</h2>
          </div>
          <span className="sync-state">同步 · r{snapshot.revision}</span>
        </header>

        <div className="role-scroll" tabIndex={0} aria-label={`${roleCopy.name} 当前内容`}>
          <RoleContent role={role} snapshot={snapshot} />
        </div>

        {actions.length > 0 ? (
          <footer className="action-dock">
            {showError ? (
              <div className="integration-error" role="alert">
                <strong>操作未完成</strong>
                <p>{error.message} 当前状态没有改变。</p>
                {error.recoverable ? (
                  <button type="button" className="action-button primary-action" onClick={onRetry}>
                    重试
                  </button>
                ) : null}
              </div>
            ) : (
              actions.map((scenarioAction) => (
                <button
                  type="button"
                  className={`action-button ${
                    scenarioAction.tone === "primary" ? "primary-action" : "secondary-action"
                  }`}
                  disabled={isPending}
                  key={scenarioAction.id}
                  onClick={() => {
                    onAction(scenarioAction.id);
                  }}
                >
                  {pendingActionId === scenarioAction.id ? "正在提交，不会重复操作…" : scenarioAction.label}
                </button>
              ))
            )}
          </footer>
        ) : null}
      </article>
    </section>
  );
};
