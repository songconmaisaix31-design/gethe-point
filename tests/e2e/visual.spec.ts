import { expect, test } from "@playwright/test";

import { resetDemo, switchRole } from "../helpers/demo";

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "mobile-390", width: 390, height: 844 },
] as const;

const roles = ["primary", "partner", "subject"] as const;

test("capture the three role surfaces at each acceptance viewport", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One browser project produces the canonical screenshots.");
  await resetDemo(request);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    for (const role of roles) {
      await switchRole(page, role);
      await expect(page.locator("#main-content")).toBeVisible();
      await page.screenshot({
        path: `docs/demo/screenshots/${viewport.name}-${role}.png`,
        fullPage: true,
      });
    }
  }
});
