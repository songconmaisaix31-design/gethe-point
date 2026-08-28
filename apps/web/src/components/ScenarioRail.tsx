import {
  MVP_CORE_DISPLAY,
  MVP_CORE_TEST_IDS,
} from "../features/experience/fixture-display";
import type {
  ExperienceActionId,
  ExperienceSnapshot,
  MemberRole,
} from "../features/experience/model";
import { ROLE_ORDER } from "../features/experience/model";

const SCENARIO_STEPS = Object.freeze([
  Object.freeze({ stage: "consent", title: "本人同意", detail: "一次结论，一次决定" }),
  Object.freeze({ stage: "consent_recorded", title: "本人发布", detail: "同意不等于自动发布" }),
  Object.freeze({ stage: "report", title: "责任报告", detail: "只呈现分布，不评分" }),
  Object.freeze({ stage: "blocked", title: "补齐资料", detail: "信息不全不转移" }),
  Object.freeze({
    stage: "awaiting_confirmations",
    title: "双方确认",
    detail: "两个独立确认",
  }),
  Object.freeze({ stage: "accepted", title: "完成交接", detail: "负责人和提醒一起转移" }),
] as const);

const ROLE_LINK_COPY = Object.freeze({
  primary: Object.freeze({ label: "主责任人", name: MVP_CORE_DISPLAY.memberNames.primary }),
  partner: Object.freeze({ label: "接手方", name: MVP_CORE_DISPLAY.memberNames.partner }),
  subject: Object.freeze({ label: "本人", name: MVP_CORE_DISPLAY.memberNames.subject }),
});

const stageIndex = (snapshot: ExperienceSnapshot): number => {
  switch (snapshot.stage) {
    case "consent":
    case "private":
      return 0;
    case "consent_recorded":
      return 1;
    case "report":
      return 2;
    case "blocked":
      return 3;
    case "awaiting_confirmations":
    case "source_confirmed":
    case "recipient_confirmed":
    case "acceptance_pending":
      return 4;
    case "accepted":
      return 5;
  }
};

export interface ScenarioRailProps {
  readonly snapshot: ExperienceSnapshot;
  readonly selectedRole: MemberRole;
  readonly pendingActionId: ExperienceActionId | null;
  readonly commandsDisabled: boolean;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

export const ScenarioRail = ({
  snapshot,
  selectedRole,
  pendingActionId,
  commandsDisabled,
  onAction,
}: ScenarioRailProps) => {
  const activeIndex = stageIndex(snapshot);

  return (
    <aside
      className="scenario-rail"
      data-testid={MVP_CORE_TEST_IDS.scenarioRail}
      aria-label="应用导航与 Fixture 状态"
    >
      <header className="rail-brand">
        <p className="rail-kicker">都记得 · We Remember</p>
        <p className="rail-title">家庭责任工作台</p>
        <p>{MVP_CORE_DISPLAY.title} · 当前角色 Fixture</p>
      </header>

      <nav className="role-navigation" aria-label="Fixture 角色导航">
        <p className="rail-section-label">演示角色</p>
        <div className="role-links">
          {ROLE_ORDER.map((role) => {
            const copy = ROLE_LINK_COPY[role];
            const isCurrent = role === selectedRole;
            return (
              <a
                href={`?role=${role}`}
                className="role-link"
                data-active={isCurrent}
                aria-current={isCurrent ? "page" : undefined}
                key={role}
              >
                <span className="role-link-mark" aria-hidden="true">
                  {role === "primary" ? "主" : role === "partner" ? "接" : "本"}
                </span>
                <span>
                  <strong>{copy.label}</strong>
                  <small>{copy.name}</small>
                </span>
              </a>
            );
          })}
        </div>
        <p className="role-navigation-note">角色切换仅用于演示，不代表身份认证。</p>
      </nav>

      <section className="rail-current" aria-live="polite">
        <span>当前服务端真相</span>
        <strong>{snapshot.stageTitle}</strong>
        <p>{snapshot.stageSummary}</p>
      </section>

      <section className="workflow-status" aria-label="核心流程状态">
        <div className="workflow-heading">
          <span className="rail-section-label">核心流程</span>
          <span>{activeIndex + 1} / {SCENARIO_STEPS.length}</span>
        </div>
        <ol className="scenario-steps">
          {SCENARIO_STEPS.map((step, index) => {
            const state =
              index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
            return (
              <li
                key={step.stage}
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="step-index">{index + 1}</span>
                <span className="step-copy">
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </span>
                <span className="step-state">
                  {state === "complete" ? "已完成" : state === "current" ? "当前" : "待演示"}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="rail-boundary">
        <strong>类型化 HTTP 边界</strong>
        <p>普通写入只发送 command；角色、空间、成员和私聊文本都不进入请求体。</p>
      </div>

      <button
        type="button"
        className="action-button secondary-action rail-reset"
        disabled={commandsDisabled || pendingActionId !== null}
        onClick={() => {
          onAction("reset_fixture");
        }}
      >
        {pendingActionId === "reset_fixture" ? "正在重置…" : "重置 Fixture"}
      </button>
    </aside>
  );
};
