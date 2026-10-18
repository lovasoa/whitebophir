import { expect, test } from "../fixtures/test";
import type { DrawingPerformanceSummary } from "../../types/app-runtime";

declare global {
  interface Window {
    drawingSummaries: DrawingPerformanceSummary[];
  }
}

for (const tool of ["pencil", "straight-line"]) {
  test(`${tool} waits for write readiness before starting a stroke`, async ({
    page,
    boardPage,
    server,
  }) => {
    let releaseConnection!: () => void;
    const connectionReady = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    await page.route("**/socket.io/**", async (route) => {
      if (route.request().resourceType() !== "script") await connectionReady;
      await route.continue();
    });
    const boardName = `feedback-startup-${tool}`;
    try {
      await page.goto(`${server.serverUrl}/boards/${boardName}#0,0,1`);
      await page.waitForFunction(
        () => document.documentElement.dataset.boardPhase === "ready",
      );
      await page.evaluate(async (name) => {
        await window.WBOApp.toolRegistry.activateTool(name);
        const { observeDrawingPerformance } = await import(
          new URL("../js/drawing_performance.js", location.href).href
        );
        window.drawingSummaries = [];
        observeDrawingPerformance((summary: DrawingPerformanceSummary) =>
          window.drawingSummaries.push(summary),
        );
      }, tool);
      await expect(boardPage.tool(tool)).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      await expect(boardPage.tool("hand")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      await expect(boardPage.statusTitle).toHaveText("Loading");
      await expect(page.locator("#canvas")).toHaveCSS("cursor", "not-allowed");
      await page.mouse.move(150, 240);
      await page.mouse.down();
      await page.mouse.move(300, 260, { steps: 10 });
      // Synchronization must not turn this ignored press into orphan updates.
      releaseConnection();
      await expect(boardPage.tool(tool)).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      await expect(page.locator("#canvas")).not.toHaveCSS(
        "cursor",
        "not-allowed",
      );
      await page.mouse.move(500, 290, { steps: 10 });
      await page.mouse.up();
      expect(await page.evaluate(() => window.drawingSummaries)).toEqual([]);
      await expect(page.locator("#drawingArea > *")).toHaveCount(0);
      expect(
        await page.evaluate(() => window.WBOApp.writes.bufferedWrites.length),
      ).toBe(0);

      await page.mouse.move(150, 350);
      await page.mouse.down();
      await page.mouse.move(500, 390, { steps: 20 });
      await page.mouse.up();
      await expect
        .poll(() => page.evaluate(() => window.drawingSummaries.length))
        .toBe(1);
      expect(
        await page.evaluate(() => window.drawingSummaries[0]?.feedbackCount),
      ).toBeGreaterThan(0);
      await server.waitForStoredBoard(
        server.dataPath,
        boardName,
        (board) =>
          Object.values(board).filter((item) => item?.tool === tool).length ===
          1,
      );
    } finally {
      releaseConnection();
    }
  });

  test(`${tool} reports local feedback and preserves authoritative drawing`, async ({
    page,
    boardPage,
    server,
  }) => {
    const boardName = `feedback-${tool}`;
    await boardPage.gotoBoard(boardName);
    await boardPage.selectTool(tool);
    await page.evaluate(async () => {
      const url = new URL("../js/drawing_performance.js", location.href).href;
      const { observeDrawingPerformance } = await import(url);
      window.drawingSummaries = [];
      observeDrawingPerformance((summary: DrawingPerformanceSummary) =>
        window.drawingSummaries.push(summary),
      );
    });
    await page.mouse.move(150, 240);
    await page.mouse.down();
    await page.mouse.move(450, 300, { steps: 25 });
    if (tool === "pencil") {
      const endpoint = await page.evaluate(() => {
        const target = document.querySelector(".wbo-pencil-live-overlay");
        if (!target) throw Error("missing overlay");
        // The second input is guaranteed to fall inside Pencil's point
        // interval. It must reach the ink even if no further input arrives.
        for (const x of [460, 470])
          target.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: x,
              clientY: 310,
              buttons: 1,
            }),
          );
        const coordinates = window.WBOApp.coordinates;
        return ` ${coordinates.pageCoordinateToBoard(470 + scrollX)} ${coordinates.pageCoordinateToBoard(310 + scrollY)}`;
      });
      await expect
        .poll(() =>
          page.evaluate(
            (suffix) =>
              document
                .querySelector(".wbo-pencil-live-path")
                ?.getAttribute("d")
                ?.endsWith(suffix),
            endpoint,
          ),
        )
        .toBe(true);
      await page.mouse.move(470, 310);
    }
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.drawingSummaries.length))
      .toBe(1);
    const summary = await page.evaluate(() => window.drawingSummaries[0]);
    expect(summary?.toolId).toBe(tool);
    expect(summary?.terminationReason).toBe("release");
    expect(summary?.feedbackCount).toBeGreaterThan(0);
    expect(summary?.maxFeedbackWaitMs).toBeGreaterThan(0);
    expect(summary?.maxFeedbackWaitMs).toBeGreaterThanOrEqual(
      summary?.meanFeedbackWaitMs ?? 0,
    );
    await expect(
      page.locator(`#drawingArea ${tool === "pencil" ? "path" : "line"}`),
    ).toHaveCount(1);
    await server.waitForStoredBoard(server.dataPath, boardName, (board) =>
      Object.values(board).some((item) => item?.tool === tool),
    );
  });
}

test("touch cancellation publishes the measured portion and deletes the stroke", async ({
  page,
  boardPage,
}) => {
  await boardPage.gotoBoard("feedback-touch-cancel");
  await boardPage.selectTool("pencil");
  await page.evaluate(async () => {
    const url = new URL("../js/drawing_performance.js", location.href).href;
    const { observeDrawingPerformance } = await import(url);
    window.drawingSummaries = [];
    observeDrawingPerformance((s: DrawingPerformanceSummary) =>
      window.drawingSummaries.push(s),
    );
    const target = document.querySelector(".wbo-pencil-live-overlay");
    if (!target) throw Error("missing overlay");
    const touch = (x: number) =>
      new Touch({
        identifier: 1,
        target,
        clientX: x,
        clientY: 240,
        pageX: x,
        pageY: 240,
      });
    const send = (type: string, touches: Touch[], changedTouches: Touch[]) =>
      target.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches,
          changedTouches,
        }),
      );
    send("touchstart", [touch(150)], [touch(150)]);
    send("touchmove", [touch(250)], [touch(250)]);
    // A second touch transfers this gesture to the browser and cancels Pencil.
    const second = new Touch({ identifier: 2, target, pageX: 350, pageY: 240 });
    send("touchstart", [touch(250), second], [second]);
  });
  await expect
    .poll(() => page.evaluate(() => window.drawingSummaries.length))
    .toBe(1);
  expect(
    await page.evaluate(() => window.drawingSummaries[0]?.terminationReason),
  ).toBe("cancel");
  await expect(page.locator("#drawingArea path")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.WBOApp.writes.bufferedWrites.length))
    .toBe(0);
});
