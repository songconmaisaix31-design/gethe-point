import { readFile } from "node:fs/promises";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MVP_CORE_FIXTURE } from "../../../fixtures/mvp-core";
import { ExperienceView } from "../src/components/FixtureExperience";
import { createHttpExperienceClient } from "../src/features/experience/client";
import {
  MVP_CORE_DISPLAY,
  MVP_CORE_TEST_IDS,
} from "../src/features/experience/fixture-display";
import type {
  ExperienceSnapshot,
  MemberRole,
} from "../src/features/experience/model";
import { selectFixtureRole } from "../src/features/experience/role-selection";

const MEMBER_ROLES = ["primary", "partner", "subject"] as const satisfies readonly MemberRole[];

const ALL_CARDS = [
  MVP_CORE_TEST_IDS.cards.consent,
  MVP_CORE_TEST_IDS.cards.report,
  MVP_CORE_TEST_IDS.cards.responsibility,
  MVP_CORE_TEST_IDS.cards.handover,
] as const;

const ALL_ACTIONS = [
  MVP_CORE_TEST_IDS.shareConsent,
  MVP_CORE_TEST_IDS.noConsent,
  MVP_CORE_TEST_IDS.publishSignal,
  MVP_CORE_TEST_IDS.generateReport,
  MVP_CORE_TEST_IDS.supplyHandoverInfo,
  MVP_CORE_TEST_IDS.confirmFrom,
  MVP_CORE_TEST_IDS.confirmTo,
] as const;

const ROLE_ACCEPTANCE = {
  primary: {
    surface: MVP_CORE_TEST_IDS.primarySurface,
    cards: [
      MVP_CORE_TEST_IDS.cards.responsibility,
      MVP_CORE_TEST_IDS.cards.report,
      MVP_CORE_TEST_IDS.cards.handover,
    ],
    actions: [
      MVP_CORE_TEST_IDS.generateReport,
      MVP_CORE_TEST_IDS.supplyHandoverInfo,
      MVP_CORE_TEST_IDS.confirmFrom,
    ],
  },
  partner: {
    surface: MVP_CORE_TEST_IDS.partnerSurface,
    cards: [MVP_CORE_TEST_IDS.cards.responsibility, MVP_CORE_TEST_IDS.cards.handover],
    actions: [MVP_CORE_TEST_IDS.confirmTo],
  },
  subject: {
    surface: MVP_CORE_TEST_IDS.subjectSurface,
    cards: [MVP_CORE_TEST_IDS.cards.consent],
    actions: [
      MVP_CORE_TEST_IDS.shareConsent,
      MVP_CORE_TEST_IDS.noConsent,
      MVP_CORE_TEST_IDS.publishSignal,
    ],
  },
} as const satisfies Readonly<Record<MemberRole, {
  readonly surface: string;
  readonly cards: readonly (typeof ALL_CARDS)[number][];
  readonly actions: readonly string[];
}>>;

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
  selectedRole: MemberRole,
  commandsDisabled = false,
): string =>
  renderToStaticMarkup(
    createElement(ExperienceView, {
      snapshot,
      selectedRole,
      pendingActionId: null,
      error: null,
      commandsDisabled,
      onAction: () => undefined,
      onReload: () => undefined,
    }),
  );

const occurrences = (input: string, value: string): number => input.split(value).length - 1;

const testId = (value: string): string => `data-testid="${value}"`;

const roleLinkTags = (html: string): readonly string[] =>
  (html.match(/<a\b[^>]*>/g) ?? []).filter((tag) => /(?:\?|&amp;|&)role=/.test(tag));

