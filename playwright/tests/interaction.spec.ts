import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

type BootPhaseSnapshot = {
  phase: string;
  left: number;
  top: number;
  boardPhase: string;
};

async function installBootPhaseRecorder(page: Page) {
  await page.addInitScript(() => {
    (window as any).__bootPhaseSnapshots = [];
    document.addEventListener("wbo:board-phase", (event) => {
      const detail =
        event instanceof CustomEvent && event.detail
          ? (event.detail as { phase?: unknown })
          : null;
      const phase = typeof detail?.phase === "string" ? detail.phase : "";
      (window as any).__bootPhaseSnapshots.push({
        phase,
        left: window.scrollX || document.documentElement.scrollLeft,
        top: window.scrollY || document.documentElement.scrollTop,
        boardPhase: document.documentElement.dataset.boardPhase ?? "",
      });
    });
  });
}

async function readBootPhaseSnapshots(
  page: Page,
): Promise<BootPhaseSnapshot[]> {
  return page.evaluate(
    () =>
      ((window as any).__bootPhaseSnapshots as
        | BootPhaseSnapshot[]
        | undefined) ?? [],
  );
}

async function waitForRecordedPhase(page: Page, phase: string) {
  await page.waitForFunction(
    (targetPhase) =>
      Array.isArray((window as any).__bootPhaseSnapshots) &&
      (window as any).__bootPhaseSnapshots.some(
        (entry: { phase?: unknown } | undefined) =>
          entry?.phase === targetPhase,
      ),
    phase,
  );
}

async function expectViewportRestoreBeforeConnect(
  page: Page,
  left: number,
  top: number,
) {
  await waitForRecordedPhase(page, "viewport-restored");
  await waitForRecordedPhase(page, "connecting");
  const phases = await readBootPhaseSnapshots(page);
  const viewportRestoredIndex = phases.findIndex(
    (entry) => entry.phase === "viewport-restored",
  );
  const connectingIndex = phases.findIndex(
    (entry) => entry.phase === "connecting",
  );
  expect(viewportRestoredIndex).toBeGreaterThanOrEqual(0);
  expect(connectingIndex).toBeGreaterThanOrEqual(0);
  expect(viewportRestoredIndex).toBeLessThan(connectingIndex);
  expect(phases[viewportRestoredIndex]).toMatchObject({
    phase: "viewport-restored",
    left,
    top,
    boardPhase: "viewport-restored",
  });
}

async function readBoardTouchAction(page: Page) {
  return page.evaluate(() => {
    const board = document.getElementById("board");
    const svg = document.getElementById("canvas");
    return {
      board: board ? getComputedStyle(board).touchAction : "",
      svg: svg ? getComputedStyle(svg).touchAction : "",
    };
  });
}

