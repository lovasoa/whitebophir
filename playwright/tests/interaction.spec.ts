import type { Page } from "@playwright/test";
import { createBoardPage, expect, test } from "../fixtures/test";

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
  test("authoritative delete removes queued copies that depend on a removed copy", async ({
    boardPage,
    server,
    page,
    context,
  }) => {
    const boardName = "copy-chain-peer-delete";
    const rectangle = {
      type: "rect",
      tool: "rectangle",
      x: 100,
      y: 100,
      x2: 160,
      y2: 140,
      color: "#123456",
      size: 4,
    };
    await server.writeBoard(server.dataPath, boardName, {
      "seed-rect": { ...rectangle, id: "seed-rect" },
      "unrelated-rect": { ...rectangle, id: "unrelated-rect", x: 250, x2: 310 },
    });
    const peer = await context.newPage();
    const peerBoard = createBoardPage(peer, server);
    await boardPage.gotoBoard(boardName);
    await peerBoard.gotoBoard(boardName);
    await boardPage.waitForBoardWritable();
    await peerBoard.waitForBoardWritable();
    await boardPage.selectTool("hand");
    const queued = await page.evaluate(async () => {
      const app = window.WBOApp;
      const js = "/js/";
      const tools = "/tools/";
      const { MutationType } = await import(`${js}message_tool_metadata.js`);
      const { TOOL_CODE_BY_ID } = await import(`${tools}tool-order.js`);
      const originalBudgetWait = app.writes.getBufferedWriteBudgetWaitMs;
      const testState = window as unknown as { restoreCopyBudget: () => void };
      testState.restoreCopyBudget = () => {
        app.writes.getBufferedWriteBudgetWaitMs = originalBudgetWait;
      };
      // Keep these generated copies local until the peer's delete arrives.
      app.writes.getBufferedWriteBudgetWaitMs = () => 60_000;
      for (const [id, newid] of [
        ["seed-rect", "queued-copy-source"],
        ["queued-copy-source", "queued-copy-child"],
        ["unrelated-rect", "after-copy"],
      ]) {
        app.writes.drawAndSend({
          tool: TOOL_CODE_BY_ID.hand,
          _children: [{ type: MutationType.COPY, id, newid }],
        });
      }
      const entries = app.optimistic.journal.list();
      return {
        buffered: app.writes.bufferedWrites.length,
        journal: entries.length,
        dependent: entries[1]?.dependsOn.has(entries[0].clientMutationId),
        independent: entries[2]?.dependsOn.size === 0,
      };
    });
    expect(queued).toEqual({
      buffered: 3,
      journal: 3,
      dependent: true,
      independent: true,
    });
    await expect(
      page.locator("#queued-copy-source, #queued-copy-child"),
    ).toHaveCount(2);
    await peerBoard.selectTool("eraser");
    await peerBoard.eraseShapeById("seed-rect");
    await expect(
      page.locator("#seed-rect, #queued-copy-source, #queued-copy-child"),
    ).toHaveCount(0);
    await expect(
      peer.locator("#seed-rect, #queued-copy-source, #queued-copy-child"),
    ).toHaveCount(0);
    await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (stored) =>
        Object.keys(stored).length === 1 && !!stored["unrelated-rect"],
    );
    const pending = await page.evaluate(() => ({
      buffered: window.WBOApp.writes.bufferedWrites.length,
      journal: window.WBOApp.optimistic.journal.list().length,
    }));
    expect(pending).toEqual({ buffered: 1, journal: 1 });
    await page.evaluate(() => {
      const app = window.WBOApp;
      (
        window as unknown as { restoreCopyBudget: () => void }
      ).restoreCopyBudget();
      for (const write of app.writes.bufferedWrites) write.notBeforeMs = 0;
      app.writes.pumpBufferedWrites();
    });
    await expect(page.locator("#after-copy")).toHaveCount(1);
    await expect(peer.locator("#after-copy")).toHaveCount(1);
    await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (stored) =>
        Object.keys(stored).length === 2 &&
        !!stored["unrelated-rect"] &&
        !!stored["after-copy"],
    );
  });

  test("selector cancels scaling when a peer removes a selected element", async ({
    boardPage,
    server,
    page,
    context,
  }) => {
    const boardName = "selector-peer-delete";
    await server.writeBoard(server.dataPath, boardName, {
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
    const peer = await context.newPage();
    const peerBoard = createBoardPage(peer, server);
    await boardPage.gotoBoard(boardName);
    await peerBoard.gotoBoard(boardName);
    await boardPage.waitForBoardWritable();
    await peerBoard.waitForBoardWritable();
    await boardPage.selectTool("hand");
    const shapeBounds = await page.locator("#seed-rect").boundingBox();
    if (!shapeBounds) throw new Error("Missing selected rectangle bounds");
    await page.mouse.move(shapeBounds.x - 10, shapeBounds.y - 10);
    await page.mouse.down();
    await page.mouse.move(
      shapeBounds.x + shapeBounds.width + 10,
      shapeBounds.y + shapeBounds.height + 10,
      { steps: 4 },
    );
    await page.mouse.up();
    const handle = page.locator("#selectionButton-scaleHandle");
    await expect(handle).toBeVisible();
    await handle.dispatchEvent("mousedown");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const selection = document.getElementById(
            "selectionRect",
          ) as unknown as SVGRectElement;
          window.WBOApp.toolRegistry.current?.listeners.move?.(
            selection.x.baseVal.value + selection.width.baseVal.value * 1.5,
            selection.y.baseVal.value + selection.height.baseVal.value * 1.5,
            new MouseEvent("mousemove"),
            false,
          );
          const rect = document.getElementById(
            "seed-rect",
          ) as unknown as SVGGraphicsElement;
          return rect.transform.baseVal[0]?.matrix.a ?? 1;
        }),
      )
      .toBeGreaterThan(1);
    await peerBoard.selectTool("eraser");
    await peerBoard.eraseShapeById("seed-rect");
    await expect(page.locator("#seed-rect")).toHaveCount(0);
    await server.waitForStoredBoard(
      server.dataPath,
      boardName,
      (stored) => Object.keys(stored).length === 0,
    );
    await page.evaluate(() => {
      const tool = window.WBOApp.toolRegistry.current;
      tool?.listeners.move?.(260, 220, new MouseEvent("mousemove"), false);
      tool?.listeners.release?.(260, 220, new MouseEvent("mouseup"), false);
    });
    await expect(handle).toBeHidden();
    await expect(page.locator("#selectionRectOverlay")).toBeHidden();
    await expect(page.locator("#seed-rect")).toHaveCount(0);
    await expect(peer.locator("#seed-rect")).toHaveCount(0);
  });

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

  test("style settings panel supports hover, click, and keyboard modes", async ({
    boardPage,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await boardPage.gotoBoard("style-settings-disclosure-test");

    const styleTool = page.locator("#styleTool");
    const styleSummary = page.locator("#styleSummary");
    const stylePanel = page.locator("#stylePanel");

    await expect(styleTool).not.toHaveAttribute("open", "");
    await expect(stylePanel).toBeHidden();

    await styleTool.hover();
    await expect(stylePanel).toBeVisible();
    const toolBox = await styleSummary.boundingBox();
    if (!toolBox) throw new Error("Missing style panel geometry");
    // The panel slides in via a CSS translateX transition, so poll until
    // the rendered gap reflects the final positioned offset.
    await expect
      .poll(async () => {
        const box = await stylePanel.boundingBox();
        return box ? box.x - (toolBox.x + toolBox.width) : -1;
      })
      .toBeGreaterThan(4);
    const panelBox = await stylePanel.boundingBox();
    if (!panelBox) throw new Error("Missing style panel geometry");
    const panelGap = panelBox.x - (toolBox.x + toolBox.width);
    expect(panelGap).toBeLessThan(12);
    expect(Math.abs(panelBox.y - toolBox.y)).toBeLessThan(5);
    await page.mouse.move(panelBox.x + 8, panelBox.y + 8, { steps: 8 });
    await expect(stylePanel).toBeVisible();

    await page.mouse.move(700, 300);
    await expect(stylePanel).toBeHidden();

    await styleSummary.click();
    await expect(styleTool).toHaveAttribute("open", "");
    await page.mouse.move(700, 300);
    await expect(stylePanel).toBeVisible();

    await styleSummary.click();
    await expect(styleTool).not.toHaveAttribute("open", "");
    await expect(stylePanel).toBeHidden();

    await styleSummary.focus();
    await page.keyboard.press("Enter");
    await expect(styleTool).toHaveAttribute("open", "");
    await expect(stylePanel).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 610 });
    await expect
      .poll(async () => {
        const compactToolBox = await styleSummary.boundingBox();
        const compactPanelBox = await stylePanel.boundingBox();
        if (!compactToolBox || !compactPanelBox) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.abs(
          compactPanelBox.y +
            compactPanelBox.height -
            (compactToolBox.y + compactToolBox.height),
        );
      })
      .toBeLessThan(5);
  });

  test("zoom clicks in and out", async ({ boardPage }) => {
    await boardPage.gotoBoard("zoom-test", { lang: "fr" });
    await expect(boardPage.tool("zoom")).toBeVisible();
    await expect(boardPage.tool("zoom")).toContainText("Zoom");
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
          () =>
            window.getComputedStyle(window.WBOApp.dom.svg as SVGSVGElement)
              .cursor,
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
          () =>
            window.getComputedStyle(window.WBOApp.dom.svg as SVGSVGElement)
              .cursor,
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

  test("download exports SVG at default zoom regardless of the viewport", async ({
    boardPage,
    server,
    page,
    context,
  }) => {
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
    const extent = await page.evaluate(() => {
      const { svg } = window.WBOApp.dom;
      if (!svg) throw new Error("Missing canvas");
      window.WBOApp.viewportState.controller.setScale(0.5);
      window.scrollTo(100, 100);
      // Whole-board exports must use the known extent, without measuring every item.
      svg.getBBox = () => {
        throw new Error("Board-wide geometry scan");
      };
      return {
        width: svg.width.baseVal.value,
        height: svg.height.baseVal.value,
      };
    });
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
    const exported = await context.newPage();
    await exported.goto(
      `data:image/svg+xml,${encodeURIComponent((await boardPage.readDownloadCapture()).svg)}`,
    );
    await expect(exported.locator("svg")).toHaveAttribute(
      "viewBox",
      `0 0 ${extent.width} ${extent.height}`,
    );
    await expect(exported.locator("svg")).toHaveAttribute(
      "width",
      String(extent.width * 0.1),
    );
    await expect(exported.locator("svg")).toHaveAttribute(
      "height",
      String(extent.height * 0.1),
    );
    const rect = await exported.locator("#download-rect").boundingBox();
    expect(rect?.width).toBeCloseTo(64);
    expect(rect?.height).toBeCloseTo(44);
    await expect(exported.locator("#download-rect")).toHaveCSS("fill", "none");
    await expect(exported.locator("parsererror")).toHaveCount(0);
  });

  test("selector downloads only selected objects with cropped transformed bounds", async ({
    boardPage,
    server,
    page,
    context,
  }) => {
    await server.writeBoard(server.dataPath, "selection-download", {
      "selected-back": {
        type: "rect",
        id: "selected-back",
        tool: "rectangle",
        x: 200,
        y: 150,
        x2: 260,
        y2: 190,
        color: "#123456",
        size: 4,
        transform: { a: 1.5, b: 0, c: 0, d: 2, e: 100, f: 100 },
      },
      "selected-front": {
        type: "line",
        id: "selected-front",
        tool: "straight-line",
        x: 220,
        y: 160,
        x2: 280,
        y2: 160,
        color: "#ff0000",
        size: 6,
      },
      unselected: {
        type: "rect",
        id: "unselected",
        tool: "rectangle",
        x: 800,
        y: 150,
        x2: 850,
        y2: 190,
        color: "#123456",
        size: 4,
      },
    });
    await boardPage.gotoBoard("selection-download");
    await boardPage.waitForBoardWritable();
    await boardPage.selectTool("hand");
    const back = await page.locator("#selected-back").boundingBox();
    const front = await page.locator("#selected-front").boundingBox();
    if (!back || !front) throw new Error("Missing selection shapes");
    const left = Math.min(back.x, front.x) - 10;
    const top = Math.min(back.y, front.y) - 10;
    const right = Math.max(back.x + back.width, front.x + front.width) + 10;
    const bottom = Math.max(back.y + back.height, front.y + front.height) + 10;
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 4 });
    await page.mouse.up();
    const download = page.locator("#selectionButton-download");
    await expect(download).toBeVisible();
    await expect(download).toHaveAccessibleName("Download");
    await expect(download.locator("img")).toHaveJSProperty("complete", true);
    expect(
      await download
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await page.evaluate(() =>
      window.WBOApp.viewportState.controller.setScale(0.2),
    );
    const original = await page.locator("#drawingArea").innerHTML();
    await boardPage.installDownloadCapture();
    await download.click();
    const captured = await boardPage.readDownloadCapture();
    expect(captured.download).toBe("selection-download-selection.svg");
    const exported = await context.newPage();
    await exported.goto(
      `data:image/svg+xml,${encodeURIComponent(captured.svg)}`,
    );
    await expect(exported.locator("#drawingArea > *")).toHaveCount(2);
    expect(
      await exported
        .locator("#drawingArea > *")
        .evaluateAll((elements) => elements.map((element) => element.id)),
    ).toEqual(["selected-back", "selected-front"]);
    await expect(
      exported.locator("#unselected, #selectionRect, .hand-selection-button"),
    ).toHaveCount(0);
    await expect(exported.locator("#selected-back")).toHaveCSS("fill", "none");
    // The crop includes both objects and their transformed stroke widths.
    const crop = await exported.locator("svg").boundingBox();
    const exportedBack = await exported.locator("#selected-back").boundingBox();
    const exportedFront = await exported
      .locator("#selected-front")
      .boundingBox();
    if (!crop || !exportedBack || !exportedFront)
      throw new Error("Missing exported geometry");
    expect(exportedBack.width).toBeCloseTo(back.width);
    expect(exportedBack.height).toBeCloseTo(back.height);
    expect(exportedFront.width).toBeCloseTo(front.width);
    expect(crop.width).toBeCloseTo(
      Math.max(back.x + back.width, front.x + front.width) -
        Math.min(back.x, front.x),
    );
    expect(crop.height).toBeCloseTo(
      Math.max(back.y + back.height, front.y + front.height) -
        Math.min(back.y, front.y),
    );
    await expect(page.locator("#drawingArea")).toHaveJSProperty(
      "innerHTML",
      original,
    );
    await expect(download).toBeVisible();
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

    const measurement = await page.locator("#seed-rect").evaluate((element) => {
      const before = element.getAttribute("transform");
      const shape = element as SVGGraphicsElement & {
        transformedBBox(): unknown;
      };
      const bounds = shape.transformedBBox();
      return { before, after: element.getAttribute("transform"), bounds };
    });
    expect(measurement.before).toBeNull();
    expect(measurement.after).toBeNull();
    expect(measurement.bounds).toEqual({
      r: [1000, 1000],
      a: [600, 0],
      b: [0, 400],
    });

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
