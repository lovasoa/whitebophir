// Generated data only. npm run bench:drawing. JSON lines compare collection off/on
// on sparse/dense boards, at normal/6x CPU. Optional WBO_BENCH_REPEATS (default 3).
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { writeBoardState } from "../server/persistence/svg_board_store.mjs";

const historyDir = await mkdtemp(path.join(os.tmpdir(), "wbo-drawing-bench-"));
const env = /** @type {NodeJS.ProcessEnv} */ ({
  ...process.env,
  PORT: "0",
  WBO_HISTORY_DIR: historyDir,
  WBO_SILENT: "true",
  WBO_MAX_EMIT_COUNT: "*:10000/5s",
});
delete env.WBO_HTML_HEAD_SNIPPET_PATH;
const server = fork("./server/server.mjs", [], {
  env,
  silent: true,
  execArgv: [],
});
server.stderr?.pipe(process.stderr);
let browser;
try {
  const [started] = await once(server, "message", {
    signal: AbortSignal.timeout(30000),
  });
  browser = await chromium.launch();
  for (const items of [0, 6000]) {
    const board = /** @type {Record<string, any>} */ ({});
    for (let i = 0; i < items; i++) {
      const x = (i * 13) % 8000,
        y = Math.floor((i * 17) / 3) % 8000,
        id = `seed-${i}`;
      board[id] = {
        id,
        tool: "rectangle",
        type: "rect",
        color: "#456789",
        size: 2,
        x,
        y,
        x2: x + 40,
        y2: y + 28,
        time: i,
      };
    }
    const name = `drawing-bench-${items}`;
    await writeBoardState(name, board, { readonly: false }, 0, { historyDir });
    for (const cpuRate of [1, 6]) {
      for (
        let repeat = 0;
        repeat < Number(process.env.WBO_BENCH_REPEATS ?? 3);
        repeat++
      ) {
        // Alternate order to reduce warmup/thermal bias.
        for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
          const page = await browser.newPage({
            viewport: { width: 1100, height: 760 },
          });
          const cdp = await page.context().newCDPSession(page);
          try {
            // Keep the production point interval while allowing repeated benchmark writes.
            await page.route("**/tools/pencil/index.js", async (route) => {
              const response = await route.fetch();
              const body = (await response.text()).replace(
                "minPencilIntervalMs: computeMinPencilIntervalMs(runtime.rateLimits),",
                "minPencilIntervalMs: 20,",
              );
              await route.fulfill({ response, body });
            });
            await page.goto(
              `http://127.0.0.1:${started.port}/boards/${name}#0,0,1`,
            );
            await page.waitForFunction(
              () => document.documentElement.dataset.boardPhase === "ready",
            );
            await page.evaluate(async (active) => {
              const w = /** @type {any} */ (window),
                app = w.WBOApp;
              await app.toolRegistry.activateTool("pencil");
              const module = await import(
                new URL("../js/drawing_performance.js", location.href).href
              );
              const probe = /** @type {any} */ ({
                summaries: [],
                costs: { input: 0, accept: 0, geometry: 0, acknowledge: 0 },
                calls: { input: 0, accept: 0, geometry: 0, acknowledge: 0 },
                frameMaxMs: 0,
                active: true,
              });
              w.drawingBench = probe;
              if (active) {
                probe.unsubscribe = module.observeDrawingPerformance(
                  /** @param {unknown} summary */ (summary) =>
                    probe.summaries.push(summary),
                );
                const stroke = module.beginDrawingPerformance(
                  "probe",
                  new MouseEvent("mousedown"),
                  0,
                  0,
                  () => {},
                );
                const prototype = Object.getPrototypeOf(stroke);
                stroke.dispose();
                // Benchmark-only instrumentation. No timers/counters on the shipped hot path.
                for (const key of Object.keys(probe.costs)) {
                  const original = prototype[key];
                  prototype[key] = /** @param {...any} args */ function (
                    ...args
                  ) {
                    const begin = performance.now();
                    try {
                      return original.apply(this, args);
                    } finally {
                      probe.costs[key] += performance.now() - begin;
                      probe.calls[key]++;
                    }
                  };
                }
              }
              let last = performance.now();
              /** @param {number} now */
              function frame(now) {
                if (!probe.active) return;
                probe.frameMaxMs = Math.max(probe.frameMaxMs, now - last);
                last = now;
                requestAnimationFrame(frame);
              }
              requestAnimationFrame(frame);
            }, enabled);
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
            await cdp.send("Performance.enable");
            const before = await cdp.send("Performance.getMetrics");
            await page.mouse.move(100, 240);
            await page.mouse.down();
            const start = performance.now(),
              pending = /** @type {Promise<unknown>[]} */ ([]);
            await new Promise((resolve) => {
              const timer = setInterval(() => {
                const elapsed = performance.now() - start;
                if (elapsed >= 1500) {
                  clearInterval(timer);
                  resolve(undefined);
                  return;
                }
                const progress = elapsed / 1500;
                pending.push(
                  cdp.send("Input.dispatchMouseEvent", {
                    type: "mouseMoved",
                    x: 100 + 700 * progress,
                    y: 240 + 30 * Math.sin(progress * 12),
                    button: "left",
                    buttons: 1,
                    timestamp: Date.now() / 1000,
                  }),
                );
              }, 8);
            });
            await Promise.all(pending);
            await page.mouse.up();
            await page.waitForFunction((active) => {
              const w = /** @type {any} */ (window);
              return (
                (!active || w.drawingBench.summaries.length === 1) &&
                w.WBOApp.writes.bufferedWrites.length === 0
              );
            }, enabled);
            const after = await cdp.send("Performance.getMetrics");
            const metrics = Object.fromEntries(
              after.metrics.map(({ name, value }) => [
                name,
                value -
                  (before.metrics.find((m) => m.name === name)?.value ?? 0),
              ]),
            );
            const result = await page.evaluate(() => {
              const p = /** @type {any} */ (window).drawingBench;
              p.active = false;
              p.unsubscribe?.();
              return {
                costs: p.costs,
                calls: p.calls,
                frameMaxMs: p.frameMaxMs,
                summary: p.summaries[0],
                finalItems:
                  document.getElementById("drawingArea")?.childElementCount,
              };
            });
            console.log(
              JSON.stringify({
                items,
                cpuRate,
                repeat,
                enabled,
                ...result,
                scriptMs: (metrics.ScriptDuration ?? 0) * 1000,
                taskMs: (metrics.TaskDuration ?? 0) * 1000,
              }),
            );
          } finally {
            await page.close();
          }
        }
      }
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  await rm(historyDir, { recursive: true, force: true });
}
