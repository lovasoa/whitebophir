import { createBoardPage, expect, test } from "../fixtures/test";
import type { DrawingPerformanceSummary } from "../../types/app-runtime";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "../../client-data/tools/tool-order.js";

declare global {
  interface Window {
    drawingSummaries: DrawingPerformanceSummary[];
  }
}

test("collaborative drawing bounds rendering work per update", async ({
  page,
  boardPage,
  server,
}) => {
  await boardPage.gotoBoard("collaborative-rendering-budget");
  await boardPage.selectTool("pencil");
  await boardPage.waitForBoardWritable();
  await page.mouse.move(150, 240);
  await page.mouse.down();
  await page.mouse.move(180, 250);
  const work = await page.evaluate(
    async ({ pencil, rectangle, hand, create, append, update }) => {
      const app = window.WBOApp;
      const remoteCount = 7;
      const movedCount = 8;
      await app.toolRegistry.bootTool("hand");
      for (let i = 0; i < movedCount; i++) {
        app.replay.incomingBroadcastQueue.push({
          tool: rectangle,
          type: create,
          id: `moved-${i}`,
          color: "#123456",
          size: 10,
          x: i * 20,
          y: 100,
          x2: i * 20 + 10,
          y2: 120,
        });
      }
      await app.replay.drainIncomingBroadcastQueue();
      // Exercise the real receive pipeline, without socket delivery or machine
      // speed determining how many points happen to arrive in a rendering step.
      for (let i = 0; i < remoteCount; i++) {
        app.replay.incomingBroadcastQueue.push({
          tool: pencil,
          type: create,
          id: `remote-${i}`,
          color: "#123456",
          size: 10,
          socket: `peer-${i}`,
        });
      }
      await app.replay.drainIncomingBroadcastQueue();
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((batch) => records.push(...batch));
      const drawingArea = document.getElementById("drawingArea");
      if (!drawingArea) throw Error("Missing drawing area");
      observer.observe(document.getElementById("board") ?? drawingArea, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      try {
        for (let step = 0; step < 3; step++) {
          for (let point = step * 64; point < (step + 1) * 64; point++) {
            for (let i = 0; i < remoteCount; i++) {
              app.replay.incomingBroadcastQueue.push({
                tool: pencil,
                type: append,
                parent: `remote-${i}`,
                x: 100 + point * 3,
                y: 400 + i * 10 + (point % 2),
                socket: `peer-${i}`,
              });
            }
          }
          app.replay.incomingBroadcastQueue.push({
            tool: hand,
            _children: Array.from({ length: movedCount }, (_, i) => ({
              type: update,
              id: `moved-${i}`,
              transform: { a: 1, b: 0, c: 0, d: 1, e: step * 10, f: step * 5 },
            })),
          });
          await app.replay.drainIncomingBroadcastQueue();
          await new Promise(requestAnimationFrame);
          const endpoints = Array.from(
            document.querySelectorAll<SVGPathElement>("#board path"),
            (path) => path.getPathData().at(-1)?.values.slice(-2),
          );
          for (let i = 0; i < remoteCount; i++) {
            if (
              !endpoints.some(
                (point) =>
                  point?.[0] === 100 + ((step + 1) * 64 - 1) * 3 &&
                  point[1] === 401 + i * 10,
              )
            )
              throw Error("Remote feedback did not reach the current endpoint");
          }
        }
        records.push(...observer.takeRecords());
        return {
          densePathWrites: records.filter(
            (record) =>
              record.attributeName === "d" &&
              drawingArea.contains(record.target),
          ).length,
          totalPathWrites: records.filter(
            (record) => record.attributeName === "d",
          ).length,
          visualWrites: records.length,
          remoteCount,
          movedCount,
        };
      } finally {
        observer.disconnect();
      }
    },
    {
      pencil: TOOL_CODE_BY_ID.pencil,
      rectangle: TOOL_CODE_BY_ID.rectangle,
      hand: TOOL_CODE_BY_ID.hand,
      create: MutationType.CREATE,
      append: MutationType.APPEND,
      update: MutationType.UPDATE,
    },
  );
  await page.mouse.up();
  const endpoints = await page.evaluate(() =>
    Array.from({ length: 7 }, (_, i) => {
      const line = document.querySelector<SVGPathElement>(`#remote-${i}`);
      if (!line) throw Error("Missing remote path");
      return line.getPathData().at(-1)?.values.slice(-2);
    }),
  );
  expect(endpoints).toEqual(
    Array.from({ length: 7 }, (_, i) => [673, 401 + i * 10]),
  );
  await boardPage.waitForBufferedWritesDrained();
  await server.waitForStoredBoard(
    server.dataPath,
    "collaborative-rendering-budget",
    (board) => Object.values(board).some((item) => item?.tool === "pencil"),
  );
  // Generous per-stroke headroom, independent of CPU speed and point count.
  expect(work.densePathWrites).toBeLessThanOrEqual(work.remoteCount * 2);
  expect(work.totalPathWrites).toBeLessThanOrEqual(work.remoteCount * 3 * 2);
  expect(work.visualWrites).toBeLessThanOrEqual(
    (work.remoteCount + work.movedCount) * 3 * 20,
  );
});

test("deferred remote ink survives editing, idle commit and baseline replacement", async ({
  page,
  boardPage,
  context,
  server,
}) => {
  const boardName = "remote-ink-lifecycle";
  await boardPage.gotoBoard(boardName);
  await boardPage.selectTool("pencil");
  await boardPage.waitForBoardWritable();
  const peerPage = await context.newPage();
  const peer = createBoardPage(peerPage, server);
  await peer.gotoBoard(boardName);
  await peer.waitForBoardWritable();
  const create = (id: string) =>
    peer.emitBroadcast({
      tool: TOOL_CODE_BY_ID.pencil,
      type: MutationType.CREATE,
      id,
      color: "#123456",
      size: 10,
    });
  const append = (parent: string, x: number, y: number) =>
    peer.emitBroadcast({
      tool: TOOL_CODE_BY_ID.pencil,
      type: MutationType.APPEND,
      parent,
      x,
      y,
    });
  const feedback = (x: number, y: number) =>
    page.waitForFunction(
      ({ x, y }) =>
        Array.from(
          document.querySelectorAll<SVGPathElement>("#board path"),
        ).some((path) => {
          const point = path.getPathData().at(-1)?.values.slice(-2);
          return point?.[0] === x && point[1] === y;
        }),
      { x, y },
      { timeout: 5000 },
    );

  await page.mouse.move(150, 240);
  await page.mouse.down();
  await page.mouse.move(180, 250);
  await create("peer-ink");
  await append("peer-ink", 1000, 900);
  await append("peer-ink", 1400, 1100);
  await feedback(1400, 1100);
  const snapshot = await page.evaluate((eraser) => {
    const rollback = window.WBOApp.optimistic.captureRollback({
      tool: eraser,
      type: 3,
      id: "peer-ink",
    });
    if (rollback.kind !== "items") throw Error("Missing item snapshot");
    return rollback.snapshots[0]?.outerHTML;
  }, TOOL_CODE_BY_ID.eraser);
  expect(snapshot).toContain("1400 1100");
  expect(snapshot).not.toContain("visibility: hidden");
  await append("peer-ink", 1500, 1200);
  await feedback(1500, 1200);
  await peer.emitBroadcast({
    tool: TOOL_CODE_BY_ID.hand,
    _children: [
      { type: MutationType.COPY, id: "peer-ink", newid: "peer-copy" },
    ],
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const source = document.getElementById("peer-ink")?.getAttribute("d");
        const copy = document.getElementById("peer-copy")?.getAttribute("d");
        return !!copy && copy === source && copy.endsWith("1500 1200");
      }),
    )
    .toBe(true);
  await append("peer-ink", 1600, 1300);
  await peer.emitBroadcast({
    tool: TOOL_CODE_BY_ID.eraser,
    type: MutationType.DELETE,
    id: "peer-ink",
  });
  await expect(page.locator("#peer-ink")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("#peer-ink")).toHaveCount(0);

  await create("peer-idle");
  await append("peer-idle", 1700, 1400);
  await expect(page.locator("#drawingArea #peer-idle")).toHaveCount(1);
  await page.mouse.down();
  await append("peer-idle", 1800, 1500);
  await feedback(1800, 1500);
  // refreshAuthoritativeBaseline reads stored SVG; wait for that authoritative
  // snapshot rather than assuming the save has completed with the broadcast.
  await server.waitForStoredBoard(
    server.dataPath,
    boardName,
    (board) => board["peer-idle"]?.childCount === 2,
  );
  await page.evaluate(() =>
    window.WBOApp.replay.refreshAuthoritativeBaseline(),
  );
  await page.mouse.up();
  await expect(page.locator("#drawingArea #peer-idle")).toHaveAttribute(
    "d",
    /1800 1500$/,
  );
  expect(
    await page.evaluate(() =>
      Array.from(
        document.querySelectorAll("#board > svg:not(#canvas) path"),
      ).filter((path) => path.getAttribute("d")),
    ),
  ).toEqual([]);
  await server.waitForStoredBoard(
    server.dataPath,
    boardName,
    (board) => !board["peer-ink"] && board["peer-copy"] && board["peer-idle"],
  );
  await peerPage.close();
});

