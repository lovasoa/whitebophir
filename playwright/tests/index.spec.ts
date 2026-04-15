import { expect, test } from "../fixtures/test";
import { rootUrl } from "../helpers/testServer";

test.describe("index page board naming", () => {
  test("named board input strips invalid characters before navigation", async ({
    page,
    server,
  }) => {
    await page.goto(rootUrl(server.serverUrl));

    const boardInput = page.locator("#board");
    await boardInput.fill("team:sync/room?#1");
    await expect(boardInput).toHaveValue("teamsyncroom1");

    await page.locator("#named-board-form input[type='submit']").click();
    await expect(page).toHaveURL(`${server.serverUrl}/boards/teamsyncroom1`);
  });

  test("named board form keeps invalid-only input on the landing page", async ({
    page,
    server,
  }) => {
    await page.goto(rootUrl(server.serverUrl));

    const boardInput = page.locator("#board");
    await boardInput.fill(":/?#");
    await expect(boardInput).toHaveValue("");

    await page.locator("#named-board-form input[type='submit']").click();
    await expect(page).toHaveURL(rootUrl(server.serverUrl));
  });
});
