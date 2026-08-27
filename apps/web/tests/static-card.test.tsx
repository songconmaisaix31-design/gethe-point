import { readFile } from "node:fs/promises";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExperienceView } from "../src/components/FixtureExperience";
import { createHttpExperienceClient } from "../src/features/experience/client";
import {
  MVP_CORE_DISPLAY,
  MVP_CORE_TEST_IDS,
} from "../src/features/experience/fixture-display";
import type { ExperienceSnapshot } from "../src/features/experience/model";

const initialSnapshot: ExperienceSnapshot = {
  stage: "consent",
  stageTitle: "由本人决定是否分享",
  stageSummary: "私聊默认只属于本人；同意与发布是两个独立步骤。",
  report: null,
  server: {
    scenarioId: "mvp-core",
    revision: 0,
    writeCount: 0,
    sharedWriteCount: 0,
    consent: "pending",
    sharedRows: 0,
    reportRows: 0,
    responsibilityOwners: {
      discoveredBy: MVP_CORE_DISPLAY.memberIds.subject,
      deadlineKeptBy: MVP_CORE_DISPLAY.memberIds.primary,
      scheduledBy: MVP_CORE_DISPLAY.memberIds.primary,
      executedBy: MVP_CORE_DISPLAY.memberIds.partner,
      followedUpBy: MVP_CORE_DISPLAY.memberIds.primary,
    },
    domainOwnerId: MVP_CORE_DISPLAY.memberIds.primary,
    futureReminderCount: 1,
    reminderOwnerId: MVP_CORE_DISPLAY.memberIds.primary,
    handover: {
      status: "blocked",
      fromConfirmed: false,
      toConfirmed: false,
    },
  },
};

const renderSnapshot = (
  snapshot: ExperienceSnapshot,
  commandsDisabled = false,
): string =>
  renderToStaticMarkup(
    createElement(ExperienceView, {
      snapshot,
      selectedRole: "primary",
      pendingActionId: null,
      error: null,
      commandsDisabled,
      onAction: () => undefined,
      onReload: () => undefined,
    }),
  );

const renderInitial = (): string => renderSnapshot(initialSnapshot);

const occurrences = (input: string, value: string): number => input.split(value).length - 1;

describe("reset desktop card contract", () => {
  it("renders one truth boundary, three synchronized surfaces, and all canonical display facts", () => {
    const html = renderInitial();

    expect(occurrences(html, "Fixture truth boundary")).toBe(1);
    for (const label of MVP_CORE_DISPLAY.truthBadges) {
      expect(occurrences(html, `>${label}<`)).toBe(1);
    }
    for (const label of Object.values(MVP_CORE_DISPLAY.contractTruthLabels)) {
      expect(occurrences(html, `>${label}<`)).toBe(1);
    }
    expect(html).toContain(MVP_CORE_DISPLAY.fictionalNotice);
    expect(html).toContain(MVP_CORE_DISPLAY.privateMessage);
    expect(html).toContain(MVP_CORE_DISPLAY.memberNames.primary);
    expect(html).toContain(MVP_CORE_DISPLAY.memberNames.partner);
    expect(html).toContain(MVP_CORE_DISPLAY.memberNames.subject);
    expect(occurrences(html, "data-role=")).toBe(3);
    expect(html).toContain(`data-testid="${MVP_CORE_TEST_IDS.subjectSurface}"`);
    expect(html).toContain(`data-testid="${MVP_CORE_TEST_IDS.primarySurface}"`);
    expect(html).toContain(`data-testid="${MVP_CORE_TEST_IDS.partnerSurface}"`);
  });

  it("renders exactly one of each deep card with ordered title, content, state, and actions zones", () => {
    const html = renderInitial();

    for (const card of Object.values(MVP_CORE_TEST_IDS.cards)) {
      const positions = [card.root, card.title, card.content, card.state, card.actions].map(
        (testId) => html.indexOf(`data-testid="${testId}"`),
      );
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(occurrences(html, `data-testid="${card.root}"`)).toBe(1);
    }
  });

  it("keeps reset actions in their owned role surfaces and separates consent from publish", () => {
    const html = renderInitial();
    const primaryStart = html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.primarySurface}"`);
    const partnerStart = html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.partnerSurface}"`);
    const subjectStart = html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.subjectSurface}"`);

    expect(html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.supplyHandoverInfo}"`)).toBeGreaterThan(primaryStart);
    expect(html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.confirmTo}"`)).toBeGreaterThan(partnerStart);
    expect(html.indexOf(`data-testid="${MVP_CORE_TEST_IDS.shareConsent}"`)).toBeGreaterThan(subjectStart);
    expect(html).toContain(">补齐上次检查结果<");
    expect(html).toContain(">告诉家里人<");
    expect(html).toContain(">先别说<");
    expect(html).toContain(">只告诉指定成员<");
    expect(html).toContain(`data-testid="${MVP_CORE_TEST_IDS.publishSignal}"`);
  });

  it("renders both confirmations while atomic system acceptance is still pending", async () => {
    const client = createHttpExperienceClient({
      fetch: () => Promise.resolve(Response.json({
        ...initialSnapshot.server,
        revision: 6,
        writeCount: 6,
        sharedWriteCount: 1,
        consent: "shared",
        sharedRows: 1,
        reportRows: 5,
        handover: {
          status: "awaiting_confirmations",
          fromConfirmed: true,
          toConfirmed: true,
        },
      })),
    });

    const html = renderSnapshot(await client.load());

    expect(html).toContain("双方已确认，等待系统完成交接");
    expect(html).toContain("系统完成原子接受前，负责人和提醒仍保持原归属");
    expect(html).toContain(
      `data-testid="${MVP_CORE_TEST_IDS.handoverStatus}">awaiting_confirmations`,
    );
    expect(html).toContain(
      `data-testid="${MVP_CORE_TEST_IDS.fromConfirmation}">confirmed`,
    );
    expect(html).toContain(
      `data-testid="${MVP_CORE_TEST_IDS.toConfirmation}">confirmed`,
    );
  });

  it("disables every write action while a reload is pending", () => {
    const buttonTags = renderSnapshot(initialSnapshot, true).match(/<button\b[^>]*>/g) ?? [];

    expect(buttonTags.length).toBeGreaterThan(0);
    expect(buttonTags.every((tag) => tag.includes("disabled=\"\""))).toBe(true);
  });

  it("exposes exact Style A aliases, deep geometry, compact rail, and no remote assets", async () => {
    const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

    const aliases = [
      ["--style-a-background", "#F4F1EA"],
      ["--style-a-surface", "#FFFFFF"],
      ["--style-a-text", "#1F1C17"],
      ["--style-a-primary", "#33513F"],
      ["--style-a-accent", "#8A5A3B"],
      ["--style-a-warning", "#9C4E22"],
    ] as const;
    for (const [name, value] of aliases) {
      expect(css).toContain(`${name}: ${value}`);
    }
    expect(css).toContain("grid-template-columns: 250px minmax(0, 1fr)");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 304px))");
    expect(css).toContain("padding: 18px 16px");
    expect(css).toContain("gap: 8px");
    for (const height of [240, 260, 300]) {
      expect(css).toContain(`min-height: ${String(height)}px`);
    }
    expect(css).not.toMatch(/@import|url\(|fonts\.googleapis|fonts\.gstatic/i);
  });
});
