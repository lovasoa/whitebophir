import { expect, test } from "../fixtures/test";
import type { DrawingPerformanceSummary } from "../../types/app-runtime";

declare global {
  interface Window {
    drawingSummaries: DrawingPerformanceSummary[];
  }
}

for (const tool of ["pencil", "straight-line"]) {
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
