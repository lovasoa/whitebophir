import type { Page } from "@playwright/test";
import { createBoardPage, expect, test } from "../fixtures/test";
import { TOKENS } from "../helpers/tokens";
import type { BoardPage } from "../pages/BoardPage";

const bufferedModeratorTest = test.extend({
  serverOptions: {
    useJWT: true,
    env: {
      WBO_MAX_EMIT_COUNT: "*:2/1s",
    },
  },
});

const bufferedWriteTest = test.extend({
  serverOptions: {
    env: {
      WBO_MAX_EMIT_COUNT: "*:1/2s",
    },
  },
});

const edgeTextTest = test.extend({
  serverOptions: {
    env: {
      WBO_MAX_BOARD_SIZE: "2000",
    },
  },
});

const CREATE_MUTATION = 1;
const DELETE_MUTATION = 3;

async function drawMarkerRectangle(boardPage: BoardPage, page: Page) {
  await boardPage.selectTool("rectangle");
  await page.mouse.move(260, 260);
  await page.mouse.down();
  await page.mouse.move(320, 320);
  await page.mouse.up();
}

async function drawScreenRectangle(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
}

test.describe("drawing and persistence", () => {
  test("pencil persists and renders in preview", async ({
    boardPage,
    page,
    server,
  }) => {
    const boardName = "drawing-pencil-persist";
    await boardPage.gotoBoard(boardName, { lang: "fr" });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await expect(page).toHaveTitle(/WBO/);
    await boardPage.selectTool("pencil");
    await boardPage.expectCurrentTool("pencil");
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
    await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (storedBoard) => {
        const items = Object.values(storedBoard);
        return (
          items.some(
            (item) =>
              item && item.tool === "pencil" && item.color === "#123456",
          ) &&
          items.some(
            (item) =>
              item && item.tool === "pencil" && item.color === "#abcdef",
          )
        );
      },
    );
    await page.reload();
    await expect(page.locator(firstPath)).toBeVisible();
    await expect(page.locator(secondPath)).toBeVisible();

    await boardPage.gotoPreview(boardName);
    await expect(page.locator(firstPath)).toBeVisible();
    await expect(page.locator(secondPath)).toBeVisible();
  });

  test("circle persists and keeps localized label", async ({
    boardPage,
    page,
    server,
  }) => {
    const boardName = "drawing-circle-persist";
    const circleSelector =
      "ellipse[cx='200'][cy='200'][rx='200'][ry='200'][stroke='#112233']";

    await boardPage.gotoBoard(boardName, { lang: "fr" });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.selectTool("ellipse");
    await boardPage.drawCircle("#112233", { x: 200, y: 200 }, 200);
    await expect(page.locator(circleSelector)).toBeVisible();
    await server.waitForStoredBoard(server.dataPath, boardName, (storedBoard) =>
      Object.values(storedBoard).some(
        (item) =>
          item &&
          item.tool === "ellipse" &&
          item.color === "#112233" &&
          Math.min(item.x, item.x2) === 0 &&
          Math.max(item.x, item.x2) === 400 &&
          Math.min(item.y, item.y2) === 0 &&
          Math.max(item.y, item.y2) === 400,
      ),
    );

    await page.reload();
    await expect(page.locator(circleSelector)).toBeVisible();

    await boardPage.selectTool("ellipse");
    await boardPage.selectTool("ellipse");
    await expect(boardPage.tool("ellipse")).toContainText("Cercle");
  });

  test("text tool creates persistent text", async ({
    boardPage,
    server,
    page,
  }) => {
    await boardPage.gotoBoard("text-test");
    await expect(boardPage.tool("text")).toBeVisible();
    await boardPage.selectTool("text");
    await boardPage.createText(120, 140, "Hello text");

    await server.waitForStoredBoard(
      server.dataPath,
      "text-test",
      (storedBoard) =>
        Object.values(storedBoard).some(
          (item) => item && item.tool === "text" && item.txt === "Hello text",
        ),
    );
    await page.reload();
    await expect(page.locator("#drawingArea text")).toHaveText("Hello text");
  });

  test("text editor overlays the text being written", async ({
    boardPage,
    page,
  }) => {
    const textValue = "Overlay margin check";

    await boardPage.gotoBoard("text-editor-overlay");
    await boardPage.selectTool("text");
    await page.evaluate(() => {
      window.Tools.setColor("#ff4136");
      window.Tools.setSize(40);
    });
    await page.mouse.click(260, 240);
    await page.keyboard.insertText(textValue);

    const editor = await page.evaluate(() => {
      const input = document.getElementById(
        "textToolInput",
      ) as HTMLInputElement | null;
      const text = document.querySelector("#drawingArea text");
      if (!input || !(text instanceof SVGTextElement)) {
        throw new Error("Missing text editor state");
      }
      const inputStyle = getComputedStyle(input);
      const textX = Number(text.getAttribute("x")) * window.Tools.scale;
      const textBaseline = Number(text.getAttribute("y")) * window.Tools.scale;
      const textFontSize =
        Number(text.getAttribute("font-size")) * window.Tools.scale;
      const textWidth = text.getComputedTextLength() * window.Tools.scale;
      return {
        backgroundColor: inputStyle.backgroundColor,
        borderTopWidth: inputStyle.borderTopWidth,
        color: inputStyle.color,
        inputFontSize: Number.parseFloat(inputStyle.fontSize),
        inputLeft: Number.parseFloat(input.style.left),
        inputTop: Number.parseFloat(input.style.top),
        inputWidth: input.getBoundingClientRect().width,
        position: inputStyle.position,
        textFontSize,
        textHidden: getComputedStyle(text).visibility === "hidden",
        textValue: input.value,
        textWidth,
        textX,
        textBaseline,
      };
    });

    expect(editor.textValue).toBe(textValue);
    expect(editor.position).toBe("absolute");
    expect(editor.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(editor.borderTopWidth).toBe("1px");
    expect(editor.color).toBe("rgb(255, 65, 54)");
    expect(editor.inputFontSize).toBeCloseTo(editor.textFontSize, 1);
    expect(editor.inputWidth - editor.textWidth).toBeGreaterThanOrEqual(4);
    expect(editor.inputWidth - editor.textWidth).toBeLessThanOrEqual(16);
    expect(editor.inputLeft).toBeCloseTo(editor.textX - 3, 1);
    expect(editor.inputTop).toBeCloseTo(
      editor.textBaseline - editor.textFontSize - 1,
      1,
    );
    expect(editor.textHidden).toBe(true);

    await boardPage.selectTool("rectangle");
    await expect(page.locator("#drawingArea text")).toBeVisible();
  });

  test("long text input stays within server admission bounds", async ({
    boardPage,
    server,
    page,
  }) => {
    const boardName = "text-admission-long";
    const longText =
      "Long pasted text should not make the browser send a server-rejected text update. ".repeat(
        3,
      );

    await boardPage.gotoBoard(boardName);
    await boardPage.selectTool("text");
    await page.mouse.click(240, 220);
    await page.keyboard.insertText(longText);

    await drawMarkerRectangle(boardPage, page);
    const storedBoard = await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (board) =>
        Object.values(board).some((item) => item?.tool === "rectangle"),
    );

    await expect(boardPage.statusIndicator).toBeHidden();
    expect(
      Object.values(storedBoard).some(
        (item) => item?.tool === "text" && item.txt === longText,
      ),
    ).toBe(true);
  });

  edgeTextTest(
    "text input near the right board edge is accepted",
    async ({ boardPage, server, page }) => {
      const boardName = "text-admission-right-edge";
      const edgeText = "right edge text";

      await boardPage.gotoBoard(boardName);
      await boardPage.selectTool("text");
      await page.mouse.click(1260, 260);
      await page.keyboard.insertText(edgeText);

      await drawMarkerRectangle(boardPage, page);
      const storedBoard = await server.waitForStoredBoard(
        server.dataPath,
        boardName,
        (board) =>
          Object.values(board).some((item) => item?.tool === "rectangle"),
      );

      await expect(boardPage.statusIndicator).toBeHidden();
      expect(
        Object.values(storedBoard).some(
          (item) => item?.tool === "text" && item.txt === edgeText,
        ),
      ).toBe(true);
    },
  );

  test("passive key on transformed text preserves stored content", async ({
    boardPage,
    server,
    page,
  }) => {
    const boardName = "transformed-text-noop-edit";
    const originalText =
      "Transformed text must survive a passive edit event without being shortened. ".repeat(
        3,
      );

    await server.writeBoard(server.dataPath, boardName, {
      "scaled-text": {
        type: "text",
        id: "scaled-text",
        tool: "text",
        x: 24,
        y: 40,
        size: 36,
        color: "#111111",
        transform: { a: 0.8, b: 0, c: 0, d: 0.8, e: 4.8, f: 8 },
        txt: originalText,
      },
    });

    await boardPage.gotoBoard(boardName);
    await expect(page.locator("#scaled-text")).toHaveText(originalText);

    await boardPage.selectTool("text");
    await page.locator("#scaled-text").click();
    await expect(page.locator("#textToolInput")).toHaveValue(originalText);
    await page.waitForFunction(() => performance.now() > 150);
    await page.locator("#textToolInput").press("ArrowLeft");
    await boardPage.selectTool("rectangle");
    await drawScreenRectangle(page, { x: 260, y: 260 }, { x: 320, y: 320 });

    const storedBoard = await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (board) =>
        Object.values(board).some((item) => item?.tool === "rectangle"),
    );
    expect(storedBoard["scaled-text"]?.txt).toBe(originalText);
  });

  bufferedModeratorTest(
    "remote clear drops buffered pencil appends for the removed line",
    async ({ boardPage, context, server, page }) => {
      const boardName = "clear-buffered-pencil";
      const peerPage = await context.newPage();
      const peerBoard = createBoardPage(peerPage, server);

      await Promise.all([
        boardPage.gotoBoard(boardName, { token: TOKENS.globalModerator }),
        peerBoard.gotoBoard(boardName, { token: TOKENS.globalModerator }),
      ]);
      await Promise.all([
        boardPage.waitForSocketConnected(),
        peerBoard.waitForSocketConnected(),
      ]);
      await expect(peerBoard.tool("clear")).toBeVisible();
      await boardPage.selectTool("pencil");

      await page.mouse.move(300, 300);
      await page.mouse.down();
      await page.mouse.move(360, 300);
      await page.mouse.move(420, 300);
      await expect(page.locator("#drawingArea path")).toHaveCount(1);
      await expect(boardPage.statusIndicator).toBeVisible();

      await peerBoard.tool("clear").click();
      await page.mouse.up();

      await expect(boardPage.statusIndicator).toBeHidden();
      await peerPage.close();
    },
  );

  bufferedWriteTest(
    "local delete keeps the buffered create it depends on",
    async ({ boardPage, page }) => {
      await boardPage.gotoBoard("delete-buffered-create");
      await boardPage.selectTool("rectangle");

      await drawScreenRectangle(page, { x: 180, y: 180 }, { x: 230, y: 230 });
      await drawScreenRectangle(page, { x: 320, y: 180 }, { x: 370, y: 230 });
      await expect(page.locator("#drawingArea rect")).toHaveCount(2);
      await expect(boardPage.statusIndicator).toBeVisible();
      const deletedRectId = await page
        .locator("#drawingArea rect")
        .nth(1)
        .evaluate((rect) => rect.id);

      await boardPage.selectTool("eraser");
      await page.mouse.click(320, 205);
      await expect(page.locator("#drawingArea rect")).toHaveCount(1);
      const bufferedMutationsForDeletedRect = await page.evaluate(
        (targetId) =>
          window.Tools.bufferedWrites
            .map((write) => write.message)
            .filter((message) => message.id === targetId)
            .map((message) => message.type),
        deletedRectId,
      );
      expect(bufferedMutationsForDeletedRect).toContain(CREATE_MUTATION);
      expect(bufferedMutationsForDeletedRect.at(-1)).toBe(DELETE_MUTATION);
    },
  );

  test("straight line snap persists", async ({ boardPage, server, page }) => {
    await boardPage.gotoBoard("line-test");
    await expect(boardPage.tool("straight-line")).toBeVisible();
    await boardPage.selectTool("straight-line");
    await boardPage.selectTool("straight-line");

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
            item.tool === "straight-line" &&
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
    await expect(boardPage.tool("rectangle")).toBeVisible();
    await boardPage.selectTool("rectangle");
    await boardPage.selectTool("rectangle");

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
            item.tool === "rectangle" &&
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
        tool: "rectangle",
        x: 260,
        y: 180,
        x2: 340,
        y2: 240,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("eraser-test");
    await expect(boardPage.tool("eraser")).toBeVisible();
    await expect(page.locator("#erase-rect")).toBeVisible();
    await boardPage.selectTool("eraser");
    await boardPage.eraseShapeById("erase-rect");
    await boardPage.waitForBufferedWritesDrained();
    await page.goto("about:blank");
    await server.waitForStoredBoard(
      server.dataPath,
      "eraser-test",
      (storedBoard) => !Object.hasOwn(storedBoard, "erase-rect"),
    );
    await boardPage.gotoBoard("eraser-test");
    await expect(boardPage.tool("eraser")).toBeVisible();
    await expect(page.locator("#erase-rect")).toHaveCount(0);
  });

  test("cursor updates self cursor", async ({ boardPage }) => {
    await boardPage.gotoBoard("anonymous", { lang: "fr" });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.moveCursor("#456123", 150, 200);

    await expect.poll(() => boardPage.readCursorAttributes()).not.toBeNull();
    const state = await boardPage.readCursorAttributes();
    if (!state) throw new Error("Cursor state missing after move");
    expect(state.fill).toBe("#456123");
    expect(state.transform ?? "").toMatch(
      /(translate\(1500px,\s*2000px\)|matrix\(1,\s*0,\s*0,\s*1,\s*1500,\s*2000\))/,
    );
  });
});
