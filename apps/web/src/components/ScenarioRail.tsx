import type { ExperienceStage } from "../features/experience/model";

const SCENARIO_STEPS = [
  {
    stage: "consent",
    title: "本人分享决定",
    detail: "每条结论单独确认",
  },
  {
    stage: "report",
    title: "五阶段报告",
    detail: "只呈现分布，不评分",
  },
  {
    stage: "blocked",
    title: "交接被阻断",
    detail: "缺少上次检查结果",
  },
  {
    stage: "awaiting_confirmations",
    title: "信息已补齐",
    detail: "awaiting_confirmations",
  },
  {
    stage: "source_confirmed",
    title: "提出方确认",
    detail: "所有权仍未转移",
  },
  {
    stage: "accepted",
    title: "接手方确认",
    detail: "负责人和提醒一起转移",
  },
] as const;

const currentStepIndex = (stage: ExperienceStage): number => {
  if (stage === "consent_recorded") {
    return 0;
  }

  return SCENARIO_STEPS.findIndex((step) => step.stage === stage);
};

export interface ScenarioRailProps {
  readonly stage: ExperienceStage;
  readonly title: string;
  readonly summary: string;
}

export const ScenarioRail = ({ stage, title, summary }: ScenarioRailProps) => {
  const activeIndex = currentStepIndex(stage);

  return (
    <aside className="scenario-rail" aria-label="Fixture 场景进度">
      <header className="rail-brand">
        <p className="rail-kicker">都记得 · We Remember</p>
        <h1>一整块责任，真正换主人</h1>
        <p>三角色同步 Fixture · 仅演示固定核心路径</p>
      </header>

      <section className="rail-current" aria-live="polite">
        <span>当前画面</span>
        <strong>{title}</strong>
        <p>{summary}</p>
      </section>

      <ol className="scenario-steps">
        {SCENARIO_STEPS.map((step, index) => {
          const state = index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
          return (
            <li key={step.stage} data-state={state} aria-current={state === "current" ? "step" : undefined}>
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
        <strong>类型化本地客户端边界</strong>
        <p>界面只提交固定操作编号和版本号；角色、空间与私聊文本不可输入。</p>
      </div>
    </aside>
  );
};
