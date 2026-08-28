import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  MVP_CORE_COMMANDS,
  MVP_CORE_FIXTURE,
  MVP_CORE_SEAM,
  MvpCoreCommandResponseSchema,
  MvpCoreSnapshotSchema,
  type MvpCoreCommandRequest,
  type MvpCoreCommandResponse,
  type MvpCoreSnapshot,
} from "../../packages/testkit/src/index";

type FixtureRole = (typeof MVP_CORE_FIXTURE.roles)[number];
type CardZoneIds = (typeof MVP_CORE_SEAM.testIds.cards)[keyof typeof MVP_CORE_SEAM.testIds.cards];

const ids = MVP_CORE_SEAM.testIds;

const roleSurfaceIds = Object.freeze({
  primary: ids.primarySurface,
  partner: ids.partnerSurface,
  subject: ids.subjectSurface,
} as const satisfies Readonly<Record<FixtureRole, string>>);

const primaryActionIds = Object.freeze({
  primary: ids.supplyHandoverInfo,
  partner: ids.confirmTo,
  subject: ids.shareConsent,
} as const satisfies Readonly<Record<FixtureRole, string>>);

const cardZonesByRole = Object.freeze({
  primary: Object.freeze([ids.cards.report, ids.cards.handover]),
  partner: Object.freeze([ids.cards.responsibility]),
  subject: Object.freeze([ids.cards.consent]),
} as const satisfies Readonly<Record<FixtureRole, readonly CardZoneIds[]>>);

const cardMinimumHeights = Object.freeze({
  [ids.cards.consent.root]:
    MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.consent.minimumHeightPx,
  [ids.cards.report.root]:
    MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.report.minimumHeightPx,
  [ids.cards.responsibility.root]:
    MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.responsibility.minimumHeightPx,
  [ids.cards.handover.root]:
    MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.handover.minimumHeightPx,
} as const);

const roleNavigationOrder = Object.freeze([
  "partner",
  "subject",
  "primary",
] as const satisfies readonly FixtureRole[]);

const fixtureUrl = (role: FixtureRole): string => {
  const query = new URLSearchParams({
    [MVP_CORE_SEAM.sessionSelection.roleQuery]: role,
  });
  return `${MVP_CORE_SEAM.pagePath}?${query.toString()}`;
};

const readJson = async (response: { json(): Promise<unknown> }): Promise<unknown> =>
  response.json();

const openFixture = async (page: Page, role: FixtureRole): Promise<void> => {
  await page.goto(fixtureUrl(role));
};

const resetFixture = async (page: Page): Promise<void> => {
  const response = await page.request.post(MVP_CORE_SEAM.api.resetPath, { data: {} });
  expect(response.status()).toBe(204);
  await page.reload();
};

const readState = async (request: APIRequestContext): Promise<MvpCoreSnapshot> => {
  const response = await request.get(MVP_CORE_SEAM.api.statePath);
  expect(response.status()).toBe(200);
  return MvpCoreSnapshotSchema.parse(await readJson(response));
};

const sendUnknownCommand = async (
  request: APIRequestContext,
  body: unknown,
): Promise<Readonly<{ status: number; body: MvpCoreCommandResponse }>> => {
  const response = await request.post(MVP_CORE_SEAM.api.commandPath, { data: body });
  return {
    status: response.status(),
    body: MvpCoreCommandResponseSchema.parse(await readJson(response)),
  };
};

const sendCommand = async (
  request: APIRequestContext,
  body: MvpCoreCommandRequest,
): Promise<Readonly<{ status: number; body: MvpCoreCommandResponse }>> =>
  sendUnknownCommand(request, body);

const expectTruthBoundary = async (page: Page): Promise<void> => {
  for (const label of MVP_CORE_FIXTURE.display.truthBadges) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  for (const label of Object.values(MVP_CORE_FIXTURE.display.contractTruthLabels)) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId(ids.fictionalNotice)).toHaveText(
    MVP_CORE_FIXTURE.display.fictionalNotice,
  );
};

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
};

const expectNoPanelHorizontalOverflow = async (locator: Locator): Promise<void> => {
  const geometry = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
};

