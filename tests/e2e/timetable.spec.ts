import { expect, test } from "@playwright/test";

import type { AgentQueryResponse } from "../../src/contracts";
import { getState, resetDemo, switchRole } from "../helpers/demo";

const privateEvidenceText = "腿又疼了，下楼有点吃力";
const hiddenPrimaryItemIds = ["timetable_school_form", "timetable_health_booking"];
const hiddenPrimaryItemTitles = ["交回新生体检表", "预约骨科复查"];
const targetMemberIds = ["member_primary", "member_partner", "member_subject"] as const;
const expectedAgentIntents = ["schedule", "responsibilities", "care", "help"] as const;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request);
  await page.goto("/");
  await expect(page.getByTestId("timetable-grid")).toBeVisible();
});

test("renders the seeded seven-day timetable and combines member and category filters", async ({ page }) => {
  const timetable = page.getByTestId("timetable-grid");
  await expect(page.getByTestId("family-home")).toBeVisible();
  await expect(timetable.getByTestId(/^timetable-day-/)).toHaveCount(7);
  await expect(timetable.getByTestId(/^timetable-item-/)).toHaveCount(6);
  await expect(page.getByTestId("timetable-item-timetable_school_form")).toContainText("交回新生体检表");
  await expect(page.getByTestId("timetable-item-timetable_medicine")).toContainText(/周素兰.*照护.*计划中/);

  const filters = page.getByLabel("筛选家庭日程");
  await filters.getByRole("button", { name: "陈建国", exact: true }).click();
  await expect(timetable.getByTestId(/^timetable-item-/)).toHaveCount(2);
  await expect(page.getByTestId("timetable-item-timetable_family_dinner")).toBeVisible();
  await expect(page.getByTestId("timetable-item-timetable_grocery")).toBeVisible();

  await filters.getByRole("button", { name: "照护", exact: true }).click();
  await expect(timetable.getByTestId(/^timetable-item-/)).toHaveCount(0);
  await expect(page.getByText("当前筛选下没有安排。清除筛选即可回到全家一周。")).toBeVisible();

  await page.getByTestId("timetable-filter-all").click();
  await filters.getByRole("button", { name: "照护", exact: true }).click();
  await expect(timetable.getByTestId(/^timetable-item-/)).toHaveCount(2);
  await expect(page.getByTestId("timetable-item-timetable_medicine")).toBeVisible();
  await expect(page.getByTestId("timetable-item-timetable_walk")).toBeVisible();
});

test("persists structured timetable creation across reload", async ({ page }) => {
  const title = "周日家庭视频通话";
  const form = page.getByTestId("add-item-form");
  await form.getByLabel("事项名称").fill(title);
  await form.getByLabel("负责人").selectOption("member_subject");
  await form.getByLabel("类别").selectOption("family");
  await form.getByLabel("开始时间").fill("2026-08-30T14:30");
  await form.getByLabel("时长").selectOption("60");
  await form.getByLabel("责任域").selectOption("domain_home");
  await form.getByRole("button", { name: "添加到日程" }).click();

  await expect(page.getByRole("status")).toContainText("日程已添加");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const created = (await getState(page.request, "primary")).timetableItems.find(
    (item) => item.title === title,
  );
  expect(created).toBeDefined();
  if (!created) throw new Error("Created timetable item was not returned.");
  expect(created).toMatchObject({
    ownerId: "member_subject",
    category: "family",
    domainId: "domain_home",
    status: "planned",
    startsAt: "2026-08-30T06:30:00.000Z",
    endsAt: "2026-08-30T07:30:00.000Z",
  });

  await page.reload();
  await expect(page.getByTestId("timetable-grid")).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  expect((await getState(page.request, "primary")).timetableItems.find(({ id }) => id === created.id)).toMatchObject({
    startsAt: "2026-08-30T06:30:00.000Z",
    endsAt: "2026-08-30T07:30:00.000Z",
  });
});

test("refuses non-owner completion and persists the owner's explicit completion", async ({ page }) => {
  const itemId = "timetable_family_dinner";
  await page.getByTestId(`timetable-item-${itemId}`).click();
  const nonOwnerButton = page.getByTestId(`complete-item-${itemId}`);
  await expect(nonOwnerButton).toBeDisabled();
  await expect(nonOwnerButton).toHaveText("仅负责人可完成");

  const refusal = await page.request.post("/api/demo/action?role=primary", {
    data: { type: "complete_timetable_item", itemId },
  });
  expect(refusal.status()).toBe(403);
  expect(await refusal.json()).toEqual({
    error: {
      code: "forbidden",
      message: "Only the timetable owner can complete this item.",
    },
  });
  expect((await getState(page.request, "primary")).timetableItems.find(({ id }) => id === itemId)?.status).toBe("planned");

  await switchRole(page, "partner");
  await page.getByTestId(`timetable-item-${itemId}`).click();
  const ownerButton = page.getByTestId(`complete-item-${itemId}`);
  await expect(ownerButton).toBeEnabled();
  await ownerButton.click();
  await expect(page.getByRole("status")).toContainText("这项安排已完成");
  await expect(page.getByTestId(`timetable-item-${itemId}`)).toContainText("已完成");

  await page.reload();
  await expect(page.getByTestId(`timetable-item-${itemId}`)).toContainText("已完成");
  expect((await getState(page.request, "partner")).timetableItems.find(({ id }) => id === itemId)?.status).toBe("completed");
});

test("all member Agent intents stay read-only, role-safe, and honestly labelled as Fixture", async ({ page }) => {
  const before = await getState(page.request, "partner");
  const visibleItemIds = new Set(before.timetableItems.map(({ id }) => id));

  for (const targetMemberId of targetMemberIds) {
    for (const intentHint of expectedAgentIntents) {
      const response = await page.request.post("/api/demo/agent?role=partner", {
        data: {
          targetMemberId,
          message: `请回答 ${intentHint}`,
          intentHint,
        },
      });
      expect(response.ok()).toBeTruthy();
      const answer = (await response.json()) as AgentQueryResponse;
      expect(answer.intent).toBe(intentHint);
      expect(answer.targetMemberId).toBe(targetMemberId);
      expect(answer.engine).toBe("fixture_intent_router");
      expect(answer.text.trim().length).toBeGreaterThan(0);
      const serializedAnswer = JSON.stringify(answer);
      expect(serializedAnswer).not.toContain(privateEvidenceText);
      for (const hiddenTitle of hiddenPrimaryItemTitles) {
        expect(serializedAnswer).not.toContain(hiddenTitle);
      }
      expect(answer.referencedItemIds.every((id) => visibleItemIds.has(id))).toBeTruthy();
      for (const hiddenId of hiddenPrimaryItemIds) {
        expect(serializedAnswer).not.toContain(hiddenId);
      }
    }
  }

  expect(await getState(page.request, "partner")).toEqual(before);

  await page.getByTestId("member-agent-member_subject").click();
  await page.getByTestId("agent-message").fill("这周有什么安排？");
  await page.getByTestId("agent-send").click();
  const uiAnswer = page.getByTestId("agent-response");
  await expect(uiAnswer).toContainText("回答引擎：Fixture 意图路由器 · schedule");
  await expect(uiAnswer).not.toContainText(privateEvidenceText);
});
