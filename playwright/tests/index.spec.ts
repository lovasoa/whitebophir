import { expect, test } from "../fixtures/test";
import { rootUrl } from "../helpers/testServer";

test.describe("index page board naming", () => {
  test("named board form canonicalizes before navigation", async ({
    page,
    server,
  }) => {
    await page.goto(rootUrl(server.serverUrl));

    const boardInput = page.locator("#board");
    await boardInput.fill("ТЕСТ Board %42");
    await expect(boardInput).toHaveValue("ТЕСТ Board %42");

    await page.locator("#named-board-form input[type='submit']").click();
    await expect(page).toHaveURL(
      `${server.serverUrl}/boards/${encodeURIComponent("тест-board-42")}`,
    );
  });

  test("named board form keeps invalid-only input on the landing page", async ({
    page,
    server,
  }) => {
    await page.goto(rootUrl(server.serverUrl));

    const boardInput = page.locator("#board");
    await boardInput.fill(":/?#");
    await expect(boardInput).toHaveValue(":/?#");

    await page.locator("#named-board-form input[type='submit']").click();
    await expect(page).toHaveURL(rootUrl(server.serverUrl));
    await expect(boardInput).toHaveValue("");
  });

  test("__proto__ board name creates and loads a valid board without crashing", async ({
    boardPage,
  }) => {
    await boardPage.gotoBoard("__proto__");
    await expect(boardPage.page).toHaveURL(/\/boards\/__proto__/);

    await boardPage.waitForBoardWritable();
    await boardPage.selectTool("pencil");

    try {
      await boardPage.drawPencilPaths([
        {
          color: "#123456",
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 400 },
          ],
        },
      ]);
      await expect(
        boardPage.page.locator("path[stroke='#123456']"),
      ).toBeVisible();
    } catch (e) {
      console.log(
        "WRITE STATUS:",
        await boardPage.readWriteStatus(),
        "canBuffer:",
        await boardPage.page.evaluate(() =>
          window.WBOApp.writes.canBufferWrites(),
        ),
      );
      console.log(
        "serverOverrides:",
        await boardPage.page.evaluate(() =>
          JSON.stringify(window.WBOApp.config.serverConfig.RATE_LIMITS),
        ),
      );
      console.log(
        "Object.prototype.periodMs:",
        await boardPage.page.evaluate(() => Object.prototype.periodMs),
      );
      console.log(
        "canEmit:",
        await boardPage.page.evaluate(() => {
          const writes = window.WBOApp.writes;
          if (writes.bufferedWrites.length > 0) {
            const w = writes.bufferedWrites[0];
            return ["general", "text", "destructive", "constructive"].map(
              (kind) => {
                const cost = w.costs[kind];
                const def =
                  window.WBOApp.rateLimits.getEffectiveRateLimit(kind);
                const state = writes.localRateLimitStates[kind];
                const can = window.RateLimitCommon
                  ? window.RateLimitCommon.canConsumeFixedWindowRateLimit(
                      state,
                      cost,
                      def.limit,
                      def.periodMs,
                      Date.now(),
                    )
                  : "no_common";
                return `${kind}: cost=${cost} def=${JSON.stringify(def)} can=${can}`;
              },
            );
          }
          return "empty";
        }),
      );
      throw e;
    }
  });
});
