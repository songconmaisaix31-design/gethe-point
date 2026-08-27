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
  const geometry = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingBottom: Number.parseFloat(style.paddingBottom),
      height: element.getBoundingClientRect().height,
    };
  });

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
  expect(geometry.height).toBeGreaterThanOrEqual(minimumHeightPx);

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
    expect(current.y).toBeGreaterThanOrEqual(
      previous.y + previous.height + acceptance.zoneGapPxMinimum,
    );
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
    await expectInsideViewport(page, page.getByTestId(ids.shareConsent));
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

  test("Style A colors, rail, and four deep card zones match runtime styles @mvp-core @fixture", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, "primary");
    await resetFixture(page);
    await expectTruthBoundary(page);
    await expectNoHorizontalOverflow(page);

    const root = page.getByTestId(ids.root);
    const rail = page.getByTestId(ids.scenarioRail);
    const primary = page.getByTestId(ids.primarySurface);
    const partner = page.getByTestId(ids.partnerSurface);
    const subject = page.getByTestId(ids.subjectSurface);
    const surfaces = [primary, partner, subject] as const;

    await expect(rail).toBeVisible();
    for (const surface of surfaces) {
      await expect(surface).toBeVisible();
      await expectInsideViewport(page, surface);
      const box = await surface.boundingBox();
      if (box === null) {
        throw new Error("Expected a visible phone-proportioned role surface");
      }
      expect(box.width).toBeGreaterThanOrEqual(
        MVP_CORE_FIXTURE.layoutAcceptance.styleA.phoneSurfaceWidthPx.minimum,
      );
      expect(box.width).toBeLessThanOrEqual(
        MVP_CORE_FIXTURE.layoutAcceptance.styleA.phoneSurfaceWidthPx.maximum,
      );
      const clipsHorizontally = await surface.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(clipsHorizontally).toBe(false);
    }

    const railBox = await rail.boundingBox();
    if (railBox === null) {
      throw new Error("Expected a visible compact scenario rail");
    }
    expect(railBox.width).toBeLessThanOrEqual(
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.compactRailMaximumWidthPx,
    );
    await expectNoPairwiseOverlap([rail, ...surfaces]);
    await expectContainedBy(page.getByTestId(ids.supplyHandoverInfo), primary);
    await expectContainedBy(page.getByTestId(ids.confirmTo), partner);
    await expectContainedBy(page.getByTestId(ids.shareConsent), subject);

    const expectedVariables = MVP_CORE_FIXTURE.layoutAcceptance.styleA.cssVariables;
    const actualVariables = await root.evaluate(
      (element, names) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(name).trim()]),
        );
      },
      Object.keys(expectedVariables),
    );
    expect(actualVariables).toEqual(expectedVariables);

    await expectVerticalCard(
      page,
      ids.cards.consent,
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.consent.minimumHeightPx,
    );
    await expectVerticalCard(
      page,
      ids.cards.report,
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.report.minimumHeightPx,
    );
    await expectVerticalCard(
      page,
      ids.cards.responsibility,
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.responsibility.minimumHeightPx,
    );
    await expectVerticalCard(
      page,
      ids.cards.handover,
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.coreCards.handover.minimumHeightPx,
    );
  });
});