const expectHorizontallyInsideViewport = async (
  page: Page,
  locator: Locator,
): Promise<void> => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box === null || viewport === null) {
    throw new Error("Expected a visible element inside a configured viewport");
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
};

const expectInsideViewport = async (page: Page, locator: Locator): Promise<void> => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box === null || viewport === null) {
    throw new Error("Expected a visible element inside a configured viewport");
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
};

const expectContainedBy = async (child: Locator, parent: Locator): Promise<void> => {
  const childBox = await child.boundingBox();
  const parentBox = await parent.boundingBox();
  expect(childBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  if (childBox === null || parentBox === null) {
    throw new Error("Expected visible child and parent elements");
  }

  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x);
  expect(childBox.y).toBeGreaterThanOrEqual(parentBox.y);
  expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + parentBox.width);
  expect(childBox.y + childBox.height).toBeLessThanOrEqual(parentBox.y + parentBox.height);
};

const expectNoPairwiseOverlap = async (locators: readonly Locator[]): Promise<void> => {
  const boxes = await Promise.all(locators.map(async (locator) => locator.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
  }

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    const left = boxes[leftIndex];
    if (left === null || left === undefined) {
      throw new Error("Expected visible desktop surfaces");
    }
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const right = boxes[rightIndex];
      if (right === null || right === undefined) {
        throw new Error("Expected visible desktop surfaces");
      }
      const overlaps =
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
      expect(overlaps).toBe(false);
    }
  }
};

const expectOnlySelectedRole = async (
  page: Page,
  selectedRole: FixtureRole,
): Promise<Locator> => {
  for (const role of MVP_CORE_FIXTURE.roles) {
    const surface = page.getByTestId(roleSurfaceIds[role]);
    if (role === selectedRole) {
      await expect(surface).toHaveCount(1);
      await expect(surface).toBeVisible();
    } else {
      await expect(surface).toHaveCount(0);
    }
  }
  return page.getByTestId(roleSurfaceIds[selectedRole]);
};

const expectCompleteTruthLabels = async (page: Page): Promise<void> => {
  const labels = [
    ...MVP_CORE_FIXTURE.display.truthBadges,
    ...Object.values(MVP_CORE_FIXTURE.display.contractTruthLabels),
  ];

  for (const label of labels) {
    const locator = page.getByText(label, { exact: true });
    await expect(locator).toHaveCount(1);
    await expect(locator).toBeVisible();
    const rendered = await locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        text: element.textContent,
        textOverflow: style.textOverflow,
      };
    });
    expect(rendered.text).toBe(label);
    expect(rendered.textOverflow.toLowerCase()).not.toBe("ellipsis");
    expect(rendered.scrollWidth).toBeLessThanOrEqual(rendered.clientWidth + 1);
  }
};

const expectNoDeviceFraming = async (surface: Locator): Promise<void> => {
  const framedElements = await surface.evaluate((element) => {
    const candidates = [element, ...element.querySelectorAll("*")];
    return candidates.flatMap((candidate) => {
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      const borderWidths = [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ].map((value) => Number.parseFloat(value));
      const cornerRadii = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => Number.parseFloat(value));
      const isDeviceFrame =
        rect.width >= 240 &&
        rect.height >= 240 &&
        Math.min(...borderWidths) >= 4 &&
        Math.max(...cornerRadii) >= 20;

      return isDeviceFrame
        ? [{ className: candidate.getAttribute("class"), tagName: candidate.tagName }]
        : [];
    });
  });
  expect(framedElements).toEqual([]);
};

const expectNormalizedCssVariables = async (
  root: Locator,
  expectedVariables: Readonly<Record<string, string>>,
): Promise<void> => {
  const comparisons = await root.evaluate((element, variables) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.append(probe);

    const normalizeColor = (value: string): string => {
      probe.style.color = "";
      probe.style.color = value.trim();
      if (probe.style.color.length === 0) {
        return `invalid:${value.trim().toLowerCase()}`;
      }
      return getComputedStyle(probe).color.replace(/\s+/gu, "").toLowerCase();
    };

    const result = Object.entries(variables).map(([name, expected]) => ({
      actual: normalizeColor(style.getPropertyValue(name)),
      expected: normalizeColor(expected),
      name,
    }));
    probe.remove();
    return result;
  }, expectedVariables);

  for (const comparison of comparisons) {
    expect(comparison.actual, comparison.name).toBe(comparison.expected);
  }
};

