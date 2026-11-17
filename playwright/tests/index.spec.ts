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
  });
});
