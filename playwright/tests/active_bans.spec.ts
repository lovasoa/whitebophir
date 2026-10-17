import translations from "../../server/http/translations.json";
import { createBoardPage, expect, test } from "../fixtures/test";
import { TOKENS } from "../helpers/tokens";

const moderationTest = test.extend({ serverOptions: { useJWT: true } });

moderationTest(
  "users menu shows active bans and moderators can unban",
  async ({ boardPage, browser, page, server }) => {
    const boardName = "active-bans-menu";
    const targetContext = await browser.newContext();
    const viewerContext = await browser.newContext();
    const targetPage = await targetContext.newPage();
    const viewerPage = await viewerContext.newPage();
    const targetBoard = createBoardPage(targetPage, server);
    const viewerBoard = createBoardPage(viewerPage, server);
    try {
      await boardPage.setSocketHeaders({ "X-Forwarded-For": "198.51.100.130" });
      await targetBoard.setSocketHeaders({
        "X-Forwarded-For": "198.51.100.131",
      });
      await viewerBoard.setSocketHeaders({
        "X-Forwarded-For": "198.51.100.132",
      });
      await Promise.all([
        boardPage.gotoBoard(boardName, { token: TOKENS.globalModerator }),
        targetBoard.gotoBoard(boardName, { token: TOKENS.globalEditor }),
        viewerBoard.gotoBoard(boardName, { token: TOKENS.globalEditor }),
      ]);
      await Promise.all([
        boardPage.waitForSocketConnected(),
        targetBoard.waitForSocketConnected(),
        viewerBoard.waitForSocketConnected(),
      ]);
      const targetId = await targetPage.evaluate(
        () => window.WBOApp.connection.socket?.id,
      );
      await boardPage.connectedUsersToggle.click();
      await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(3);
      const section = page.locator(".active-bans-section");
      await expect(section).toBeHidden();
      const targetRow = page.locator(
        `#connectedUsersList [data-socket-id="${targetId}"]`,
      );
      const targetName = await targetRow
        .locator(".connected-user-name-text")
        .innerText();
      // Hostile socket requests must leave the target available for a valid UI ban.
      await page.evaluate((socketId) => {
        const socket = window.WBOApp.connection.socket;
        if (!socket) throw new Error("Missing socket");
        const emit = socket.emit.bind(socket) as (
          event: string,
          payload: unknown,
        ) => void;
        emit("report_user", { socketId, banDurationMs: 900_000 });
        emit("report_user", {
          socketId,
          banDurationMs: 900_000,
          moderationRule: "unknown",
        });
        emit("report_user", {
          socketId,
          banDurationMs: 1000,
          moderationRule: "harassment",
        });
      }, targetId);
      await targetRow.hover();
      await targetRow.locator(".connected-user-report").click();
      await page.getByRole("button", { name: "15m", exact: true }).click();
      await page
        .getByRole("button", {
          name: translations.en.rules_harassment_title,
          exact: true,
        })
        .click();
      if (!(await boardPage.connectedUsersPanel.isVisible()))
        await boardPage.connectedUsersToggle.click();
      await expect(section).toBeVisible();
      await expect(section.locator("summary")).toHaveText("Active bans (1)");
      await expect(section).not.toHaveAttribute("open");
      await expect(section.locator(".active-ban-name")).toBeHidden();
      await section.locator("summary").click();
      await expect(section.locator(".active-ban-name")).toHaveText(targetName);
      await expect(section.locator("time")).toContainText("Banned at ");
      await expect(section.locator("time")).toHaveAttribute(
        "datetime",
        /^\d{4}-\d\d-\d\dT/,
      );
      await expect(section).toContainText(
        translations.en.rules_harassment_title,
      );
      await expect(
        page.getByRole("button", { name: `Unban ${targetName}`, exact: true }),
      ).toBeVisible();
      await viewerBoard.connectedUsersToggle.click();
      const viewerSection = viewerPage.locator(".active-bans-section");
      await expect(viewerSection).toBeVisible();
      await expect(viewerSection).not.toHaveAttribute("open");
      await viewerSection.locator("summary").click();
      await expect(viewerSection.locator(".active-ban-name")).toHaveText(
        targetName,
      );
      await expect(viewerSection.locator("button")).toHaveCount(0);
      // Fresh connections get the same authoritative list while the ban is active.
      await targetPage.reload();
      await targetBoard.waitForSocketConnected();
      await expect
        .poll(() => targetPage.evaluate(() => window.WBOApp.access.canEdit))
        .toBe(false);
      await targetBoard.connectedUsersToggle.click();
      await expect(
        targetPage.locator(".active-bans-section summary"),
      ).toHaveText("Active bans (1)");
      await page
        .getByRole("button", { name: `Unban ${targetName}`, exact: true })
        .click();
      await expect(section).toBeHidden();
      await expect(viewerSection).toBeHidden();
      await expect(targetPage.locator(".active-bans-section")).toBeHidden();
      await expect
        .poll(() =>
          targetPage.evaluate(() => ({
            canEdit: window.WBOApp.access.canEdit,
            canReport: window.WBOApp.access.canReport,
          })),
        )
        .toEqual({ canEdit: true, canReport: true });
      await targetBoard.waitForToolBooted("rectangle");
      await targetBoard.drawRectangle(
        "#123456",
        { x: 400, y: 400 },
        { x: 600, y: 600 },
      );
      await expect(
        page.locator("#drawingArea rect[stroke='#123456']"),
      ).toBeVisible();
    } finally {
      await targetContext.close();
      await viewerContext.close();
    }
  },
);
