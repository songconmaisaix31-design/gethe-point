"use client";

import { useMemo } from "react";

import { createHttpExperienceClient, type ExperienceClientError } from "../features/experience/client";
import { MVP_CORE_TEST_IDS } from "../features/experience/fixture-display";
import type {
  ExperienceActionId,
  ExperienceClient,
  ExperienceSnapshot,
  MemberRole,
} from "../features/experience/model";
import { ROLE_ORDER } from "../features/experience/model";
import { useExperience } from "../features/experience/use-experience";
import { RoleSurface } from "./RoleSurface";
import { ScenarioRail } from "./ScenarioRail";
import { TruthLabels } from "./TruthLabels";

export interface ExperienceViewProps {
  readonly snapshot: ExperienceSnapshot;
  readonly selectedRole: MemberRole;
  readonly pendingActionId: ExperienceActionId | null;
  readonly error: ExperienceClientError | null;
  readonly commandsDisabled: boolean;
  readonly onAction: (actionId: ExperienceActionId) => void;
  readonly onReload: () => void;
}

const truthMessage = (error: ExperienceClientError): string => {
  switch (error.truthSource) {
    case "response":
      return "页面已采用失败响应携带的服务端快照。";
    case "reload":
      return "页面已重新读取服务端快照；请以当前显示为准。";
    case "retained":
      return "服务端核对也未完成，页面仅保留最后一次确认的快照，不能据此判断写入已回滚。";
    case null:
      return "尚未取得可验证的服务端快照。";
  }
};

export const ExperienceView = ({
  snapshot,
  selectedRole,
  pendingActionId,
  error,
  commandsDisabled,
  onAction,
  onReload,
}: ExperienceViewProps) => (
  <main className="fixture-shell" data-testid={MVP_CORE_TEST_IDS.root}>
    <TruthLabels
      writeCount={snapshot.server.writeCount}
      sharedRowCount={snapshot.server.sharedRows}
    />
    <div className="fixture-layout">
      <ScenarioRail
        snapshot={snapshot}
        pendingActionId={pendingActionId}
        commandsDisabled={commandsDisabled}
        onAction={onAction}
      />
      <section className="experience-stage" aria-label="三角色同步体验">
        <h1 className="screen-reader-only">{snapshot.stageTitle}</h1>
        <header className="stage-heading">
          <div>
            <p className="stage-kicker">固定 QA-002 Fixture</p>
            <h2>{snapshot.stageTitle}</h2>
            <p>{snapshot.stageSummary}</p>
          </div>
          <span className="stage-revision">服务端快照 · r{snapshot.server.revision}</span>
        </header>

        {error === null ? null : (
          <div className="integration-error" role="alert">
            <div>
              <strong>操作结果需要核对</strong>
              <p>
                {error.message} {truthMessage(error)}
              </p>
            </div>
            <button type="button" className="action-button secondary-action" onClick={onReload}>
              重新加载服务端状态
            </button>
          </div>
        )}

        <div className="role-grid">
          {ROLE_ORDER.map((role) => (
            <RoleSurface
              role={role}
              selectedRole={selectedRole}
              snapshot={snapshot}
              pendingActionId={pendingActionId}
              commandsDisabled={commandsDisabled}
              onAction={onAction}
              key={role}
            />
          ))}
        </div>
      </section>
    </div>
  </main>
);

const LoadingExperience = ({ error, onReload }: { readonly error: ExperienceClientError | null; readonly onReload: () => void }) => (
  <main className="loading-layout" data-testid={MVP_CORE_TEST_IDS.root} aria-busy={error === null}>
    <TruthLabels writeCount={null} sharedRowCount={null} />
    <section className="loading-card" role={error === null ? "status" : "alert"}>
      <p className="eyebrow">类型化 HTTP 客户端</p>
      <h1>{error === null ? "正在加载" : "操作未完成"}</h1>
      <p>
        {error === null
          ? "请稍候，不会自动提交任何操作。"
          : `${error.message} ${truthMessage(error)}`}
      </p>
      {error === null ? (
        <div className="loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <button type="button" className="action-button secondary-action" onClick={onReload}>
          重新加载服务端状态
        </button>
      )}
    </section>
  </main>
);

export interface FixtureExperienceProps {
  readonly selectedRole: MemberRole;
  readonly client?: ExperienceClient;
}

export const resolveFixtureExperienceClient = (
  injectedClient?: ExperienceClient,
): ExperienceClient => injectedClient ?? createHttpExperienceClient();

export const FixtureExperience = ({ selectedRole, client: injectedClient }: FixtureExperienceProps) => {
  const client = useMemo(
    () => resolveFixtureExperienceClient(injectedClient),
    [injectedClient],
  );
  const controller = useExperience(client);

  if (controller.snapshot === null) {
    return <LoadingExperience error={controller.error} onReload={controller.reload} />;
  }

  return (
    <ExperienceView
      snapshot={controller.snapshot}
      selectedRole={selectedRole}
      pendingActionId={controller.pendingActionId}
      error={controller.error}
      commandsDisabled={
        controller.loading ||
        controller.pendingActionId !== null ||
        controller.error !== null
      }
      onAction={controller.perform}
      onReload={controller.reload}
    />
  );
};
