import { expect, test } from "../fixtures/test";

test.describe("drawing and persistence", () => {
  test("pencil persists and renders in preview", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("anonymous", { lang: "fr" });
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await expect(page).toHaveTitle(/WBO/);
    await boardPage.selectTool("Pencil");
    await boardPage.expectCurrentTool("Pencil");
    await boardPage.drawPencilPaths([
      {
        color: "#123456",
        points: [
          { x: 100, y: 200 },
          { x: 300, y: 400 },
        ],
      },
      {
        color: "#abcdef",
        points: [
          { x: 0, y: 0 },
          { x: 90, y: 120 },
          { x: 180, y: 0 },
        ],
      },
    ]);

    const firstPath = "path[stroke='#123456']";
    const secondPath = "path[stroke='#abcdef']";

    await expect(page.locator(firstPath)).toBeVisible();
    await expect(page.locator(secondPath)).toBeVisible();
    await page.reload();
    await expect(page.locator(firstPath)).toBeVisible();
    await expect(page.locator(secondPath)).toBeVisible();

    await boardPage.gotoPreview("anonymous");
    await expect(page.locator(firstPath)).toBeVisible();
    await expect(page.locator(secondPath)).toBeVisible();
  });

  test("circle persists and keeps localized label", async ({
    boardPage,
    page,
  }) => {
    const circleSelector =
      "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']";

    await boardPage.gotoBoard("anonymous", { lang: "fr" });
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await boardPage.selectTool("Ellipse");
    await boardPage.drawCircle("#112233", { x: 200, y: 200 }, 200);
    await expect(page.locator(circleSelector)).toBeVisible();

    await page.reload();
    await expect(page.locator(circleSelector)).toBeVisible();

    await boardPage.selectTool("Ellipse");
    await boardPage.selectTool("Ellipse");
    await expect(boardPage.tool("Ellipse")).toContainText("Cercle");
  });

  test("text tool creates persistent text", async ({
    boardPage,
    server,
    page,
  }) => {
    await boardPage.gotoBoard("text-test");
    await expect(boardPage.tool("Text")).toBeVisible();
    await boardPage.selectTool("Text");
    await boardPage.createText(120, 140, "Hello text");

    await server.waitForStoredBoard(
      server.dataPath,
      "text-test",
      (storedBoard) =>
        Object.values(storedBoard).some(
          (item) => item && item.tool === "Text" && item.txt === "Hello text",
        ),
    );
    await page.reload();
    await expect(page.locator("#drawingArea text")).toHaveText("Hello text");
  });

  test("straight line snap persists", async ({ boardPage, server, page }) => {
    await boardPage.gotoBoard("line-test");
    await expect(boardPage.tool("Straight line")).toBeVisible();
    await boardPage.selectTool("Straight line");
    await boardPage.selectTool("Straight line");

    const result = await boardPage.drawStraightLine(
      { x: 100, y: 100 },
      { x: 102, y: 160 },
    );
    expect(result.secondaryActive).toBe(true);
    expect(result.x1).toBe(100);
    expect(result.y1).toBe(100);
    expect(Math.abs(result.x2 - 100)).toBeLessThan(0.5);
    expect(Math.abs(result.y2 - 160)).toBeLessThan(0.5);

    await server.waitForStoredBoard(
      server.dataPath,
      "line-test",
      (storedBoard) =>
        Object.values(storedBoard).some(
          (item) =>
            item &&
            item.tool === "Straight line" &&
            Math.abs(item.x2 - 100) < 0.5 &&
            Math.abs(item.y2 - 160) < 0.5,
        ),
    );
    await page.reload();
    await expect(page.locator("#drawingArea line")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const line = document.querySelector("#drawingArea line");
          return {
            x1: Number(line?.getAttribute("x1")),
            y1: Number(line?.getAttribute("y1")),
            x2: Number(line?.getAttribute("x2")),
            y2: Number(line?.getAttribute("y2")),
          };
        }),
      )
      .toMatchObject({
        x1: 100,
        y1: 100,
        x2: 100,
        y2: 160,
      });
  });

  test("square mode persists", async ({ boardPage, server, page }) => {
    await boardPage.gotoBoard("rectangle-test");
    await expect(boardPage.tool("Rectangle")).toBeVisible();
    await boardPage.selectTool("Rectangle");
    await boardPage.selectTool("Rectangle");

    const result = await boardPage.drawSquare(
      { x: 100, y: 100 },
      { x: 160, y: 130 },
    );
    expect(result.secondaryActive).toBe(true);
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
    expect(result.width).toBe(60);
    expect(result.height).toBe(60);

    await server.waitForStoredBoard(
      server.dataPath,
      "rectangle-test",
      (storedBoard) =>
        Object.values(storedBoard).some(
          (item) =>
            item &&
            item.tool === "Rectangle" &&
            item.x === 100 &&
            item.y === 100 &&
            item.x2 === 160 &&
            item.y2 === 160,
        ),
    );
    await page.reload();
    await expect(page.locator("#drawingArea rect")).toBeVisible();
  });

  test("eraser removes persistent shape", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "eraser-test", {
      "erase-rect": {
        type: "rect",
        id: "erase-rect",
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("eraser-test");
    await expect(boardPage.tool("Eraser")).toBeVisible();
    await expect(page.locator("#erase-rect")).toBeVisible();
    await boardPage.selectTool("Eraser");
    await boardPage.eraseShapeById("erase-rect");
    await server.waitForStoredBoard(
      server.dataPath,
      "eraser-test",
      (storedBoard) => !Object.hasOwn(storedBoard, "erase-rect"),
    );
    await page.reload();
    await expect(boardPage.tool("Eraser")).toBeVisible();
    await expect(page.locator("#erase-rect")).toHaveCount(0);
  });

  test("cursor updates self cursor", async ({ boardPage }) => {
    await boardPage.gotoBoard("anonymous", { lang: "fr" });
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await boardPage.moveCursor("#456123", 150, 200);

    await expect.poll(() => boardPage.readCursorAttributes()).not.toBeNull();
    const state = await boardPage.readCursorAttributes();
    expect(state.fill).toBe("#456123");
    expect(state.transform ?? "").toMatch(
      /(translate\(150px,\s*200px\)|matrix\(1,\s*0,\s*0,\s*1,\s*150,\s*200\))/,
    );
  });
});
