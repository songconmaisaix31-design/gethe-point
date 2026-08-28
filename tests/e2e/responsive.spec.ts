import { expect, test } from "@playwright/test";

import { resetDemo, switchRole } from "../helpers/demo";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const;

test("four-minute surface has no horizontal overflow at desktop, tablet, or mobile sizes", async ({ page, request }) => {
  await resetDemo(request);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByTestId("truth-label"), viewport.name).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, viewport.name).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    for (const role of ["primary", "partner", "subject"] as const) {
      await switchRole(page, role);
      await expect(page.locator("#main-content"), `${viewport.name}-${role}`).toBeVisible();
    }

    if (viewport.width === 390) {
      const consent = page.getByTestId("consent-space");
      const voice = page.getByLabel("演示输入控件");
      await expect(consent).toBeVisible();
      await expect(voice).toBeVisible();
      const consentBox = await consent.boundingBox();
      const voiceBox = await voice.boundingBox();
      expect(voiceBox?.y).toBeGreaterThanOrEqual((consentBox?.y ?? 0) + (consentBox?.height ?? 0));
    }
  }
});
