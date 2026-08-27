import { readFile } from "node:fs/promises";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperienceView } from "../src/components/FixtureExperience";
import { ExperienceClientError } from "../src/features/experience/client";
import {
  getFixtureSnapshot,
  type FixtureScenarioStateId,
} from "../src/features/experience/fixture-scenario";
import type { CanonicalScenarioActionId } from "../src/features/experience/model";

const ignoreAction = (): void => undefined;
const ignoreRetry = (): void => undefined;
const renderView = (
  state: FixtureScenarioStateId,
  revision: number,
  pendingActionId: CanonicalScenarioActionId | null = null,
  error: ExperienceClientError | null = null,
): string =>
  renderToStaticMarkup(
    createElement(ExperienceView, {
      snapshot: getFixtureSnapshot(state, revision),
      pendingActionId,
      error,
      onAction: ignoreAction,
      onRetry: ignoreRetry,
    }),
  );

describe("core Fixture experience view", () => {
  it("renders three synchronized role surfaces and persistent truth labels", () => {
    const html = renderView("blocked", 2);

    expect(html.match(/data-role=/g)).toHaveLength(3);
    expect(html.match(/Fixture truth boundary/g)).toHaveLength(3);
    expect(html).toContain("Fixture");
    expect(html).toContain("Local Demo");
    expect(html).toContain("Not Production Acceptance");
    expect(html).toContain("演示数据 Fixture");
    expect(html).toContain("用于演示流程，不是账号实况");
    expect(html).toContain("演示角色切换，不是生产身份认证");
    expect(html).toContain("补齐上次检查结果");
    expect(html).toContain("缺少：上次检查结果");
    expect(html).toContain("当前负责人：家人甲（未转移）");
  });

  it("keeps subject consent explicit and free of arbitrary input fields", () => {
    const html = renderView("consent", 0);

    expect(html).toContain("告诉家里人");
    expect(html).toContain("只告诉家人甲");
    expect(html).toContain("先别说");
    expect(html).not.toMatch(/<(?:input|textarea|select)\b/);
  });

  it("shows each confirmation and the final reminder release", () => {
    const html = renderView("accepted", 5);

    expect(html).toContain("家人甲 · 提出方");
    expect(html).toContain("已确认 · 08:10");
    expect(html).toContain("家人乙 · 接手方");
    expect(html).toContain("已确认 · 08:11");
    expect(html).toContain("当前负责人：家人乙");
    expect(html).toContain("家人甲不再收到这一责任域的催办");
  });

  it("renders a recoverable integration error with an idempotent retry action", () => {
    const html = renderView(
      "blocked",
      2,
      "supply_last_check_result",
      new ExperienceClientError(
        "fixture_connection_interrupted",
        "连接短暂中断，本次操作没有提交。",
        true,
      ),
    );

    expect(html).toContain("操作未完成");
    expect(html).toContain("当前状态没有改变");
    expect(html).toContain(">重试<");
  });

  it("uses the frozen Style A palette without remote runtime assets", async () => {
    const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

    for (const color of ["#f4f1ea", "#ffffff", "#1f1c17", "#33513f", "#8a5a3b", "#9c4e22"]) {
      expect(css).toContain(color);
    }
    expect(css).toContain("padding: 18px 16px");
    expect(css).not.toMatch(/@import|url\(|fonts\.googleapis|fonts\.gstatic/i);
  });
});