const expectPrimaryActionReachable = async (
  page: Page,
  surface: Locator,
  role: FixtureRole,
): Promise<void> => {
  const action = page.getByTestId(primaryActionIds[role]);
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  await expectContainedBy(action, surface);
  await expectInsideViewport(page, action);
  const receivesPointer = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return target !== null && (target === element || element.contains(target));
  });
  expect(receivesPointer).toBe(true);
};

const expectRoleCards = async (page: Page, role: FixtureRole): Promise<void> => {
  for (const card of cardZonesByRole[role]) {
    await expectVerticalCard(page, card, cardMinimumHeights[card.root]);
  }
};

const expectVerticalCard = async (
  page: Page,
  zoneIds: CardZoneIds,
  minimumHeightPx: number,
): Promise<void> => {
  const card = page.getByTestId(zoneIds.root);
  const zones = [
    page.getByTestId(zoneIds.title),
    page.getByTestId(zoneIds.content),
    page.getByTestId(zoneIds.state),
    page.getByTestId(zoneIds.actions),
  ] as const;
  const acceptance = MVP_CORE_FIXTURE.layoutAcceptance.styleA;
  const cardHeight = await card.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(cardHeight).toBeGreaterThanOrEqual(minimumHeightPx);

  const zoneGeometries = await Promise.all(
    zones.map((zone) =>
      zone.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          paddingTop: Number.parseFloat(style.paddingTop),
          paddingBottom: Number.parseFloat(style.paddingBottom),
        };
      }),
    ),
  );
  for (const geometry of zoneGeometries) {
    expect(geometry.paddingTop).toBeGreaterThanOrEqual(
      acceptance.cardVerticalPaddingPx.minimum,
    );
    expect(geometry.paddingTop).toBeLessThanOrEqual(
      acceptance.cardVerticalPaddingPx.maximum,
    );
    expect(geometry.paddingBottom).toBeGreaterThanOrEqual(
      acceptance.cardVerticalPaddingPx.minimum,
    );
    expect(geometry.paddingBottom).toBeLessThanOrEqual(
      acceptance.cardVerticalPaddingPx.maximum,
    );
  }

  const boxes = await Promise.all(zones.map(async (zone) => zone.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
  }
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const current = boxes[index];
    if (previous === null || previous === undefined || current === null || current === undefined) {
      throw new Error("Expected all four vertical card zones to be visible");
    }
    expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height);
  }

  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (first === null || first === undefined || last === null || last === undefined) {
    throw new Error("Expected first and last vertical card zones");
  }
  expect(last.y + last.height - first.y).toBeGreaterThanOrEqual(
    acceptance.zoneSpanPxMinimum,
  );
};

