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
  const notice = page.locator("#anonymousWelcome");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    translations.en.moderation_unavailable_safety,
  );
  await expect(notice).toContainText(
    translations.en.moderation_unavailable_recruitment,
  );
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
    const notice = page.locator("#anonymousWelcome");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      translations[language].moderation_unavailable_title,
    );
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