test("drawing works with a cached fixed-window rate-limit API", async ({
  page,
  boardPage,
  server,
}) => {
  // A cached common module can predate the rolling-budget exports.
  await page.route("**/js/rate_limit_common.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `import current from "./rate_limit_common.js?complete-api";
        const {recordRateLimitUsage, getRateLimitHistoryWaitMs, ...legacy} = current;
        export default legacy;`,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const boardName = "feedback-cached-rate-api";
  await boardPage.gotoBoard(boardName);
  await boardPage.selectTool("pencil");
  await page.mouse.move(150, 240);
  await page.mouse.down();
  await page.mouse.move(450, 300, { steps: 25 });
  await page.mouse.up();
  await server.waitForStoredBoard(
    server.dataPath,
    boardName,
    (board) =>
      Object.values(board).filter((item) => item?.tool === "pencil").length ===
      1,
  );
  expect(errors).toEqual([]);
});

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
    const drawingCursor = () =>
      page.evaluate(() => {
        const target = document.elementFromPoint(150, 240);
        if (!target) throw Error("Missing drawing surface");
        return getComputedStyle(target).cursor;
      });
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
      await expect.poll(drawingCursor).toBe("not-allowed");
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
      await expect
        .poll(drawingCursor)
        .toBe(
          await page
            .locator("#canvas")
            .evaluate((canvas) => getComputedStyle(canvas).cursor),
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