test.describe("single-page interactions", () => {
  test("selector moves existing rectangle", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "selector-test", {
      "seed-rect": {
        type: "rect",
        id: "seed-rect",
        tool: "rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-test");
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("hand");

    const result = await boardPage.moveSelection(
      "seed-rect",
      { x: 110, y: 110 },
      { x: 150, y: 135 },
    );
    expect(result.selectorActive).toBe(true);
    expect(result.translation.e).toBe(40);
    expect(result.translation.f).toBe(25);

    await server.waitForStoredBoard(
      server.dataPath,
      "selector-test",
      (storedBoard) => {
        const rect = storedBoard["seed-rect"];
        return rect?.transform?.e === 40 && rect?.transform?.f === 25;
      },
    );
    await page.reload();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rect = document.getElementById("seed-rect");
          const transform = rect?.getAttribute("transform") ?? "";
          const values = (transform.match(/matrix\(([^)]+)\)/)?.[1] ?? "")
            .split(/[ ,]+/)
            .filter(Boolean)
            .map(Number);
          return {
            e: values[4],
            f: values[5],
          };
        }),
      )
      .toMatchObject({ e: 40, f: 25 });
  });

  test("zoom clicks in and out", async ({ boardPage }) => {
    await boardPage.gotoBoard("zoom-test");
    await expect(boardPage.tool("zoom")).toBeVisible();
    await boardPage.selectTool("zoom");

    const result = await boardPage.zoomClickInAndOut({ x: 200, y: 200 });
    expect(Math.abs(result.scaleAfterZoomIn - 0.15)).toBeLessThan(0.01);
    expect(Math.abs(result.scaleAfterZoomOut - 0.075)).toBeLessThan(0.01);
  });

  test("wheel zoom is owned by the board viewport", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("wheel-viewport-test");
    await boardPage.forceScrollTopLeft();
    const before = await page.evaluate(() =>
      window.WBOApp.viewportState.controller.getScale(),
    );

    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 400);

    await page.waitForFunction((previousScale) => {
      return window.WBOApp.viewportState.controller.getScale() < previousScale;
    }, before);
    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        top: 0,
      });
  });

  test("app gesture tools ignore browser-owned touch sequences", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("browser-owned-touch-test");
    await boardPage.selectTool("pencil");
    await expect
      .poll(() => readBoardTouchAction(page))
      .toMatchObject({
        board: "none",
        svg: "none",
      });

    await page.evaluate(() => {
      const board = document.getElementById("board");
      if (!board) throw new Error("Missing board");
      const touch = {
        identifier: 1,
        target: board,
        clientX: 200,
        clientY: 200,
        pageX: 200,
        pageY: 200,
      };
      const movedTouch = {
        ...touch,
        clientY: 240,
        pageY: 240,
      };
      const dispatchTouch = (
        type: string,
        touches: unknown[],
        changedTouches: unknown[],
      ) => {
        const event = new Event(type, {
          bubbles: true,
          cancelable: false,
        });
        Object.defineProperty(event, "touches", { value: touches });
        Object.defineProperty(event, "targetTouches", { value: touches });
        Object.defineProperty(event, "changedTouches", {
          value: changedTouches,
        });
        board.dispatchEvent(event);
      };

      dispatchTouch("touchstart", [touch], [touch]);
      dispatchTouch("touchmove", [movedTouch], [movedTouch]);
      dispatchTouch("touchend", [], [movedTouch]);
    });

    await expect(page.locator("#drawingArea path")).toHaveCount(0);
  });

  test("pencil cancels an active stroke when touch becomes multi-touch", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("pencil-multitouch-cancel-test");
    await boardPage.selectTool("pencil");

    await page.evaluate(() => {
      const board = document.getElementById("board");
      if (!board) throw new Error("Missing board");
      const first = {
        identifier: 1,
        target: board,
        clientX: 200,
        clientY: 200,
        pageX: 200,
        pageY: 200,
      };
      const second = {
        identifier: 2,
        target: board,
        clientX: 260,
        clientY: 200,
        pageX: 260,
        pageY: 200,
      };
      const movedFirst = {
        ...first,
        clientX: 240,
        pageX: 240,
      };
      const dispatchTouch = (
        type: string,
        touches: unknown[],
        changedTouches: unknown[],
      ) => {
        const event = new Event(type, {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "touches", { value: touches });
        Object.defineProperty(event, "targetTouches", { value: touches });
        Object.defineProperty(event, "changedTouches", {
          value: changedTouches,
        });
        board.dispatchEvent(event);
      };

      dispatchTouch("touchstart", [first], [first]);
      dispatchTouch("touchstart", [first, second], [second]);
      dispatchTouch("touchmove", [movedFirst, second], [movedFirst, second]);
      dispatchTouch("touchend", [movedFirst], [second]);
      dispatchTouch("touchmove", [movedFirst], [movedFirst]);
      dispatchTouch("touchend", [], [movedFirst]);
    });

    await expect(page.locator("#drawingArea path")).toHaveCount(0);
  });

  test("pencil renders active stroke and commits it on release", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("pencil-live-overlay-board-svg-test");
    await boardPage.selectTool("pencil");
    const stroke = "#13579b";
    const strokeWidth = "12";
    await page.evaluate(
      ({ color, size }) => {
        window.WBOApp.preferences.setColor(color);
        window.WBOApp.preferences.setSize(size);
      },
      { color: stroke, size: Number(strokeWidth) },
    );
    const visibleStroke = page.locator(
      `#board path[stroke='${stroke}'][stroke-width='${strokeWidth}'][d]:not([d=''])`,
    );

    await page.mouse.move(220, 220);
    await page.mouse.down();
    await page.mouse.move(280, 280, { steps: 4 });
    await expect(visibleStroke).toHaveCount(1);

    await page.mouse.up();
    const finalStroke = page.locator(`#drawingArea path[stroke='${stroke}']`);
    await expect(finalStroke).toHaveCount(1);
    await expect(finalStroke).toHaveAttribute("stroke-width", strokeWidth);
    await expect(finalStroke).toHaveAttribute("d", /.+/);
  });

  test("shift wheel pans without zooming", async ({ boardPage, page }) => {
    await boardPage.gotoBoard("shift-wheel-pan-test");
    await page.evaluate(() => {
      window.WBOApp.viewportState.controller.ensureBoardExtentForPoint(
        5000,
        5000,
      );
      window.WBOApp.viewportState.controller.setScale(1);
      window.scrollTo(0, 0);
    });
    const before = await page.evaluate(() =>
      window.WBOApp.viewportState.controller.getScale(),
    );

    await page.mouse.move(500, 400);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 300);
    await page.keyboard.up("Shift");

    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        top: 300,
      });
    expect(
      await page.evaluate(() =>
        window.WBOApp.viewportState.controller.getScale(),
      ),
    ).toBe(before);
  });

  test("zoomed-out board does not scroll past the scaled svg", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("zoomed-out-scroll-bounds-test");

    const metrics = await page.evaluate(() => {
      const tools = window.WBOApp;
      if (tools.dom.status !== "attached") {
        throw new Error("Board runtime is not attached.");
      }
      const dom = tools.dom;
      tools.viewportState.controller.ensureBoardExtentForPoint(10000, 8000);
      tools.viewportState.controller.setScale(1);
      tools.viewportState.controller.setScale(0.5);
      window.scrollTo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

      const scale = tools.viewportState.controller.getScale();
      const expectedWidth = Math.max(
        window.innerWidth,
        dom.svg.width.baseVal.value * scale,
      );
      const expectedHeight = Math.max(
        window.innerHeight,
        dom.svg.height.baseVal.value * scale,
      );
      const boardRect = dom.board.getBoundingClientRect();
      const svgRect = dom.svg.getBoundingClientRect();
      return {
        expectedWidth,
        expectedHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        boardWidth: boardRect.width,
        boardHeight: boardRect.height,
        svgWidth: svgRect.width,
        svgHeight: svgRect.height,
        rightAfterMaxScroll:
          document.documentElement.scrollLeft + window.innerWidth,
        bottomAfterMaxScroll:
          document.documentElement.scrollTop + window.innerHeight,
      };
    });

    expect(
      Math.abs(metrics.boardWidth - metrics.expectedWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(metrics.boardHeight - metrics.expectedHeight),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(metrics.svgWidth - metrics.expectedWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(metrics.svgHeight - metrics.expectedHeight),
    ).toBeLessThanOrEqual(1);
    expect(metrics.documentWidth).toBeLessThanOrEqual(
      Math.ceil(metrics.expectedWidth) + 1,
    );
    expect(metrics.documentHeight).toBeLessThanOrEqual(
      Math.ceil(metrics.expectedHeight) + 1,
    );
    expect(metrics.rightAfterMaxScroll).toBeLessThanOrEqual(
      Math.ceil(metrics.expectedWidth) + 1,
    );
    expect(metrics.bottomAfterMaxScroll).toBeLessThanOrEqual(
      Math.ceil(metrics.expectedHeight) + 1,
    );
  });

  test("hand drag pans through the central viewport controller", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("hand-pan-test");
    await expect(boardPage.tool("hand")).toBeVisible();
    await page.evaluate(() => {
      if (window.WBOApp.toolRegistry.current?.name !== "hand")
        window.WBOApp.toolRegistry.change("hand");
      if (window.WBOApp.toolRegistry.current?.secondary?.active === true) {
        window.WBOApp.toolRegistry.change("hand");
      }
    });
    await boardPage.expectCurrentTool("hand");
    await page.evaluate(() => {
      window.WBOApp.viewportState.controller.ensureBoardExtentForPoint(
        5000,
        5000,
      );
      window.WBOApp.viewportState.controller.setScale(1);
      window.scrollTo(0, 0);
    });

    await page.mouse.move(800, 500);
    await page.mouse.down();
    await page.mouse.move(600, 350);
    await page.mouse.up();

    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        left: 200,
        top: 150,
      });
  });

  test("hand touch panning policy survives authoritative resync", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("hand-touch-policy-resync-test");
    await expect(boardPage.tool("hand")).toBeVisible();
    await boardPage.expectCurrentTool("hand");

    await expect
      .poll(() => readBoardTouchAction(page))
      .toMatchObject({
        board: "pan-x pan-y",
        svg: "pan-x pan-y",
      });

    await page.evaluate(() => {
      window.WBOApp.replay.beginAuthoritativeResync();
    });

    await boardPage.expectCurrentTool("hand");
    await expect
      .poll(() => readBoardTouchAction(page))
      .toMatchObject({
        board: "pan-x pan-y",
        svg: "pan-x pan-y",
      });

    await boardPage.tool("hand").click();
    await expect
      .poll(() => readBoardTouchAction(page))
      .toMatchObject({
        board: "none",
        svg: "none",
      });

    await boardPage.tool("hand").click();
    await expect
      .poll(() => readBoardTouchAction(page))
      .toMatchObject({
        board: "pan-x pan-y",
        svg: "pan-x pan-y",
      });
  });

  test("hand transform expands the zoomed-out scroll extent", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "hand-transform-extent-test", {
      "seed-rect": {
        type: "rect",
        id: "seed-rect",
        tool: "rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("hand-transform-extent-test");
    await boardPage.selectTool("hand");
    await page.evaluate(() => {
      window.WBOApp.viewportState.controller.setScale(0.02);
      window.scrollTo(0, 0);
    });

    await boardPage.moveSelection(
      "seed-rect",
      { x: 110, y: 110 },
      { x: 100110, y: 80110 },
    );

    await page.evaluate(() => {
      window.scrollTo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    });
    const position = await boardPage.scrollPosition();
    expect(position.left).toBeGreaterThan(0);
    expect(position.top).toBeGreaterThan(0);
  });

  test("minimum zoom scrollbar reaches the full board end", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("minimum-zoom-scroll-end-test");

    const metrics = await page.evaluate(() => {
      const tools = window.WBOApp;
      if (tools.dom.status !== "attached") {
        throw new Error("Board runtime is not attached.");
      }
      tools.viewportState.controller.setScale(0);
      window.scrollTo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

      const scale = tools.viewportState.controller.getScale();
      const maxBoardSize = tools.config.serverConfig.MAX_BOARD_SIZE || 655360;
      const expectedWidth = Math.max(window.innerWidth, maxBoardSize * scale);
      const expectedHeight = Math.max(window.innerHeight, maxBoardSize * scale);
      return {
        expectedWidth,
        expectedHeight,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        rightAfterMaxScroll:
          document.documentElement.scrollLeft + window.innerWidth,
        bottomAfterMaxScroll:
          document.documentElement.scrollTop + window.innerHeight,
      };
    });

    expect(metrics.documentWidth).toBeGreaterThanOrEqual(
      Math.floor(metrics.expectedWidth) - 1,
    );
    expect(metrics.documentHeight).toBeGreaterThanOrEqual(
      Math.floor(metrics.expectedHeight) - 1,
    );
    expect(metrics.rightAfterMaxScroll).toBeGreaterThanOrEqual(
      Math.floor(metrics.expectedWidth) - 1,
    );
    expect(metrics.bottomAfterMaxScroll).toBeGreaterThanOrEqual(
      Math.floor(metrics.expectedHeight) - 1,
    );
  });

  test("reload applies the viewport encoded in the URL hash", async ({
    boardPage,
    page,
  }) => {
    const left = 1600;
    const top = 1200;
    const url = `${boardPage.buildBoardUrl("hash-reload-test")}#${left},${top},1.0`;

    await installBootPhaseRecorder(page);

    await page.goto(url);
    await expectViewportRestoreBeforeConnect(page, left, top);
    await page.waitForFunction(() => {
      const phase = document.documentElement.dataset.boardPhase;
      return phase === "ready" || phase === "error";
    });

    await page.reload();
    await expectViewportRestoreBeforeConnect(page, left, top);
    await page.waitForFunction(() => {
      const phase = document.documentElement.dataset.boardPhase;
      return phase === "ready" || phase === "error";
    });

    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        left,
        top,
      });
  });

  test("draw tools disable at giant shape zoom threshold", async ({
    boardPage,
  }) => {
    await boardPage.gotoBoard("zoom-threshold-test");
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.selectTool("pencil");
    await boardPage.page.evaluate(() => {
      window.WBOApp.viewportState.controller.setScale(0.04);
    });

    await boardPage.expectCurrentTool("pencil");
    await expect(boardPage.tool("pencil")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(boardPage.tool("pencil")).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(boardPage.tool("rectangle")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect
      .poll(() =>
        boardPage.page.evaluate(
          () => window.getComputedStyle(window.WBOApp.dom.svg).cursor,
        ),
      )
      .toBe("not-allowed");
    await expect
      .poll(() =>
        boardPage
          .tool("pencil")
          .evaluate((tool) => getComputedStyle(tool).borderColor),
      )
      .toContain("124, 45, 18");

    await boardPage.tool("pencil").click();
    await boardPage.expectCurrentTool("pencil");

    await boardPage.page.evaluate(() => {
      window.WBOApp.viewportState.controller.setScale(0.05);
    });
    await expect(boardPage.tool("pencil")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect
      .poll(() =>
        boardPage.page.evaluate(
          () => window.getComputedStyle(window.WBOApp.dom.svg).cursor,
        ),
      )
      .not.toBe("not-allowed");

    await boardPage.selectTool("pencil");
  });

  test("toolbar tools stay disabled until their modules are mounted", async ({
    boardPage,
  }) => {
    let releaseRectangleModule!: () => void;
    const rectangleModuleCanLoad = new Promise<void>((resolve) => {
      releaseRectangleModule = resolve;
    });
    const rectangleModuleRequested = new Promise<void>((resolve) => {
      void boardPage.page.route(
        "**/tools/rectangle/index.js",
        async (route) => {
          resolve();
          await rectangleModuleCanLoad;
          await route.continue();
        },
      );
    });

    await boardPage.gotoBoardShell("tool-ready-state-test");
    await rectangleModuleRequested;

    await expect(boardPage.statusIndicator).toBeVisible();
    await expect(boardPage.statusTitle).toHaveText("Loading");
    await expect(boardPage.tool("rectangle")).toHaveClass(/disabledTool/);
    await expect(boardPage.tool("rectangle")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    releaseRectangleModule();
    await boardPage.page.waitForFunction(
      () => document.documentElement.dataset.boardPhase === "ready",
    );
    await expect(boardPage.tool("rectangle")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(boardPage.tool("rectangle")).not.toHaveClass(/disabledTool/);
    await expect(boardPage.statusIndicator).toBeHidden();
  });

  test("download exports SVG content", async ({ boardPage, server }) => {
    await server.writeBoard(server.dataPath, "download-test", {
      "download-rect": {
        type: "rect",
        id: "download-rect",
        tool: "rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("download-test");
    await expect(boardPage.tool("download")).toBeVisible();
    await expect(boardPage.page.locator("#download-rect")).toBeVisible();
    await boardPage.installDownloadCapture();
    await boardPage.tool("download").click();

    await expect
      .poll(() => boardPage.readDownloadCapture())
      .toMatchObject({
        clicks: 1,
        href: "blob:test-download",
        download: "download-test.svg",
        hasSvgTag: true,
        hasRect: true,
        hasBoardStyles: true,
      });
  });

  test("selector duplicate and delete persist", async ({
    boardPage,
    server,
    page,
  }) => {
    await server.writeBoard(server.dataPath, "selector-advanced-test", {
      "seed-rect": {
        type: "rect",
        id: "seed-rect",
        tool: "rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-advanced-test");
    await expect(boardPage.tool("hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("hand");

    const result = await boardPage.duplicateSelectionAndDelete("seed-rect");
    expect(result.afterDuplicate).toHaveLength(2);
    expect(result.afterDuplicate.includes("seed-rect")).toBe(true);
    expect(result.afterDelete).toHaveLength(1);
    expect(result.afterDelete[0]).not.toBe("seed-rect");

    await server.waitForStoredBoard(
      server.dataPath,
      "selector-advanced-test",
      (storedBoard) => {
        const ids = Object.keys(storedBoard).filter(
          (id) => id !== "__wbo_meta__",
        );
        return ids.length === 1 && ids[0] !== "seed-rect";
      },
    );
    await page.reload();
    await expect(page.locator("#drawingArea rect")).toHaveCount(1);
    await expect(page.locator("#seed-rect")).toHaveCount(0);
  });
});
