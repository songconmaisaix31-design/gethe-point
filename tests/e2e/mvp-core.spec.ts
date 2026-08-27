import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  MVP_CORE_FIXTURE,
  MVP_CORE_SCENARIO_ID,
  MVP_CORE_SEAM,
  MvpCoreCommandResponseSchema,
  MvpCoreSnapshotSchema,
  type MvpCoreCommand,
  type MvpCoreCommandResponse,
  type MvpCoreSnapshot,
} from "../../packages/testkit/src/index";

type FixtureRole = "primary" | "partner" | "subject";

const ids = MVP_CORE_SEAM.testIds;

const fixtureUrl = (role: FixtureRole): string => {
  const query = new URLSearchParams({
    [MVP_CORE_SEAM.query.scenario]: MVP_CORE_SCENARIO_ID,
    [MVP_CORE_SEAM.query.role]: role,
  });
  return `${MVP_CORE_SEAM.pagePath}?${query.toString()}`;
};

const readJson = async (response: { json(): Promise<unknown> }): Promise<unknown> =>
  response.json();

const resetFixture = async (request: APIRequestContext): Promise<void> => {
  const response = await request.post(MVP_CORE_SEAM.api.resetPath, {
    data: { scenarioId: MVP_CORE_SCENARIO_ID },
  });
  expect(response.status()).toBe(204);
};

const readState = async (request: APIRequestContext): Promise<MvpCoreSnapshot> => {
  const query = new URLSearchParams({ scenario: MVP_CORE_SCENARIO_ID });
  const response = await request.get(`${MVP_CORE_SEAM.api.statePath}?${query.toString()}`);
  expect(response.status()).toBe(200);
  return MvpCoreSnapshotSchema.parse(await readJson(response));
};

const sendCommand = async (
  request: APIRequestContext,
  role: FixtureRole,
  command: MvpCoreCommand,
  targetId?: string,
): Promise<Readonly<{ status: number; body: MvpCoreCommandResponse }>> => {
  const response = await request.post(MVP_CORE_SEAM.api.commandPath, {
    data: {
      scenarioId: MVP_CORE_SCENARIO_ID,
      role,
      command,
      ...(targetId === undefined ? {} : { targetId }),
    },
  });
  return {
    status: response.status(),
    body: MvpCoreCommandResponseSchema.parse(await readJson(response)),
  };
};

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

