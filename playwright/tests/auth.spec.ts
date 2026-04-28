import jsonwebtoken from "jsonwebtoken";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { Rectangle } from "../../client-data/tools/index.js";
import { expect, test } from "../fixtures/test";
import { AUTH_SECRET, TOKENS } from "../helpers/tokens";

const jwtTest = test.extend({
  serverOptions: { useJWT: true },
});

test.describe("JWT auth and readonly flows", () => {
  jwtTest("readonly board with JWT", async ({ boardPage, server, page }) => {
    const readonlySelector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";
    const clearSelector =
      "rect[x='100'][y='100'][width='200'][height='200'][stroke='#ff00ff']";

    await server.writeBoard(server.dataPath, "readonly-test", {
      __wbo_meta__: { readonly: true },
    });
    await server.writeBoard(server.dataPath, "readonly-clear", {
      __wbo_meta__: { readonly: true },
      "readonly-clear-rect": {
        type: "rect",
        id: "readonly-clear-rect",
        tool: "rectangle",
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
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(boardPage.tool("pencil")).toHaveCount(0);
    await expect(boardPage.settings).toBeHidden();
    await boardPage.emitBroadcast({
      type: MutationType.CREATE,
      id: "readonly-viewer-rect",
      tool: Rectangle.id,
      x: 10,
      y: 10,
      x2: 30,
      y2: 30,
      color: "#123456",
      size: 10,
    });
    await page.reload();
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(page.locator(readonlySelector)).toHaveCount(0);

    await boardPage.gotoBoard("readonly-test", {
      token: TOKENS.readOnlyGlobalEditor,
    });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await expect(boardPage.settings).toBeVisible();
    await boardPage.emitBroadcast({
      type: MutationType.CREATE,
      id: "readonly-editor-rect",
      tool: Rectangle.id,
      x: 10,
      y: 10,
      x2: 30,
      y2: 30,
      color: "#123456",
      size: 10,
    });
    await server.waitForStoredBoard(
      server.dataPath,
      "readonly-test",
      (storedBoard) => !!storedBoard["readonly-editor-rect"],
    );
    await page.reload();
    await expect(page.locator(readonlySelector)).toBeVisible();

    await boardPage.gotoBoard("readonly-test", {
      token: TOKENS.readOnlyBoardEditor,
    });
    await expect(page.locator(readonlySelector)).toBeVisible();
    await expect(boardPage.tool("pencil")).toBeVisible();

    await boardPage.gotoBoard("readonly-clear", {
      token: TOKENS.readOnlyGlobalModerator,
    });
    await expect(boardPage.tool("clear")).toBeVisible();
    await expect(page.locator(clearSelector)).toBeVisible();
    await boardPage.tool("clear").click();
    await server.waitForStoredBoard(
      server.dataPath,
      "readonly-clear",
      (storedBoard) => !storedBoard["readonly-clear-rect"],
    );
    await page.reload();
    await expect(boardPage.tool("clear")).toBeVisible();
    await expect(page.locator(clearSelector)).toHaveCount(0);
  });

  jwtTest("JWT authorization matrix", async ({ boardPage, page }) => {
    await boardPage.gotoBoard("testboard", {
      token: TOKENS.globalModerator,
    });
    await expect(boardPage.tool("clear")).toBeVisible();

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.globalModerator,
    });
    await expect(boardPage.tool("clear")).toBeVisible();

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.boardModeratorTestboard,
    });
    await expect(boardPage.tool("clear")).toBeVisible();

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.boardModeratorTestboard,
    });
    await expect(boardPage.menu).toHaveCount(0);

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.globalEditor,
    });
    await expect(boardPage.tool("clear")).toHaveCount(0);
    await expect(boardPage.menu).toBeVisible();

    await boardPage.gotoBoard("testboard", {
      token: TOKENS.boardEditorTestboard,
    });
    await expect(boardPage.menu).toBeVisible();
    await expect(boardPage.tool("clear")).toHaveCount(0);

    await boardPage.gotoBoard("testboard123", {
      token: TOKENS.boardEditorTestboard,
    });
    await expect(boardPage.menu).toHaveCount(0);

    const unicodeModerator = jsonwebtoken.sign(
      { sub: "moderator-unicode", roles: ["moderator:тест-board"] },
      AUTH_SECRET,
    );
    await boardPage.gotoBoard("ТЕСТ Board", {
      token: unicodeModerator,
    });
    expect(new URL(page.url()).pathname).toBe(
      `/boards/${encodeURIComponent("тест-board")}`,
    );
    await expect(boardPage.menu).toBeVisible();
  });
});

test.describe("public authless flows", () => {
  test("readonly board without auth", async ({ boardPage, server, page }) => {
    const selector =
      "rect[x='10'][y='10'][width='20'][height='20'][stroke='#123456']";

    await server.writeBoard(server.dataPath, "readonly-public", {
      __wbo_meta__: { readonly: true },
    });

    await boardPage.gotoBoard("readonly-public");
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(boardPage.tool("pencil")).toHaveCount(0);
    await expect(boardPage.tool("straight-line")).toHaveCount(0);
    await expect(boardPage.settings).toBeHidden();
    await boardPage.emitBroadcast({
      type: MutationType.CREATE,
      id: "readonly-public-rect",
      tool: Rectangle.id,
      x: 10,
      y: 10,
      x2: 30,
      y2: 30,
      color: "#123456",
      size: 10,
    });
    await page.reload();
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(page.locator(selector)).toHaveCount(0);
  });

  test("readonly board rejection removes optimistic local draw", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "readonly-optimistic-public", {
      __wbo_meta__: { readonly: true },
    });

    await boardPage.gotoBoard("readonly-optimistic-public");
    await boardPage.waitForSocketConnected();
    await boardPage.waitForAuthoritativeResync();

    const hadOptimisticRect = await page.evaluate(
      ({ createType, tool }) => {
        const rectangle = window.WBOApp.toolRegistry.mounted.rectangle;
        if (!rectangle) throw new Error("rectangle tool is unavailable");
        window.WBOApp.drawAndSend({
          tool,
          type: createType,
          id: "readonly-public-optimistic-rect",
          x: 10,
          y: 10,
          x2: 40,
          y2: 40,
          color: "#123456",
          size: 10,
          opacity: 1,
        });
        return !!document.getElementById("readonly-public-optimistic-rect");
      },
      { createType: MutationType.CREATE, tool: Rectangle.id },
    );

    expect(hadOptimisticRect).toBe(true);
    await expect(
      page.locator("rect#readonly-public-optimistic-rect"),
    ).toHaveCount(0);
  });
});
