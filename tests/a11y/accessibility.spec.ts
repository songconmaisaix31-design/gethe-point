import { expect, test, type Page } from "@playwright/test";

import { resetDemo, switchRole } from "../helpers/demo";

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request);
  await page.goto("/");
});

test("subject flow has readable type, labelled controls, and 44px targets", async ({ page }) => {
  await switchRole(page, "subject");
  const chat = page.getByTestId("subject-chat");
  await expect(chat).toBeVisible();

  const fontSize = await chat.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(20);

  const controls = chat.getByRole("button");
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await expect(control).toHaveAccessibleName(/\S/);
    const box = await control.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

async function focusByTab(page: Page, testId: string): Promise<void> {
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      return {
        testId: element.dataset.testid ?? element.closest<HTMLElement>("[data-testid]")?.dataset.testid ?? null,
        outlineStyle: getComputedStyle(element).outlineStyle,
      };
    });
    if (focused?.testId === testId) {
      expect(focused.outlineStyle).not.toBe("none");
      return;
    }
  }
  throw new Error(`Keyboard focus did not reach ${testId}.`);
}

test("handover and care actions are reachable and operable by keyboard", async ({ page }) => {
  await focusByTab(page, "role-switch");
  await focusByTab(page, "handover-add-info");
  await page.keyboard.press("Enter");
  await focusByTab(page, "handover-confirm");
  await page.keyboard.press("Enter");

  await switchRole(page, "partner");
  await focusByTab(page, "handover-confirm");
  await page.keyboard.press("Enter");

  await resetDemo(page.request);
  await page.reload();
  await switchRole(page, "subject");
  for (const testId of ["care-activate", "care-trigger", "care-advance", "care-ack"]) {
    await focusByTab(page, testId);
    await page.keyboard.press("Enter");
  }

  await expect(page.getByTestId("notification-log")).toContainText(/closed|已闭环/i);
});

test("reduced-motion preference disables meaningful animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const animated = await page.locator("body *").evaluateAll((elements) =>
    elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== "none" && Number.parseFloat(style.animationDuration) > 0;
    }).length,
  );
  expect(animated).toBe(0);
});
