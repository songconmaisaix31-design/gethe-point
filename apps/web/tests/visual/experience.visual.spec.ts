import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  FIXTURE_SCREENSHOT_MANIFEST,
  FIXTURE_TRUTH_LABELS,
  REQUIRED_OPERATION_UI_STATES,
  REQUIRED_VIEWPORTS,
  UI_STATE_VOCABULARY,
} from "../../src/features/experience/contracts";

const baseUrl = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3000";

const assertScenarioFacts = async (
  scenarioId: (typeof FIXTURE_SCREENSHOT_MANIFEST)[number]["id"],
  page: Page,
): Promise<void> => {
  switch (scenarioId) {
    case "primary-home-before-handover":
      await expect(page.locator(".remembered-list li")).toHaveCount(7);
      await expect(page.getByText("责任未转移", { exact: true })).toBeVisible();
      return;
    case "handover-blocked-missing-result":
      await expect(page.getByText("缺少：上次检查结果", { exact: true })).toBeVisible();
      await expect(page.getByText("当前负责人", { exact: true })).toBeVisible();
      await expect(page.getByText("尚未确认")).toHaveCount(2);
      return;
    case "handover-accepted-workload-release":
      await expect(page.getByTestId("workload-release")).toBeVisible();
      await expect(page.getByText("后续提醒不再发送给家人甲，新任务默认归家人乙。", { exact: true })).toBeVisible();
      return;
    case "partner-pending-handover":
      await expect(page.getByText(FIXTURE_HANDOVER_SCOPE, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "确认完整接手范围" })).toBeVisible();
      return;
    case "subject-private-consent":
      await expect(page.getByRole("button", { name: /告诉家里人/ })).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByRole("button", { name: /先别说/ })).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByRole("button", { name: /只告诉指定成员/ })).toHaveAttribute("aria-pressed", "false");
      return;
    case "subject-care-acknowledgement": {
      const action = page.getByRole("button", { name: "我知道了" });
      const box = await action.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(60);
      await action.focus();
      expect(parseFloat(await action.evaluate((element) => getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(3);
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(parseFloat(await action.evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
      await action.evaluate((element) => { element.blur(); });
      return;
    }
    case "care-escalated-and-handled":
      await expect(page.getByText("20:01 · 未在时限内确认", { exact: true })).toBeVisible();
      await expect(page.getByText("处理记录已留痕，等待按规则关闭", { exact: true })).toBeVisible();
      return;
    case "evidence-deleted-needs-review":
      await expect(page.getByText("证据已缺失", { exact: true })).toBeVisible();
      await expect(page.getByText("已接受的责任交接保持不变，不会把责任退回原负责人。", { exact: true })).toBeVisible();
      return;
    case "denied-private-evidence":
      await expect(page.getByRole("heading", { name: "无法查看" })).toBeVisible();
      await expect(page.getByText("我准备接手复查安排，请帮我核对交接范围。", { exact: true })).toHaveCount(0);
      return;
    case "provider-fallback-human-review":
      await expect(page.getByText("需要人工确认", { exact: true })).toBeVisible();
      await expect(page.getByText("AI 未能生成可靠结果，未执行后续操作。", { exact: true })).toBeVisible();
      return;
  }
};

const FIXTURE_HANDOVER_SCOPE = "负责本次复查预约、陪同与结果跟进。";

for (const viewport of REQUIRED_VIEWPORTS) {
  for (const scenario of FIXTURE_SCREENSHOT_MANIFEST) {
    test(`${scenario.id} ${viewport.id} @visual`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${baseUrl}/?scenario=${scenario.id}`, { waitUntil: "networkidle" });
      await expect(page.locator("main[data-ready='true']")).toBeVisible();
      await expect(page.getByTestId("fixture-truth")).toContainText(FIXTURE_TRUTH_LABELS.data);
      await expect(page.getByTestId("fixture-truth")).toContainText(FIXTURE_TRUTH_LABELS.account);
      await expect(page.getByTestId("fixture-truth")).toContainText(FIXTURE_TRUTH_LABELS.authentication);
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await assertScenarioFacts(scenario.id, page);

      if (scenario.id === "subject-private-consent" || scenario.id === "subject-care-acknowledgement") {
        const accessibility = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        expect(accessibility.violations).toEqual([]);
      }

      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });

      await expect(page).toHaveScreenshot(`${scenario.id}-${viewport.id}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
      });
    });
  }
}

test("operation state vocabulary @visual", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const state of REQUIRED_OPERATION_UI_STATES) {
    await page.goto(`${baseUrl}/?role=primary&state=${state}`, { waitUntil: "networkidle" });
    const notice = page.locator(`main [data-ui-state="${state}"]`);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading")).toHaveText(UI_STATE_VOCABULARY[state].heading);
    await expect(notice).toContainText(UI_STATE_VOCABULARY[state].detail);
  }
});
