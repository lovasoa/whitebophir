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

async function expectViewportRestoreAfterConnect(
  page: Page,
  left: number,
  top: number,
) {
  await waitForRecordedPhase(page, "viewport-restored");
  const phases = await readBootPhaseSnapshots(page);
  const viewportRestoredIndex = phases.findIndex(
    (entry) => entry.phase === "viewport-restored",
  );
  const connectingIndex = phases.findIndex(
    (entry) => entry.phase === "connecting",
  );
  expect(viewportRestoredIndex).toBeGreaterThanOrEqual(0);
  expect(connectingIndex).toBeGreaterThanOrEqual(0);
  expect(viewportRestoredIndex).toBeGreaterThan(connectingIndex);
  expect(phases[viewportRestoredIndex]).toMatchObject({
    phase: "viewport-restored",
    left,
    top,
    boardPhase: "viewport-restored",
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
    const before = await page.evaluate(() => window.Tools.getScale());

    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 400);

    await page.waitForFunction((previousScale) => {
      return window.Tools.getScale() < previousScale;
    }, before);
    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        top: 0,
      });
  });

  test("shift wheel pans without zooming", async ({ boardPage, page }) => {
    await boardPage.gotoBoard("shift-wheel-pan-test");
    await page.evaluate(() => {
      window.Tools.resizeCanvas({ x: 5000, y: 5000 });
      window.Tools.setScale(1);
      window.scrollTo(0, 0);
    });
    const before = await page.evaluate(() => window.Tools.getScale());

    await page.mouse.move(500, 400);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 300);
    await page.keyboard.up("Shift");

    await expect
      .poll(() => boardPage.scrollPosition())
      .toMatchObject({
        top: 300,
      });
    expect(await page.evaluate(() => window.Tools.getScale())).toBe(before);
  });

  test("zoomed-out board does not scroll past the scaled svg", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("zoomed-out-scroll-bounds-test");

    const metrics = await page.evaluate(() => {
      const tools = window.Tools;
      if (!tools.svg || !tools.board) {
        throw new Error("Board runtime is not attached.");
      }
      tools.resizeCanvas({ x: 10000, y: 8000 });
      tools.setScale(1);
      tools.setScale(0.5);
      window.scrollTo(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

      const scale = tools.getScale();
      const expectedWidth = Math.max(
        window.innerWidth,
        tools.svg.width.baseVal.value * scale,
      );
      const expectedHeight = Math.max(
        window.innerHeight,
        tools.svg.height.baseVal.value * scale,
      );
      const boardRect = tools.board.getBoundingClientRect();
      const svgRect = tools.svg.getBoundingClientRect();
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
      if (window.Tools.curTool?.name !== "hand") window.Tools.change("hand");
      if (window.Tools.curTool?.secondary?.active === true) {
        window.Tools.change("hand");
      }
    });
    await boardPage.expectCurrentTool("hand");
    await page.evaluate(() => {
      window.Tools.resizeCanvas({ x: 5000, y: 5000 });
      window.Tools.setScale(1);
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

  test("reload applies the viewport encoded in the URL hash", async ({
    boardPage,
    page,
  }) => {
    const left = 1600;
    const top = 1200;
    const url = `${boardPage.buildBoardUrl("hash-reload-test")}#${left},${top},1.0`;

    await installBootPhaseRecorder(page);

    await page.goto(url);
    await expectViewportRestoreAfterConnect(page, left, top);
    await page.waitForFunction(() => {
      const phase = document.documentElement.dataset.boardPhase;
      return phase === "ready" || phase === "error";
    });

    await page.reload();
    await expectViewportRestoreAfterConnect(page, left, top);
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
      window.Tools.setScale(0.04);
    });

    await boardPage.expectCurrentTool("hand");
    await expect(boardPage.tool("pencil")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(boardPage.tool("rectangle")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await boardPage.tool("pencil").click();
    await boardPage.expectCurrentTool("hand");

    await boardPage.page.evaluate(() => {
      window.Tools.setScale(0.05);
    });
    await expect(boardPage.tool("pencil")).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    await boardPage.selectTool("pencil");
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