test.describe("@mvp-core @fixture canonical journey", () => {
  test("happy path persists consent, report, handover, owner, reminder, and reload @mvp-core @fixture", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page, "subject");
    await resetFixture(page);
    await expectTruthBoundary(page);
    await expect(page.getByTestId(ids.subjectSurface)).toBeVisible();
    await expect(page.getByTestId(ids.privateMessage)).toHaveText(
      MVP_CORE_FIXTURE.privateConversation.message.content,
    );
    await expectPrimaryActionReachable(page, page.getByTestId(ids.subjectSurface), "subject");
    await expectNoHorizontalOverflow(page);

    await page.getByTestId(ids.shareConsent).click();
    await page.getByTestId(ids.publishSignal).click();
    await expect(page.getByTestId(ids.sharedSignal)).toHaveText(
      MVP_CORE_FIXTURE.privateConversation.consentedSignal.conclusion,
    );
    expect(await readState(page.request)).toMatchObject({
      consent: "shared",
      sharedRows: 1,
    });

    await openFixture(page, "primary");
    await expectTruthBoundary(page);
    await page.getByTestId(ids.generateReport).click();
    await expect(page.getByTestId(ids.report)).toContainText(
      MVP_CORE_FIXTURE.responsibility.report.narrative,
    );
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("blocked");
    await expect(page.getByTestId(ids.cards.handover.content)).toContainText(
      MVP_CORE_FIXTURE.handover.blocked.missingInfo[0].label,
    );
    await expect(page.getByTestId(ids.supplyHandoverInfo)).toHaveText(
      "补齐上次检查结果",
    );
    await expect(page.getByTestId(ids.domainOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.primary,
    );
    await expect(page.getByTestId(ids.reminderOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.primary,
    );

    await page.getByTestId(ids.supplyHandoverInfo).click();
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText(
      "awaiting_confirmations",
    );
    expect(await readState(page.request)).toMatchObject({
      handover: { status: "awaiting_confirmations", fromConfirmed: false, toConfirmed: false },
      domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
    });

    await page.getByTestId(ids.confirmFrom).click();
    await expect(page.getByTestId(ids.fromConfirmation)).toHaveText("confirmed");
    await expect(page.getByTestId(ids.toConfirmation)).toHaveText("pending");
    expect(await readState(page.request)).toMatchObject({
      handover: { status: "awaiting_confirmations", fromConfirmed: true, toConfirmed: false },
      domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
    });

    await openFixture(page, "partner");
    await expectTruthBoundary(page);
    await page.getByTestId(ids.confirmTo).click();
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("accepted");
    await expect(page.getByTestId(ids.domainOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    await expect(page.getByTestId(ids.reminderOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    expect(await readState(page.request)).toMatchObject({
      responsibilityOwners: MVP_CORE_FIXTURE.responsibility.stageOwners,
      handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
      domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
      futureReminderCount: 1,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
    });

    await page.reload();
    await expectTruthBoundary(page);
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("accepted");
    await expect(page.getByTestId(ids.domainOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    await expect(page.getByTestId(ids.reminderOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    await expectNoHorizontalOverflow(page);
  });

  test("no consent produces zero shared writes @mvp-core @fixture", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page, "subject");
    await resetFixture(page);
    await page.getByTestId(ids.noConsent).click();
    const publish = await sendCommand(page.request, {
      command: "publish_consented_signal",
    });

    expect(publish).toMatchObject({
      status: 409,
      body: {
        ok: false,
        code: "consent_required",
        state: { consent: "discarded", sharedRows: 0, sharedWriteCount: 0 },
      },
    });
    await expect(page.getByTestId(ids.sharedRowCount)).toHaveText("0");
  });

  test("blocked and one-sided handover cannot move ownership @mvp-core @fixture", async ({
    page,
  }) => {
    await openFixture(page, "primary");
    await resetFixture(page);
    const blocked = await sendCommand(page.request, {
      command: "confirm_handover_from",
    });
    expect(blocked).toMatchObject({
      status: 409,
      body: {
        ok: false,
        code: "handover_blocked",
        state: {
          handover: { status: "blocked", fromConfirmed: false, toConfirmed: false },
          domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
          reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        },
      },
    });

    expect(
      (await sendCommand(page.request, { command: "supply_handover_info" })).status,
    ).toBe(200);
    const oneSided = await sendCommand(page.request, {
      command: "confirm_handover_from",
    });
    expect(oneSided).toMatchObject({
      status: 200,
      body: {
        ok: true,
        state: {
          handover: {
            status: "awaiting_confirmations",
            fromConfirmed: true,
            toConfirmed: false,
          },
          domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
          reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
        },
      },
    });

    await openFixture(page, "partner");
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText(
      "awaiting_confirmations",
    );
    await expect(page.getByTestId(ids.acceptHandover)).toHaveCount(0);
  });

  test("partner private-message probes and authority tampering fail closed @mvp-core @fixture", async ({
    page,
  }) => {
    await openFixture(page, "partner");
    await resetFixture(page);
    const guessedId = MVP_CORE_FIXTURE.privateConversation.message.id;
    const rawText = MVP_CORE_FIXTURE.privateConversation.message.content;
    const read = await sendCommand(page.request, {
      command: "read_private_message",
      targetId: guessedId,
    });
    const share = await sendCommand(page.request, {
      command: "share_private_message",
      targetId: guessedId,
    });
    expect(read).toMatchObject({ status: 404, body: { ok: false, code: "not_found" } });
    expect(share).toMatchObject({ status: 404, body: { ok: false, code: "not_found" } });

    const tamperedBodies: readonly unknown[] = [
      { command: "read_private_message", targetId: guessedId, subjectId: guessedId },
      { command: "read_private_message", targetId: guessedId, subject: guessedId },
      { command: "read_private_message", targetId: guessedId, role: "subject" },
      {
        command: "read_private_message",
        targetId: guessedId,
        actor: MVP_CORE_FIXTURE.actors.subject,
      },
      { command: "read_private_message", targetId: guessedId, actorId: guessedId },
      { command: "read_private_message", targetId: guessedId, space: MVP_CORE_FIXTURE.space.id },
      { command: "read_private_message", targetId: guessedId, spaceId: MVP_CORE_FIXTURE.space.id },
      { command: "read_private_message", targetId: guessedId, scenario: "mvp-core" },
      { command: "read_private_message", targetId: guessedId, scenarioId: "mvp-core" },
      { command: "read_private_message", targetId: guessedId, content: rawText },
      { command: "read_private_message", targetId: guessedId, privateText: rawText },
    ];
    const tampered = await Promise.all(
      tamperedBodies.map(async (body) => sendUnknownCommand(page.request, body)),
    );
    for (const result of tampered) {
      expect(result).toMatchObject({
        status: 400,
        body: { ok: false, code: "invalid_request" },
      });
    }

    expect(JSON.stringify([read.body, share.body, ...tampered])).not.toContain(rawText);
    expect(await readState(page.request)).toMatchObject({
      revision: 0,
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  test("command bodies are strict and targetId is probe-only @mvp-core @fixture", async ({
    page,
  }) => {
    await openFixture(page, "subject");
    await resetFixture(page);
    const guessedId = MVP_CORE_FIXTURE.privateConversation.message.id;
    const nonProbeCommands = MVP_CORE_COMMANDS.filter(
      (command) =>
        command !== "read_private_message" && command !== "share_private_message",
    );
    const malformedBodies: readonly unknown[] = [
      { command: "read_private_message" },
      {
        command: "record_share_consent",
        scenarioId: MVP_CORE_FIXTURE.scenarioId,
        role: "subject",
      },
      ...nonProbeCommands.map((command) => ({ command, targetId: guessedId })),
    ];
    const results = await Promise.all(
      malformedBodies.map(async (body) => sendUnknownCommand(page.request, body)),
    );

    for (const result of results) {
      expect(result).toMatchObject({
        status: 400,
        body: { ok: false, code: "invalid_request" },
      });
    }
    expect(await readState(page.request)).toMatchObject({
      revision: 0,
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  test("selected-role Web App reflows across desktop, tablet, and mobile @mvp-core @fixture @visual", async ({
    page,
  }) => {
    const acceptance = MVP_CORE_FIXTURE.layoutAcceptance;

    for (const [viewportName, viewport] of Object.entries(acceptance.viewports)) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openFixture(page, "primary");
      await resetFixture(page);
      await expectTruthBoundary(page);
      await expectCompleteTruthLabels(page);
      await expectNoHorizontalOverflow(page);

      const root = page.getByTestId(ids.root);
      const truthBoundary = page.getByRole("note", { name: "Fixture truth boundary" });
      const rail = page.getByTestId(ids.scenarioRail);
      await expectNoPanelHorizontalOverflow(root);
      await expectNoPanelHorizontalOverflow(truthBoundary);
      await expectNormalizedCssVariables(root, acceptance.styleA.cssVariables);

      if (viewportName === "desktop") {
        await expect(rail).toBeVisible();
      }
      if (viewportName === "mobile") {
        const mobileAcceptance = acceptance.selectedRoleWebApp.mobile;
        expect(mobileAcceptance.persistentSidebarVisible).toBe(false);
        expect(mobileAcceptance.compactNavigationVisible).toBe(true);
        await expect(rail).toBeVisible();
        await expectHorizontallyInsideViewport(page, rail);
        await expectNoPanelHorizontalOverflow(rail);

        const roleNavigation = rail.getByRole("navigation", { name: "Fixture 角色导航" });
        const allowedRoles = acceptance.selectedRoleWebApp.roleNavigationTargets;
        expect(allowedRoles).toHaveLength(3);
        await expect(roleNavigation).toBeVisible();
        await expect(roleNavigation.getByRole("link")).toHaveCount(allowedRoles.length);
        for (const role of allowedRoles) {
          const roleLink = roleNavigation.locator(`a[href$="?role=${role}"]`);
          await expect(roleLink).toHaveCount(1);
          await expect(roleLink).toBeVisible();
        }

        const currentStatus = rail.locator('section[aria-live="polite"]');
        await expect(currentStatus).toBeVisible();
        await expect(
          currentStatus.getByText("当前服务端真相", { exact: true }),
        ).toBeVisible();
        const resetAction = rail.getByRole("button", { name: "重置 Fixture" });
        await expect(resetAction).toBeVisible();
        await expect(resetAction).toBeEnabled();
      }

      for (const role of roleNavigationOrder) {
        const navigationLink = rail.locator(`a[href$="?role=${role}"]`);
        await expect(navigationLink).toHaveCount(1);
        await expect(navigationLink).toBeVisible();
        await navigationLink.click();
        await expect(page).toHaveURL(new RegExp(`[?&]role=${role}(?:&|$)`, "u"));
        await expect(rail.locator('a[aria-current="page"]')).toHaveCount(1);
        await expect(navigationLink).toHaveAttribute("aria-current", "page");

        const surface = await expectOnlySelectedRole(page, role);
        await expectHorizontallyInsideViewport(page, surface);
        await expectNoHorizontalOverflow(page);
        await expectNoPanelHorizontalOverflow(root);
        await expectNoPanelHorizontalOverflow(surface);
        await expectNoDeviceFraming(surface);

        if (viewportName === "desktop") {
          const railBox = await rail.boundingBox();
          const surfaceBox = await surface.boundingBox();
          if (railBox === null || surfaceBox === null) {
            throw new Error("Expected a sidebar and selected-role desktop workspace");
          }
          expect(surfaceBox.width).toBeGreaterThan(railBox.width);
          await expectNoPairwiseOverlap([rail, surface]);
        }

        if (viewportName === "tablet" && (await rail.isVisible())) {
          await expectHorizontallyInsideViewport(page, rail);
          await expectNoPanelHorizontalOverflow(rail);
          await expectNoPairwiseOverlap([rail, surface]);
        }

        if (viewportName === "mobile") {
          const railBox = await rail.boundingBox();
          const surfaceBox = await surface.boundingBox();
          const configuredViewport = page.viewportSize();
          if (railBox === null || surfaceBox === null || configuredViewport === null) {
            throw new Error("Expected compact navigation above one full-width mobile workspace");
          }
          expect(railBox.y + railBox.height).toBeLessThanOrEqual(surfaceBox.y + 1);
          const leftGutterPx = surfaceBox.x;
          const rightGutterPx =
            configuredViewport.width - (surfaceBox.x + surfaceBox.width);
          expect(leftGutterPx).toBeGreaterThanOrEqual(0);
          expect(leftGutterPx).toBeLessThanOrEqual(
            acceptance.selectedRoleWebApp.mobile.horizontalGutterPxMaximum,
          );
          expect(rightGutterPx).toBeGreaterThanOrEqual(0);
          expect(rightGutterPx).toBeLessThanOrEqual(
            acceptance.selectedRoleWebApp.mobile.horizontalGutterPxMaximum,
          );
        }

        await expectRoleCards(page, role);
        for (const card of cardZonesByRole[role]) {
          await expectNoPanelHorizontalOverflow(page.getByTestId(card.root));
        }
        await expectPrimaryActionReachable(page, surface, role);
      }
    }
  });
});
