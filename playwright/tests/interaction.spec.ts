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
  await waitForRecordedPhase(page, "connecting");
  const phases = await readBootPhaseSnapshots(page);
  const viewportRestoredIndex = phases.findIndex(
    (entry) => entry.phase === "viewport-restored",
  );
  const connectingIndex = phases.findIndex(
    (entry) => entry.phase === "connecting",
  );
  expect(viewportRestoredIndex).toBeGreaterThanOrEqual(0);
  expect(connectingIndex).toBeGreaterThan(viewportRestoredIndex);
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
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-test");
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("Hand");

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
    await expect(boardPage.tool("Zoom")).toBeVisible();
    await boardPage.selectTool("Zoom");

    const result = await boardPage.zoomClickInAndOut({ x: 200, y: 200 });
    expect(Math.abs(result.scaleAfterZoomIn - 1.5)).toBeLessThan(0.01);
    expect(Math.abs(result.scaleAfterZoomOut - 0.75)).toBeLessThan(0.01);
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
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(boardPage.tool("Pencil")).toBeVisible();
    await boardPage.selectTool("Pencil");
    await boardPage.page.evaluate(() => {
      (window as any).Tools.setScale(0.4);
    });

    await boardPage.expectCurrentTool("Hand");
    await expect(boardPage.tool("Pencil")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(boardPage.tool("Rectangle")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await boardPage.tool("Pencil").click();
    await boardPage.expectCurrentTool("Hand");

    await boardPage.page.evaluate(() => {
      (window as any).Tools.setScale(0.5);
    });
    await expect(boardPage.tool("Pencil")).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    await boardPage.selectTool("Pencil");
  });

  test("download exports SVG content", async ({ boardPage, server }) => {
    await server.writeBoard(server.dataPath, "download-test", {
      "download-rect": {
        type: "rect",
        id: "download-rect",
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("download-test");
    await expect(boardPage.tool("Download")).toBeVisible();
    await expect(boardPage.page.locator("#download-rect")).toBeVisible();
    await boardPage.installDownloadCapture();
    await boardPage.tool("Download").click();

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

  test("tool stylesheets include the current asset version", async ({
    boardPage,
    page,
  }) => {
    await boardPage.gotoBoard("tool-stylesheet-versioning");
    await expect(boardPage.tool("Rectangle")).toBeVisible();
    await boardPage.selectTool("Rectangle");

    const stylesheets = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("link[rel='stylesheet']"),
      ).map((link) => link.getAttribute("href") ?? "");
    });

    expect(stylesheets.some((href) => /board\.css\?v=/.test(href))).toBe(true);
    expect(
      stylesheets.some((href) =>
        /tools\/rectangle\/rectangle\.css\?v=/.test(href),
      ),
    ).toBe(true);
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
        tool: "Rectangle",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
      },
    });

    await boardPage.gotoBoard("selector-advanced-test");
    await expect(boardPage.tool("Hand")).toBeVisible();
    await expect(page.locator("#seed-rect")).toBeVisible();
    await boardPage.selectTool("Hand");

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
