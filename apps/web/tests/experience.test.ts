import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_SCREENSHOT_MANIFEST,
  FIXTURE_TRUTH_LABELS,
  REQUIRED_OPERATION_UI_STATES,
  UI_STATE_VOCABULARY,
} from "../src/features/experience/contracts";
import {
  fixtureExperienceClient,
  loadExperienceBundle,
} from "../src/features/experience/fixture-client";
import {
  ROLE_SURFACES,
  SCENARIO_ROUTES,
  resolveExperienceRoute,
} from "../src/features/experience/model";

describe("fixture experience contract", () => {
  it("resolves every frozen screenshot scenario", () => {
    expect(Object.keys(SCENARIO_ROUTES).sort()).toEqual(
      FIXTURE_SCREENSHOT_MANIFEST.map(({ id }) => id).sort(),
    );

    for (const scenario of FIXTURE_SCREENSHOT_MANIFEST) {
      const route = resolveExperienceRoute({ scenario: scenario.id });
      expect(route.scenario).toBe(scenario.id);
      expect(ROLE_SURFACES[route.role]).toContain(route.surface);
    }
  });

  it("exposes all required states with the frozen vocabulary", () => {
    expect(REQUIRED_OPERATION_UI_STATES).toEqual([
      "loading",
      "empty",
      "blocked",
      "denied",
      "error",
      "retry",
      "success",
    ]);

    for (const state of REQUIRED_OPERATION_UI_STATES) {
      const route = resolveExperienceRoute({ role: "primary", state });
      expect(route.forcedState).toBe(state);
      expect(UI_STATE_VOCABULARY[state].heading.length).toBeGreaterThan(0);
      expect(UI_STATE_VOCABULARY[state].detail.length).toBeGreaterThan(0);
    }
  });

  it("loads distinct contract-shaped homes through the client seam", async () => {
    const [primary, partner, subject] = await Promise.all([
      loadExperienceBundle(fixtureExperienceClient, "primary"),
      loadExperienceBundle(fixtureExperienceClient, "partner"),
      loadExperienceBundle(fixtureExperienceClient, "subject"),
    ]);

    expect(primary.home).toMatchObject({
      role: "primary",
      dataMode: "fixture",
      rememberedItemCount: 7,
    });
    expect(partner.home).toMatchObject({
      role: "partner",
      dataMode: "fixture",
      careInboxCount: 1,
    });
    expect(subject.home).toMatchObject({
      role: "subject",
      dataMode: "fixture",
      oneStepAcknowledgement: true,
    });
    expect(primary.conversation.messages[0]?.content).not.toBe(
      subject.conversation.messages[0]?.content,
    );
    expect(partner.report).not.toBeNull();
    expect(subject.report).toBeNull();
  });

  it("keeps truth labels and consent choices explicit in rendered source", async () => {
    const source = await readFile(
      resolve(process.cwd(), "apps/web/src/components/experience-screens.tsx"),
      "utf8",
    );
    const banner = await readFile(
      resolve(process.cwd(), "apps/web/src/components/truth-banner.tsx"),
      "utf8",
    );

    expect(Object.values(FIXTURE_TRUTH_LABELS)).toEqual([
      "演示数据 Fixture",
      "用于演示流程，不是账号实况",
      "演示角色切换，不是生产身份认证",
    ]);
    expect(banner).toContain("FIXTURE_TRUTH_LABELS.data");
    expect(source).toContain("告诉家里人");
    expect(source).toContain("先别说");
    expect(source).toContain("只告诉指定成员");
    expect(source).toContain("当前状态没有改变");
    expect(source).not.toContain("都是你的错");
    expect(source).not.toContain("家庭排名");
    expect(source).not.toContain("生产账号已认证");
  });

  it("implements the frozen subject accessibility tokens", async () => {
    const css = await readFile(
      resolve(process.cwd(), "apps/web/src/app/globals.css"),
      "utf8",
    );

    expect(css).toContain("min-height: var(--target-subject)");
    expect(css).toContain("font-size: var(--font-size-subject-body)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("outline: var(--focus-width) solid var(--color-focus)");
  });
});
