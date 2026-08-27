import {
  MVP_CORE_DISPLAY,
  MVP_CORE_TEST_IDS,
} from "../features/experience/fixture-display";
import type { ExperienceActionId, ExperienceSnapshot } from "../features/experience/model";

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
      return 4;
    case "accepted":
      return 5;
  }
};

export interface ScenarioRailProps {
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: ExperienceActionId | null;
  readonly onAction: (actionId: ExperienceActionId) => void;
}

export const ScenarioRail = ({ snapshot, pendingActionId, onAction }: ScenarioRailProps) => {
  const activeIndex = stageIndex(snapshot);

  return (
    <aside
      className="scenario-rail"
      data-testid={MVP_CORE_TEST_IDS.scenarioRail}
      aria-label="Fixture 场景进度"
    >
      <header className="rail-brand">
        <p className="rail-kicker">都记得 · We Remember</p>
        <h1>一整块责任，真正换主人</h1>
        <p>{MVP_CORE_DISPLAY.title} · 三角色同步 Fixture · 固定核心路径</p>
      </header>

      <section className="rail-current" aria-live="polite">
        <span>当前服务端真相</span>
        <strong>{snapshot.stageTitle}</strong>
        <p>{snapshot.stageSummary}</p>
      </section>

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

      <div className="rail-boundary">
        <strong>类型化 HTTP 边界</strong>
        <p>普通写入只发送 command；角色、空间、成员和私聊文本都不进入请求体。</p>
      </div>

      <button
        type="button"
        className="action-button secondary-action rail-reset"
        disabled={pendingActionId !== null}
        onClick={() => {
          onAction("reset_fixture");
        }}
      >
        {pendingActionId === "reset_fixture" ? "正在重置…" : "重置 Fixture"}
      </button>
    </aside>
  );
};
