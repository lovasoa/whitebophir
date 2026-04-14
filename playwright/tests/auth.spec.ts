import jsonwebtoken from "jsonwebtoken";
import { test, expect } from "../fixtures/test";
import { AUTH_SECRET, TOKENS } from "../helpers/tokens";

const jwtTest = test.extend({
  serverOptions: { useJWT: true },
});

test.describe("JWT auth and readonly flows", () => {
  jwtTest("readonly board with JWT", async ({ boardPage, server, page }) => {
    const readonlySelector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";
    const clearSelector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#ff00ff']";

    await server.writeBoard(server.dataPath, "readonly-test", {
      __wbo_meta__: { readonly: true },
    });
    await server.writeBoard(server.dataPath, "readonly-clear", {
      __wbo_meta__: { readonly: true },
      "readonly-clear-rect": {
        type: "rect",
        id: "readonly-clear-rect",
        tool: "Rectangle",
        x: 10,
        y: 10,
        x2: 30,
        y2: 30,
        color: "#ff00ff",
        size: 4,
      },
    });

    await boardPage.gotoBoard("readonly-test", {
      token: TOKENS.readOnlyViewer,
    });
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(boardPage.tool("Pencil")).toHaveCount(0);
    await expect(boardPage.settings).toBeHidden();
    await boardPage.emitBroadcast({
      type: "rect",
      id: "readonly-viewer-rect",
      tool: "Rectangle",
      x: 10,
      y: 10,
      x2: 30,
      y2: 30,
      color: "#123456",
      size: 4,
    });
    await page.reload();
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(page.locator(readonlySelector)).toHaveCount(0);

    await boardPage.gotoBoard("readonly-test", {
      token: TOKENS.readOnlyGlobalEditor,
    });
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await expect(boardPage.settings).toBeVisible();
    await boardPage.emitBroadcast({
      type: "rect",
      id: "readonly-editor-rect",
      tool: "Rectangle",
      x: 10,
      y: 10,
      x2: 30,
      y2: 30,
      color: "#123456",
      size: 4,
    });
    await page.reload();
    await expect(page.locator(readonlySelector)).toBeVisible();

    await boardPage.gotoBoard("readonly-test", {
      token: TOKENS.readOnlyBoardEditor,
    });
    await expect(page.locator(readonlySelector)).toBeVisible();
    await expect(boardPage.tool("Pencil")).toBeVisible();

    await boardPage.gotoBoard("readonly-clear", {
      token: TOKENS.readOnlyGlobalModerator,
    });
    await expect(boardPage.tool("Clear")).toBeVisible();
    await expect(page.locator(clearSelector)).toBeVisible();
    await boardPage.tool("Clear").click();
    await server.waitForStoredBoard(
      server.dataPath,
      "readonly-clear",
      (storedBoard) => !storedBoard["readonly-clear-rect"],
    );
    await page.reload();
    await expect(boardPage.tool("Clear")).toBeVisible();
    await expect(page.locator(clearSelector)).toHaveCount(0);
  });

  jwtTest("JWT authorization matrix", async ({ boardPage, page }) => {
    await boardPage.gotoBoard("testboard", {
      token: TOKENS.globalModerator,
    });
    await expect(boardPage.tool("Clear")).toBeVisible();

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.globalModerator,
    });
    await expect(boardPage.tool("Clear")).toBeVisible();

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.boardModeratorTestboard,
    });
    await expect(boardPage.tool("Clear")).toBeVisible();

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.boardModeratorTestboard,
    });
    await expect(boardPage.menu).toHaveCount(0);

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.globalEditor,
    });
    await expect(boardPage.tool("Clear")).toHaveCount(0);
    await expect(boardPage.menu).toBeVisible();

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.boardEditorTestboard,
    });
    await expect(boardPage.menu).toBeVisible();
    await expect(boardPage.tool("Clear")).toHaveCount(0);

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.boardEditorTestboard,
    });
    await expect(boardPage.menu).toHaveCount(0);

    const colonModerator = jsonwebtoken.sign(
      { sub: "moderator-colon", roles: ["moderator:test:board"] },
      AUTH_SECRET,
    );
    await boardPage.gotoBoard("test:board", {
      token: colonModerator,
    });
    await expect(boardPage.menu).toHaveCount(0);
    await expect(page.locator("text=Illegal board name")).toHaveCount(0);
  });
});

test.describe("public authless flows", () => {
  test(
    "readonly board without auth",
    async ({ boardPage, server, page }) => {
      const selector =
        "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

      await server.writeBoard(server.dataPath, "readonly-public", {
        __wbo_meta__: { readonly: true },
      });

      await boardPage.gotoBoard("readonly-public");
      await expect(boardPage.tool("Hand")).toBeVisible();
      await expect(boardPage.tool("Pencil")).toHaveCount(0);
      await expect(boardPage.tool("Line")).toHaveCount(0);
      await expect(boardPage.settings).toBeHidden();
      await boardPage.emitBroadcast({
        type: "rect",
        id: "readonly-public-rect",
        tool: "Rectangle",
        x: 10,
        y: 10,
        x2: 30,
        y2: 30,
        color: "#123456",
        size: 4,
      });
      await page.reload();
      await expect(boardPage.tool("Hand")).toBeVisible();
      await expect(page.locator(selector)).toHaveCount(0);
    },
  );

  test("menu hiding query param", async ({ boardPage }) => {
    await boardPage.gotoBoard("anonymous", {
      lang: "fr",
      query: { hideMenu: true },
    });
    await expect(boardPage.menu).toBeHidden();

    await boardPage.gotoBoard("anonymous", {
      lang: "fr",
      query: { hideMenu: false },
    });
    await expect(boardPage.menu).toBeVisible();
  });
});