const roleFromLink = (tag: string): string | undefined =>
  /(?:\?|&amp;|&)role=([^&"]+)/.exec(tag)?.[1];

const cssVariable = (css: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*:\\s*([^;]+);`, "i").exec(css)?.[1]?.trim();

const cssRuleBody = (css: string, selector: string): string | undefined =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
    match[1]?.split(",").some((candidate) => candidate.trim() === selector),
  )?.[2];

const cssPixelMinHeight = (css: string, selector: string): number => {
  const value = /min-height\s*:\s*(\d+(?:\.\d+)?)px\s*;/i.exec(
    cssRuleBody(css, selector) ?? "",
  )?.[1];
  if (value === undefined) {
    throw new Error(`${selector} must define a pixel min-height`);
  }
  return Number.parseFloat(value);
};

const normalizeHex = (value: string | undefined): string | null => {
  const digits = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value ?? "")?.[1];
  if (digits === undefined) {
    return null;
  }
  const expanded =
    digits.length === 3
      ? digits.replace(/[\da-f]/gi, (digit) => `${digit}${digit}`)
      : digits;
  return `#${expanded.toLowerCase()}`;
};

describe("selected-role responsive web app contract", () => {
  it("allowlists query roles and exposes one navigation target per role", () => {
    expect(MEMBER_ROLES.map((role) => selectFixtureRole(role))).toEqual(MEMBER_ROLES);
    expect(selectFixtureRole(["partner", "subject"])).toBe("partner");
    expect(selectFixtureRole(undefined)).toBe("primary");
    expect(selectFixtureRole("administrator")).toBe("primary");

    for (const selectedRole of MEMBER_ROLES) {
      const links = roleLinkTags(renderSnapshot(initialSnapshot, selectedRole));
      expect(links.map(roleFromLink)).toEqual(MEMBER_ROLES);
      expect(
        links.filter((link) => link.includes('aria-current="page"')).map(roleFromLink),
      ).toEqual([selectedRole]);
    }
  });

  it("renders only the selected role with one truthful fixture boundary", () => {
    for (const selectedRole of MEMBER_ROLES) {
      const html = renderSnapshot(initialSnapshot, selectedRole);

      expect(occurrences(html, "Fixture truth boundary")).toBe(1);
      expect(
        occurrences(html, testId(ROLE_ACCEPTANCE[selectedRole].surface)),
      ).toBe(1);
      for (const role of MEMBER_ROLES) {
        if (role !== selectedRole) {
          expect(occurrences(html, testId(ROLE_ACCEPTANCE[role].surface))).toBe(0);
        }
      }
    }

    const html = renderSnapshot(initialSnapshot, "primary");
    for (const label of [
      ...MVP_CORE_DISPLAY.truthBadges,
      ...Object.values(MVP_CORE_DISPLAY.contractTruthLabels),
    ]) {
      expect(occurrences(html, `>${label}<`)).toBe(1);
    }
    expect(html).toContain(MVP_CORE_DISPLAY.fictionalNotice);
  });

  it("keeps cards, actions, and private content inside their owning role", () => {
    for (const selectedRole of MEMBER_ROLES) {
      const html = renderSnapshot(initialSnapshot, selectedRole);
      const acceptance = ROLE_ACCEPTANCE[selectedRole];

      for (const card of ALL_CARDS) {
        expect(occurrences(html, testId(card.root))).toBe(
          acceptance.cards.some((ownedCard) => ownedCard.root === card.root) ? 1 : 0,
        );
      }
      for (const action of ALL_ACTIONS) {
        expect(occurrences(html, testId(action))).toBe(
          acceptance.actions.some((ownedAction) => ownedAction === action) ? 1 : 0,
        );
      }

      const privateCount = selectedRole === "subject" ? 1 : 0;
      expect(occurrences(html, testId(MVP_CORE_TEST_IDS.privateMessage))).toBe(privateCount);
      expect(occurrences(html, MVP_CORE_DISPLAY.privateMessage)).toBe(privateCount);
    }
  });

  it("orders each owned card as title, content, state, then actions", () => {
    for (const selectedRole of MEMBER_ROLES) {
      const html = renderSnapshot(initialSnapshot, selectedRole);
      for (const card of ROLE_ACCEPTANCE[selectedRole].cards) {
        const positions = [card.root, card.title, card.content, card.state, card.actions].map(
          (marker) => html.indexOf(testId(marker)),
        );
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((left, right) => left - right));
      }
    }
  });

  it("keeps atomic acceptance facts in their owning roles", async () => {
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
    const snapshot = await client.load();
    const primaryHtml = renderSnapshot(snapshot, "primary");
    const partnerHtml = renderSnapshot(snapshot, "partner");

    expect(primaryHtml).toContain("双方已确认，等待系统完成交接");
    expect(primaryHtml).toContain("系统完成原子接受前，负责人和提醒仍保持原归属");
    expect(primaryHtml).toContain(`${testId(MVP_CORE_TEST_IDS.handoverStatus)}>awaiting_confirmations`);
    expect(primaryHtml).toContain(`${testId(MVP_CORE_TEST_IDS.fromConfirmation)}>confirmed`);
    expect(primaryHtml).toContain(`${testId(MVP_CORE_TEST_IDS.toConfirmation)}>confirmed`);
    expect(primaryHtml).not.toContain(testId(MVP_CORE_TEST_IDS.confirmTo));
    expect(partnerHtml).toContain(testId(MVP_CORE_TEST_IDS.confirmTo));
    expect(partnerHtml).toContain(
      `${testId(MVP_CORE_TEST_IDS.handoverStatus)}>awaiting_confirmations<`,
    );
    expect(partnerHtml).toContain(
      `${testId(MVP_CORE_TEST_IDS.domainOwner)}>当前负责人：${MVP_CORE_DISPLAY.memberNames.primary}<`,
    );
    expect(partnerHtml).toContain(
      `${testId(MVP_CORE_TEST_IDS.reminderOwner)}>${MVP_CORE_DISPLAY.reminder.label} · ${MVP_CORE_DISPLAY.memberNames.primary}<`,
    );
  });

  it("disables selected-role writes while a reload is pending", () => {
    for (const selectedRole of MEMBER_ROLES) {
      const actionButtons = (renderSnapshot(initialSnapshot, selectedRole, true)
        .match(/<button\b[^>]*>/g) ?? [])
        .filter((tag) => /\bclass="[^"]*\baction-button\b/.test(tag));

      expect(actionButtons.length).toBeGreaterThan(0);
      expect(actionButtons.every((tag) => tag.includes('disabled=""'))).toBe(true);
    }
  });

  it("keeps Style A and responsive app-shell CSS without phone showcase assumptions", async () => {
    const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const compactCss = css.replace(/\s+/g, " ");
    const [desktopCss = css] = css.split(/@media\b/i);
    const aliases = [
      ["--style-a-background", "#f4f1ea"],
      ["--style-a-surface", "#ffffff"],
      ["--style-a-text", "#1f1c17"],
      ["--style-a-primary", "#33513f"],
      ["--style-a-accent", "#8a5a3b"],
      ["--style-a-warning", "#9c4e22"],
    ] as const;

    for (const [name, expected] of aliases) {
      expect(normalizeHex(cssVariable(css, name))).toBe(expected);
    }
    const qaCardMinimums = MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards;
    for (const [selector, minimumHeightPx] of [
      [".consent-card", qaCardMinimums.consent.minimumHeightPx],
      [".report-card", qaCardMinimums.report.minimumHeightPx],
      [".responsibility-card", qaCardMinimums.responsibility.minimumHeightPx],
      [".handover-card", qaCardMinimums.handover.minimumHeightPx],
    ] as const) {
      expect(cssPixelMinHeight(desktopCss, selector)).toBeGreaterThanOrEqual(
        minimumHeightPx,
      );
    }

    expect(compactCss).toMatch(/:focus-visible[^}]*outline:\s*(?:[2-9]|\d{2,})px solid[^}]*outline-offset:\s*[1-9]\d*px/i);
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[\s\S]*(?:animation:\s*none|transition-duration:\s*0\.0?1ms)/i);
    expect(css).not.toMatch(/@import\b|url\(\s*["']?(?:https?:)?\/\/|fonts\.googleapis|fonts\.gstatic/i);

    expect(compactCss).toMatch(/\.fixture-shell\s*\{[^}]*height:\s*100dvh/i);
    expect(compactCss).toMatch(/\.fixture-layout\s*\{[^}]*grid-template-columns:\s*(?:(?:minmax|clamp)\([^;]+\)|[1-9]\d*px)\s+minmax\(0,\s*1fr\)/i);
    expect(compactCss).toMatch(/\.role-card-grid\s*\{[^}]*grid-template-columns:\s*(?:repeat\(2,\s*)?minmax\(0,\s*1fr\)\)?/i);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*[5-9]\d{2}px\s*\)[\s\S]*?\.fixture-layout\s*\{[^}]*?(?:display:\s*block|grid-template-columns:\s*1fr)/i);

    expect(compactCss).not.toMatch(/\.role-card-grid\s*\{[^}]*(?:\b304px\b|grid-template-columns:\s*repeat\(3\s*,)/i);
    expect(compactCss).not.toMatch(/\.role-device\s*\{[^}]*(?:border:\s*8px solid|border-radius:\s*30px|#171612)/i);
  });
});
