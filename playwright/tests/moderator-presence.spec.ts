import translations from "../../server/http/translations.json";
import { createBoardPage, expect, test as base } from "../fixtures/test";

const moderatorSecret = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const test = base.extend({
  serverOptions: {
    useJWT: false,
    env: {
      WBO_MODERATOR_REQUIRED_BOARDS: "anonymous,moderated",
      WBO_BOARD_MODERATORS: `anonymous:${moderatorSecret} moderated:${moderatorSecret}`,
    },
  },
});

test("the no-moderator action opens a new writable private board", async ({
  page,
  boardPage,
}) => {
  await boardPage.gotoBoard("anonymous");
  const notice = page.locator("#boardNotice");
  const createBoard = notice.getByRole("link", {
    name: translations.en.create_private_board,
  });
  await expect(createBoard).toBeVisible();
  await expect(createBoard).toHaveAttribute("href", "../random");
  await createBoard.click();
  await expect(page).toHaveURL(/\/boards\/(?!anonymous(?:[?#]|$))[^/?#]+$/);
  await boardPage.waitForSocketConnected();
  await expect
    .poll(() => page.evaluate(() => window.WBOApp.access.canEdit))
    .toBe(true);
  await expect(notice).toBeHidden();
  await boardPage.selectTool("text");
  await page.mouse.click(260, 240);
  await page.locator("#textToolInput").fill("Private board");
  await expect(page.locator("#drawingArea text")).toHaveText("Private board");
});

test("moderators do not see the no-moderator notice while their connection is pending", async ({
  page,
  context,
  boardPage,
  server,
}, testInfo) => {
  await context.addCookies([
    {
      name: "wbo-user-secret-v1",
      value: moderatorSecret,
      url: server.serverUrl,
    },
  ]);
  let releaseConnection!: () => void;
  const connectionReady = new Promise<void>((resolve) => {
    releaseConnection = resolve;
  });
  await page.route("**/socket.io/**", async (route) => {
    if (route.request().resourceType() !== "script") await connectionReady;
    await route.continue();
  });
  try {
    await boardPage.gotoBoard("moderated");
    await expect
      .poll(() => page.evaluate(() => window.WBOApp.access.boardState))
      .toMatchObject({
        canBan: true,
        canEdit: false,
        moderationUnavailable: true,
      });
    await expect(page.locator("#boardNotice")).toBeHidden();
    await expect(
      boardPage.tool("hand").locator(".secondaryIcon"),
    ).toBeVisible();
    await expect(boardPage.statusTitle).toHaveText(translations.en.loading);
    await page.screenshot({
      path: testInfo.outputPath("moderator-connecting.png"),
    });
    releaseConnection();
    await boardPage.waitForSocketConnected();
    await expect
      .poll(() => page.evaluate(() => window.WBOApp.access.canEdit))
      .toBe(true);
    await expect(page.locator("#boardNotice")).toBeHidden();
  } finally {
    releaseConnection();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("selection follows live edit access and cancels an interrupted move", async ({
  page,
  boardPage,
  browser,
  server,
}, testInfo) => {
  await server.writeBoard(server.dataPath, "moderated", {
    shape: {
      type: "rect",
      id: "shape",
      tool: "rectangle",
      x: 360,
      y: 320,
      x2: 420,
      y2: 360,
      color: "#123456",
      size: 4,
    },
  });
  await boardPage.gotoBoard("moderated");
  await boardPage.waitForSocketConnected();
  await page.evaluate(() => window.WBOApp.viewportState.controller.setScale(1));
  await page.locator("#boardNoticeDismiss").click();
  await expect(boardPage.tool("rectangle")).toBeHidden();
  // Incoming replay can mount a tool before the viewer can use its button.
  await page.evaluate(async () => {
    await window.WBOApp.toolRegistry.bootTool("rectangle");
  });
  await boardPage.selectTool("hand");
  const shape = page.locator("#shape");
  await shape.click({ position: { x: 1, y: 20 } });
  const download = page.locator("#selectionButton-download");
  const scaleHandle = page.locator("#selectionButton-scaleHandle");
  await expect(download).toBeVisible();
  await expect(scaleHandle).toBeHidden();

  const moderator = await browser.newContext();
  let committedTransform: string | null = null;
  try {
    await moderator.addCookies([
      {
        name: "wbo-user-secret-v1",
        value: moderatorSecret,
        url: server.serverUrl,
      },
    ]);
    const moderatorBoard = createBoardPage(await moderator.newPage(), server);
    await moderatorBoard.gotoBoard("moderated");
    await boardPage.waitForBoardWritable();
    await expect(scaleHandle).toBeVisible();
    await expect(download).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("editable-selector.png"),
    });

    const bounds = await shape.boundingBox();
    if (!bounds) throw new Error("Missing selection shape");
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y);
    await page.mouse.up();
    await server.waitForStoredBoard(
      server.dataPath,
      "moderated",
      (storedBoard) => storedBoard.shape?.transform?.e === 40,
    );
    committedTransform = await shape.getAttribute("transform");

    await page.keyboard.press("r");
    await boardPage.expectCurrentTool("rectangle");
    await boardPage.selectTool("hand");
    await shape.click({ position: { x: 1, y: 20 } });
    await expect(scaleHandle).toBeVisible();
    await page.mouse.move(x + 40, y);
    await page.mouse.down();
    await expect(download).toBeHidden();
    await page.evaluate(
      ({ x, y }) => {
        // Force a preview frame without submitting another transform.
        const now = performance.now;
        performance.now = () => 0;
        try {
          document.getElementById("board")?.dispatchEvent(
            new MouseEvent("mousemove", {
              clientX: x + 65,
              clientY: y,
              buttons: 1,
              cancelable: true,
            }),
          );
        } finally {
          performance.now = now;
        }
      },
      { x, y },
    );
    await expect(shape).not.toHaveAttribute(
      "transform",
      committedTransform ?? "",
    );
  } finally {
    await moderator.close();
  }
  await expect(boardPage.tool("rectangle")).toBeHidden();
  await expect(page.locator("#selectionRectOverlay")).toBeHidden();
  await page.mouse.move(650, 370);
  await page.mouse.up();
  await expect(shape).toHaveAttribute("transform", committedTransform ?? "");
  await expect(page.locator("html")).toHaveAttribute(
    "data-active-tool-mode",
    "Selector",
  );
  await page.locator("#boardNoticeDismiss").click();
  await shape.click({ position: { x: 1, y: 20 } });
  await expect(download).toBeVisible();
  await expect(scaleHandle).toBeHidden();
});

test("moderator presence resumes editing and personal-info publications alert moderators", async ({
  page,
  context,
  boardPage,
  browser,
  server,
}, testInfo) => {
  await context.addCookies([
    {
      name: "wbo_anonymous_welcome_v1",
      value: "dismissed",
      url: server.serverUrl,
    },
  ]);
  await boardPage.gotoBoard("anonymous");
  const notice = page.locator("#boardNotice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    translations.en.moderation_unavailable_message,
  );
  await expect(notice.locator("p")).toHaveCount(1);
  await expect(notice).not.toContainText(/sex|predator/i);
  await expect
    .poll(() => page.evaluate(() => window.WBOApp?.access.canEdit))
    .toBe(false);
  await expect(boardPage.tool("pencil")).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("unmoderated-desktop.png"),
  });
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toBeHidden();
  await expect(boardPage.statusTitle).toHaveText(
    translations.en.moderation_unavailable_title,
  );

  const moderatorContext = await browser.newContext();
  try {
    await moderatorContext.addCookies([
      {
        name: "wbo-user-secret-v1",
        value: moderatorSecret,
        url: server.serverUrl,
      },
      {
        name: "wbo_anonymous_welcome_v1",
        value: "dismissed",
        url: server.serverUrl,
      },
    ]);
    const moderatorPage = await moderatorContext.newPage();
    const moderatorBoard = createBoardPage(moderatorPage, server);
    await moderatorBoard.gotoBoard("anonymous");
    await expect
      .poll(() => page.evaluate(() => window.WBOApp?.access.canEdit))
      .toBe(true);
    await expect(notice).toBeHidden();
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.selectTool("text");
    await page.mouse.click(260, 240);
    await page.locator("#textToolInput").fill("alex@example.org");
    await expect(page.locator("#textPrivacyWarning")).toBeVisible();
    await expect(moderatorBoard.statusTitle).toContainText("Automatic report:");
    await expect(moderatorBoard.statusTitle).toContainText(
      "despite the warning",
    );
    await expect(moderatorBoard.statusTitle).not.toContainText(
      "alex@example.org",
    );
    await expect(moderatorPage.locator("#drawingArea text")).toHaveText(
      "alex@example.org",
    );
    await moderatorPage.screenshot({
      path: testInfo.outputPath("auto-report.png"),
    });
  } finally {
    await moderatorContext.close();
  }
  await expect
    .poll(() => page.evaluate(() => window.WBOApp?.access.canEdit))
    .toBe(false);
  await expect(notice).toBeVisible();
  await expect(boardPage.tool("text")).toBeHidden();
  await expect(page.locator("#textPrivacyWarning")).toBeHidden();
  await page.setViewportSize({ width: 360, height: 640 });
  await page.screenshot({
    path: testInfo.outputPath("unmoderated-mobile.png"),
  });
});

for (const language of ["ar", "fr", "ja", "my", "ru"] as const) {
  test(`moderation notice fits a narrow screen in ${language}`, async ({
    page,
    boardPage,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await boardPage.gotoBoard("moderated", { lang: language });
    const notice = page.locator("#boardNotice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      translations[language].moderation_unavailable_title,
    );
    await expect(notice.locator("p")).toHaveText(
      translations[language].moderation_unavailable_message,
    );
    await expect(
      notice.getByRole("link", {
        name: translations[language].create_private_board,
      }),
    ).toBeVisible();
    await expect(notice).toHaveAttribute(
      "dir",
      language === "ar" ? "rtl" : "ltr",
    );
    const bounds = await notice.boundingBox();
    if (!bounds) throw new Error("Moderation notice has no visible bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(60);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    expect(
      await notice.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await notice.locator("button").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`unmoderated-${language}.png`),
    });
    await notice.locator("button").click();
    await expect(notice).toBeHidden();
  });
}
