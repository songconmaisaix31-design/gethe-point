import { expect, test } from "@playwright/test";

import { getState, postAction, resetDemo, switchRole } from "../helpers/demo";

test.beforeEach(async ({ page, request }) => {
  await resetDemo(request);
  await page.goto("/");
});

test("three role projections keep direct-message evidence private until explicit consent", async ({ page }) => {
  const privateText = "腿又疼了，下楼有点吃力";
  const subject = await getState(page.request, "subject");
  const primary = await getState(page.request, "primary");
  const partner = await getState(page.request, "partner");

  expect(subject.evidence.some(({ text }) => text === privateText)).toBeTruthy();
  expect(primary.evidence.some(({ text }) => text === privateText)).toBeFalsy();
  expect(partner.evidence.some(({ text }) => text === privateText)).toBeFalsy();

  await switchRole(page, "subject");
  await expect(page.getByTestId("subject-chat")).toContainText(privateText);
  await page.getByTestId("consent-space").click();
  await expect(page.locator(".visibility-state")).toContainText("家庭空间");

  const shared = await getState(page.request, "primary");
  expect(shared.evidence.some(({ text, visibility }) => text === privateText && visibility === "space")).toBeTruthy();
});

test("report exposes persisted five-stage attribution with neutral wording", async ({ page }) => {
  await switchRole(page, "primary");
  const report = page.getByTestId("responsibility-report");
  await expect(report).toBeVisible();
  await expect(report).toContainText(/发现|discoveredBy/);
  await expect(report).toContainText(/截止|deadlineKeptBy/);
  await expect(report).toContainText(/安排|scheduledBy/);
  await expect(report).toContainText(/执行|executedBy/);
  await expect(report).toContainText(/跟进|followedUpBy/);
  await expect(report).not.toContainText(/懒|不负责|拖累|排名|评分|诊断/);

  const beforeReload = await getState(page.request, "primary");
  await page.reload();
  const afterReload = await getState(page.request, "primary");
  expect(afterReload.report.tasks).toEqual(beforeReload.report.tasks);
});

test("handover stays blocked until missing info and both confirmations, then transfers atomically", async ({ page }) => {
  await switchRole(page, "primary");
  await expect(page.getByTestId("burden-count")).toHaveText("7");
  await expect(page.getByTestId("handover-status")).toContainText(/blocked|缺少信息/i);

  await page.getByTestId("handover-add-info").click();
  await expect(page.getByTestId("handover-status")).not.toContainText(/accepted|已交接/i);
  await page.getByTestId("handover-confirm").click();
  await expect(page.getByTestId("handover-status")).not.toContainText(/accepted|已交接/i);

  await switchRole(page, "partner");
  await page.getByTestId("handover-confirm").click();
  await expect(page.getByTestId("handover-status")).toContainText(/accepted|已交接/i);

  const state = await getState(page.request, "primary");
  const domain = state.domains.find(({ id }) => id === "domain_health");
  const transferredTasks = state.report.tasks.filter(({ domainId, status }) => domainId === "domain_health" && status === "open");
  expect(domain?.ownerId).toBe("member_partner");
  expect(transferredTasks.length).toBeGreaterThan(0);
  expect(transferredTasks.every(({ futureReminderOwnerId }) => futureReminderOwnerId === "member_partner")).toBeTruthy();

  await switchRole(page, "primary");
  await expect(page.getByTestId("burden-count")).toHaveText("2");
});

test("subject-confirmed care uses deadline equality, ordered escalation, truthful logs, and acknowledgement", async ({ page }) => {
  await switchRole(page, "subject");
  await page.getByTestId("care-activate").click();
  await page.getByTestId("care-trigger").click();
  await page.getByTestId("care-advance").click();

  const timedOut = await getState(page.request, "subject");
  expect(timedOut.careEvents.at(-1)?.state).toBe("escalated");
  const escalationRecipients = timedOut.notificationLogs
    .filter(({ templateId, channel }) => templateId === "care_escalation" && channel === "app")
    .map(({ recipientId }) => recipientId);
  expect(escalationRecipients).toEqual(["member_partner", "member_primary"]);

  await expect(page.getByTestId("notification-log")).toContainText(/App|应用内/);
  await expect(page.getByTestId("notification-log")).toContainText(/Robot A3.*disabled|A3.*未启用/i);
  await expect(page.getByTestId("truth-label")).toContainText(/Fixture|非生产|非真实设备/i);
  await page.getByTestId("care-ack").click();
  expect((await getState(page.request, "subject")).careEvents.at(-1)?.state).toBe("closed");
});

test("notification trigger is deduplicated and reset restores the frozen state", async ({ page }) => {
  await postAction(page.request, {
    type: "activate_care_rule",
    careRuleId: "care_rule_medicine",
    actorId: "member_subject",
    expectedVersion: 0,
  });
  await postAction(page.request, { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" });
  await postAction(page.request, { type: "trigger_care_reminder", careRuleId: "care_rule_medicine" });
  const triggered = await getState(page.request, "subject");
  expect(triggered.notificationLogs.some(({ channel, status }) => channel === "app" && status === "shown_in_app")).toBeTruthy();
  expect(triggered.notificationLogs.some(({ channel, status }) => channel === "robot_a3" && status === "disabled")).toBeTruthy();
  expect(triggered.notificationLogs.some(({ status }) => status === "deduplicated")).toBeTruthy();

  await resetDemo(page.request);
  const reset = await getState(page.request, "subject");
  expect(reset.careRules[0]?.state).toBe("draft");
  expect(reset.careEvents).toEqual([]);
  expect(reset.notificationLogs).toEqual([]);
  expect(reset.handovers[0]?.state).toBe("blocked");
});
