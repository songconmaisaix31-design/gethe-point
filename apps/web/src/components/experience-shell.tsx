"use client";

import { useEffect, useState } from "react";

import {
  REQUIRED_OPERATION_UI_STATES,
  UI_STATE_VOCABULARY,
  type UIState,
} from "../features/experience/contracts";
import type { ExperienceBundle } from "../features/experience/client";
import {
  fixtureExperienceClient,
  loadExperienceBundle,
} from "../features/experience/fixture-client";
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_SURFACES,
  SURFACE_LABELS,
  routeHref,
  type ExperienceRoute,
} from "../features/experience/model";
import { ExperienceScreen } from "./experience-screens";
import { StateNotice } from "./state-notice";
import { TruthBanner } from "./truth-banner";

interface ExperienceShellProps {
  readonly route: ExperienceRoute;
}

interface ExperienceFrameProps {
  readonly route: ExperienceRoute;
  readonly loadState: LoadState;
  readonly onRetry: () => void;
}

export type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; bundle: ExperienceBundle }>;

const blockingPreviewStates: readonly UIState[] = [
  "loading",
  "empty",
  "blocked",
  "denied",
  "error",
  "retry",
  "success",
  "needs_human_review",
  "unresolved",
];

export function ExperienceShell({ route }: ExperienceShellProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadExperienceBundle(fixtureExperienceClient, route.role)
      .then((bundle) => {
        if (active) {
          setLoadState({ status: "ready", bundle });
        }
      })
      .catch(() => {
        if (active) {
          setLoadState({ status: "error" });
        }
      });

    return () => {
      active = false;
    };
  }, [retryVersion, route.role]);

  const retry = (): void => {
    setLoadState({ status: "loading" });
    setRetryVersion((value) => value + 1);
  };

  return <ExperienceFrame route={route} loadState={loadState} onRetry={retry} />;
}

export function ExperienceFrame({ route, loadState, onRetry }: ExperienceFrameProps) {
  const previewState = route.forcedState;
  const hidesSurface =
    previewState !== null && blockingPreviewStates.some((state) => state === previewState);

  return (
    <div className={route.role === "subject" ? "app-shell app-shell--subject" : "app-shell"}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <TruthBanner />
      <header className="app-header">
        <a className="brand" href="/?role=primary" aria-label="都记得首页">
          <span className="brand__mark" aria-hidden="true">记</span>
          <span><strong>都记得</strong><small>We Remember</small></span>
        </a>
        <nav className="role-switcher" aria-label="演示角色切换">
          {(["primary", "partner", "subject"] as const).map((role) => (
            <a
              key={role}
              className={route.role === role ? "role-link role-link--active" : "role-link"}
              href={routeHref(role)}
              aria-current={route.role === role ? "page" : undefined}
            >
              {ROLE_LABELS[role]}
            </a>
          ))}
        </nav>
      </header>

      <div className="page-frame">
        <aside className="side-panel">
          <div className="role-summary">
            <p className="eyebrow">当前演示角色</p>
            <h2>{ROLE_LABELS[route.role]}</h2>
            <p>{ROLE_DESCRIPTIONS[route.role]}</p>
          </div>
          <nav className="surface-nav" aria-label={`${ROLE_LABELS[route.role]}功能`}>
            {ROLE_SURFACES[route.role].map((surface) => (
              <a
                key={surface}
                href={routeHref(route.role, surface)}
                aria-current={route.surface === surface ? "page" : undefined}
              >
                <span aria-hidden="true">{route.surface === surface ? "●" : "○"}</span>
                {SURFACE_LABELS[surface]}
              </a>
            ))}
          </nav>
          <p className="fixture-mode-note">固定合同 Fixture · 不连接数据库或生产账号</p>
        </aside>

        <main
          id="main-content"
          className="main-content"
          data-role={route.role}
          data-scenario={route.scenario ?? "role-default"}
          data-ready={loadState.status === "ready" ? "true" : "false"}
        >
          {route.scenario !== null ? (
            <p className="scenario-label">视觉场景 · {route.scenario}</p>
          ) : null}
          {previewState !== null ? (
            <StateNotice
              state={previewState}
              onRetry={previewState === "error" || previewState === "retry" ? onRetry : undefined}
            />
          ) : null}
          {!hidesSurface && loadState.status === "loading" ? <StateNotice state="loading" /> : null}
          {!hidesSurface && loadState.status === "error" ? <StateNotice state="error" onRetry={onRetry} /> : null}
          {!hidesSurface && loadState.status === "ready" ? (
            <ExperienceScreen
              bundle={loadState.bundle}
              client={fixtureExperienceClient}
              route={route}
            />
          ) : null}
        </main>
      </div>

      <footer className="app-footer">
        <span>Fixture 状态预览</span>
        <nav aria-label="界面状态预览">
          {REQUIRED_OPERATION_UI_STATES.map((state) => (
            <a key={state} href={`${routeHref(route.role, route.surface)}&state=${state}`}>
              {UI_STATE_VOCABULARY[state].heading}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
