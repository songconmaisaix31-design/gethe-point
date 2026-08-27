"use client";

import { useMemo } from "react";

import { createLocalFixtureClient } from "../features/experience/client";
import type {
  CanonicalScenarioActionId,
  ExperienceSnapshot,
} from "../features/experience/model";
import { ROLE_ORDER } from "../features/experience/model";
import { useExperience } from "../features/experience/use-experience";
import { RoleSurface } from "./RoleSurface";
import { ScenarioRail } from "./ScenarioRail";
import { TruthLabels } from "./TruthLabels";

export interface ExperienceViewProps {
  readonly snapshot: ExperienceSnapshot;
  readonly pendingActionId: CanonicalScenarioActionId | null;
  readonly error: ReturnType<typeof useExperience>["error"];
  readonly onAction: (actionId: CanonicalScenarioActionId) => void;
  readonly onRetry: () => void;
}

export const ExperienceView = ({
  snapshot,
  pendingActionId,
  error,
  onAction,
  onRetry,
}: ExperienceViewProps) => (
  <main className="fixture-layout">
    <ScenarioRail
      stage={snapshot.stage}
      title={snapshot.stageTitle}
      summary={snapshot.stageSummary}
    />
    <section className="experience-stage" aria-label="三角色同步体验">
      <h1 className="screen-reader-only">{snapshot.stageTitle}</h1>
      <header className="stage-heading">
        <div>
          <p className="stage-kicker">固定 Fixture 演示路径</p>
          <h2>{snapshot.stageTitle}</h2>
          <p>{snapshot.stageSummary}</p>
        </div>
        <span className="stage-revision">服务端快照 · r{snapshot.revision}</span>
      </header>
      <div className="role-grid">
        {ROLE_ORDER.map((role) => (
          <RoleSurface
            role={role}
            snapshot={snapshot}
            pendingActionId={pendingActionId}
            error={error}
            onAction={onAction}
            onRetry={onRetry}
            key={role}
          />
        ))}
      </div>
    </section>
  </main>
);

const LoadingExperience = () => (
  <main className="loading-layout" aria-busy="true">
    <section className="loading-card" aria-live="polite">
      <TruthLabels />
      <p className="eyebrow">类型化本地客户端</p>
      <h1>正在加载</h1>
      <p>请稍候，不会自动提交任何操作。</p>
      <div className="loading-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  </main>
);

export const FixtureExperience = () => {
  const client = useMemo(() => createLocalFixtureClient(), []);
  const controller = useExperience(client);

  if (controller.snapshot === null) {
    if (controller.error !== null && !controller.loading) {
      return (
        <main className="loading-layout">
          <section className="loading-card" role="alert">
            <TruthLabels />
            <p className="eyebrow">可恢复的连接状态</p>
            <h1>操作未完成</h1>
            <p>{controller.error.message} 当前状态没有改变，请稍后重试。</p>
            <button type="button" className="action-button primary-action" onClick={controller.reload}>
              重试
            </button>
          </section>
        </main>
      );
    }

    return <LoadingExperience />;
  }

  return (
    <ExperienceView
      snapshot={controller.snapshot}
      pendingActionId={controller.pendingActionId}
      error={controller.error}
      onAction={controller.perform}
      onRetry={controller.retry}
    />
  );
};
