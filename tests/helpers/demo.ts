import { expect, type APIRequestContext, type Page } from "@playwright/test";

import type { DemoAction, Role, RoleSafeProjection } from "../../src/contracts";

const roleLabels: Record<Role, RegExp> = {
  primary: /妈妈|主责任人/,
  partner: /爸爸|共同生活成员/,
  subject: /奶奶|被看护人/,
};

export async function resetDemo(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/demo/reset?role=primary", { data: {} });
  expect(response.ok()).toBeTruthy();
}

export async function getState(
  request: APIRequestContext,
  role: Role,
): Promise<RoleSafeProjection> {
  const response = await request.get(`/api/demo/state?role=${role}`);
  expect(response.ok()).toBeTruthy();
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("role" in body) || body.role !== role) {
    throw new Error(`Invalid ${role} role-safe projection.`);
  }
  return body as RoleSafeProjection;
}

export async function postAction(
  request: APIRequestContext,
  action: DemoAction,
  role: Role = "subject",
): Promise<void> {
  const response = await request.post(`/api/demo/action?role=${role}`, { data: action });
  expect(response.ok()).toBeTruthy();
}

export async function switchRole(page: Page, role: Role): Promise<void> {
  const switcher = page.getByTestId("role-switch");
  await expect(switcher).toBeVisible();
  const tagName = await switcher.evaluate((element) => element.tagName);
  if (tagName === "SELECT") {
    await switcher.selectOption(role);
  } else {
    const button = switcher.getByRole("button", { name: roleLabels[role] });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }

  if (await page.getByTestId("family-home").count()) {
    await expect(page.locator(".home-loading")).toBeHidden();
    await expect(page.getByTestId("timetable-grid")).toBeVisible();
    return;
  }

  await expect(page.locator(".loading-card")).toBeHidden();
  await expect(page.locator("#main-content").getByRole("heading", { level: 1 })).toContainText(
    roleLabels[role],
  );
}