test.describe("@mvp-core @fixture canonical journey", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request);
  });

  test("happy path persists consent, report, handover, owner, and reminder @mvp-core @fixture", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixtureUrl("subject"));
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
    expect(await readState(request)).toMatchObject({ consent: "shared", sharedRows: 1 });

    await page.goto(fixtureUrl("primary"));
    await expectTruthBoundary(page);
    await page.getByTestId(ids.generateReport).click();
    await expect(page.getByTestId(ids.report)).toContainText(
      MVP_CORE_FIXTURE.responsibility.report.narrative,
    );
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("blocked");
    await expect(page.getByTestId(ids.handoverCard)).toContainText(
      MVP_CORE_FIXTURE.handover.blocked.missingInfo[0].label,
    );
    await expect(page.getByTestId(ids.supplyHandoverInfo)).toHaveText(
      MVP_CORE_FIXTURE.handover.supplyAction.label,
    );
    await expect(page.getByTestId(ids.domainOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.primary,
    );
    await expect(page.getByTestId(ids.reminderOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.primary,
    );

    await page.getByTestId(ids.supplyHandoverInfo).click();
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("awaiting_confirmations");
    expect(await readState(request)).toMatchObject({
      handover: { status: "awaiting_confirmations", fromConfirmed: false, toConfirmed: false },
      domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
    });

    await page.getByTestId(ids.confirmFrom).click();
    await expect(page.getByTestId(ids.fromConfirmation)).toHaveText("confirmed");
    await expect(page.getByTestId(ids.toConfirmation)).toHaveText("pending");
    expect(await readState(request)).toMatchObject({
      handover: { status: "awaiting_confirmations", fromConfirmed: true, toConfirmed: false },
      domainOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
      reminderOwnerId: MVP_CORE_FIXTURE.actors.primary.memberId,
    });

    await page.goto(fixtureUrl("partner"));
    await expectTruthBoundary(page);
    await expect(page.getByTestId(ids.confirmTo)).toBeVisible();
    await page.getByTestId(ids.confirmTo).click();
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("accepted");
    await expect(page.getByTestId(ids.domainOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    await expect(page.getByTestId(ids.reminderOwner)).toContainText(
      MVP_CORE_FIXTURE.display.memberNames.partner,
    );
    expect(await readState(request)).toMatchObject({
      handover: { status: "accepted", fromConfirmed: true, toConfirmed: true },
      domainOwnerId: MVP_CORE_FIXTURE.actors.partner.memberId,
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

  test("no consent produces zero shared writes @mvp-core @fixture", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixtureUrl("subject"));
    await page.getByTestId(ids.noConsent).click();
    const publish = await sendCommand(request, "subject", "publish_consented_signal");

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
    request,
  }) => {
    const blocked = await sendCommand(request, "primary", "confirm_handover_from");
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

    expect((await sendCommand(request, "primary", "supply_handover_info")).status).toBe(200);
    const oneSided = await sendCommand(request, "primary", "confirm_handover_from");
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

    await page.goto(fixtureUrl("partner"));
    await expect(page.getByTestId(ids.handoverStatus)).toHaveText("awaiting_confirmations");
    await expect(page.getByTestId(ids.acceptHandover)).toHaveCount(0);
  });

  test("partner cannot probe or share the subject private message @mvp-core @fixture", async ({
    request,
  }) => {
    const guessedMessageId = MVP_CORE_FIXTURE.privateConversation.message.id;
    const read = await sendCommand(request, "partner", "read_private_message", guessedMessageId);
    const share = await sendCommand(
      request,
      "partner",
      "share_private_message",
      guessedMessageId,
    );

    expect(read).toMatchObject({ status: 404, body: { ok: false, code: "not_found" } });
    expect(share).toMatchObject({ status: 404, body: { ok: false, code: "not_found" } });
    expect(JSON.stringify([read.body, share.body])).not.toContain(
      MVP_CORE_FIXTURE.privateConversation.message.content,
    );
    expect(await readState(request)).toMatchObject({
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  test("unknown and client-owned scenario data are rejected with zero writes @mvp-core @fixture", async ({
    request,
  }) => {
    const unknownResponse = await request.post(MVP_CORE_SEAM.api.commandPath, {
      data: {
        scenarioId: "mvp-core-unknown",
        role: "subject",
        command: "record_share_consent",
      },
    });
    const unknown = MvpCoreCommandResponseSchema.parse(await readJson(unknownResponse));
    expect(unknownResponse.status()).toBe(404);
    expect(unknown).toMatchObject({ ok: false, code: "unknown_scenario" });

    const tamperedResponse = await request.post(MVP_CORE_SEAM.api.commandPath, {
      data: {
        scenarioId: MVP_CORE_SCENARIO_ID,
        role: "subject",
        command: "record_share_consent",
        actorId: MVP_CORE_FIXTURE.actors.primary.memberId,
        spaceId: MVP_CORE_FIXTURE.ids.space,
        content: "client controlled content",
      },
    });
    const tampered = MvpCoreCommandResponseSchema.parse(await readJson(tamperedResponse));
    expect(tamperedResponse.status()).toBe(400);
    expect(tampered).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await readState(request)).toMatchObject({
      revision: 0,
      writeCount: 0,
      sharedRows: 0,
      sharedWriteCount: 0,
    });
  });

  test("desktop rail and three phone surfaces preserve focused Style A geometry @mvp-core @fixture", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(fixtureUrl("primary"));
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

    const paddingRange = MVP_CORE_FIXTURE.layoutAcceptance.styleA.cardVerticalPaddingPx;
    const assertCardGeometry = async (card: Locator, minimumHeight: number): Promise<void> => {
      const geometry = await card.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          paddingTop: Number.parseFloat(style.paddingTop),
          paddingBottom: Number.parseFloat(style.paddingBottom),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(geometry.paddingTop).toBeGreaterThanOrEqual(paddingRange.minimum);
      expect(geometry.paddingTop).toBeLessThanOrEqual(paddingRange.maximum);
      expect(geometry.paddingBottom).toBeGreaterThanOrEqual(paddingRange.minimum);
      expect(geometry.paddingBottom).toBeLessThanOrEqual(paddingRange.maximum);
      expect(geometry.height).toBeGreaterThanOrEqual(minimumHeight);
    };

    await assertCardGeometry(
      page.getByTestId(ids.responsibilityCard),
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.responsibilityMinimumHeightPx,
    );
    await assertCardGeometry(
      page.getByTestId(ids.handoverCard),
      MVP_CORE_FIXTURE.layoutAcceptance.styleA.handoverMinimumHeightPx,
    );
  });
});
