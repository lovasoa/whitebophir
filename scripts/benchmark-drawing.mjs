// Generated data only. npm run bench:drawing. JSON lines compare collection off/on
// on sparse/dense boards, at normal/6x CPU. Optional WBO_BENCH_REPEATS (default 3).
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";
import { MutationType } from "../client-data/js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "../client-data/tools/tool-order.js";
import { writeBoardState } from "../server/persistence/svg_board_store.mjs";

// --collaborative reproduces local ink competing with seven remote drawers.
// --transforms adds one peer drawing and moving an eight-item selection.
// --touch uses a wide board of short Pencil paths with seven remote drawers.
const transforms = process.argv.includes("--transforms");
const touch = process.argv.includes("--touch");
const collaborative =
  transforms || touch || process.argv.includes("--collaborative");
const peerCount = transforms ? 1 : 7;
const transformedItems = 8;
const strokeDurationMs = collaborative ? 5000 : 1500;
const peerIo = collaborative
  ? createRequire(import.meta.url)(
      "../node_modules/socket.io/client-dist/socket.io.js",
    )
  : null;
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
  for (const { items, scale } of [
    { items: 0, scale: 1 },
    { items: 6000, scale: 1 },
    { items: 32768, scale: 0.08 },
  ]) {
    if (collaborative && items !== 32768) continue;
    const board = /** @type {Record<string, any>} */ ({});
    for (let i = 0; i < items; i++) {
      const x = (i * 13) % 8000,
        y = Math.floor((i * 17) / 3) % 8000,
        id = `seed-${i}`;
      board[id] =
        items === 32768 && (touch || i % 6 === 0)
          ? {
              id,
              tool: "pencil",
              type: "path",
              color: "#123456",
              size: 3,
              _children: Array.from({ length: touch ? 4 : 120 }, (_, p) => ({
                x: x + p,
                y: y + ((p * 3) % 120),
              })),
              time: i,
            }
          : {
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
    await writeBoardState(name, board, { readonly: false }, 0, {
      historyDir,
      ...(touch ? { svgExtent: { width: 655360, height: 655360 } } : {}),
    });
    const drawingScale = collaborative ? (touch ? 0.07 : 0.18) : scale;
    for (const cpuRate of collaborative ? [6] : [1, 6]) {
      for (
        let repeat = 0;
        repeat < Number(process.env.WBO_BENCH_REPEATS ?? 3);
        repeat++
      ) {
        // Alternate order to reduce warmup/thermal bias.
        for (const enabled of collaborative
          ? [true]
          : repeat % 2
            ? [true, false]
            : [false, true]) {
          const page = await browser.newPage({
            viewport: { width: 1100, height: 760 },
            hasTouch: touch,
            isMobile: touch,
          });
          const cdp = await page.context().newCDPSession(page);
          const peers = /** @type {any[]} */ ([]);
          const rejected = /** @type {unknown[]} */ ([]);
          let peerTimer;
          let peerPoint = 0;
          try {
            // Throttle before boot, avoiding an artificial cold first frame
            // caused by changing CPU speed after the board has already painted.
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
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
              `http://127.0.0.1:${started.port}/boards/${name}#0,0,${drawingScale}`,
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
                    if (key === "input" && !probe.strokeRef)
                      probe.strokeRef = new w.WeakRef(this);
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
            if (collaborative) {
              for (let i = 0; i < peerCount; i++) {
                const peer = peerIo(`http://127.0.0.1:${started.port}`, {
                  query: { board: name },
                  transports: ["websocket"],
                  forceNew: true,
                });
                peers.push(peer);
                peer.on(
                  "mutation_rejected",
                  /** @param {unknown} reason */ (reason) =>
                    rejected.push(reason),
                );
                await once(peer, "connect", {
                  signal: AbortSignal.timeout(10000),
                });
                peer.emit("broadcast", {
                  tool: TOOL_CODE_BY_ID.pencil,
                  type: MutationType.CREATE,
                  id: `peer-${repeat}-${i}`,
                  color: "#123456",
                  size: 10,
                });
              }
              peerTimer = setInterval(() => {
                for (const [i, peer] of peers.entries())
                  peer.emit("broadcast", {
                    tool: TOOL_CODE_BY_ID.pencil,
                    type: MutationType.APPEND,
                    parent: `peer-${repeat}-${i}`,
                    x: 1500 + peerPoint * 7,
                    y: Math.round(
                      2000 + i * 100 + 30 * Math.sin(peerPoint / 5),
                    ),
                  });
                if (transforms && peerPoint % 3 === 0)
                  peers[0].emit("broadcast", {
                    tool: TOOL_CODE_BY_ID.hand,
                    _children: Array.from(
                      { length: transformedItems },
                      (_, i) => ({
                        type: MutationType.UPDATE,
                        id: `seed-${1000 + i}`,
                        transform: {
                          a: 1,
                          b: 0,
                          c: 0,
                          d: 1,
                          e: peerPoint * 3,
                          f: peerPoint * 2,
                        },
                      }),
                    ),
                  });
                peerPoint++;
              }, 33);
            }
            await cdp.send("Performance.enable");
            const before = await cdp.send("Performance.getMetrics");
            if (touch)
              await cdp.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ x: 100, y: 240, id: 1 }],
                timestamp: Date.now() / 1000,
              });
            else {
              await page.mouse.move(100, 240);
              await page.mouse.down();
            }
            const start = performance.now(),
              pending = /** @type {Promise<unknown>[]} */ ([]);
            await new Promise((resolve) => {
              const timer = setInterval(() => {
                const elapsed = performance.now() - start;
                if (elapsed >= strokeDurationMs) {
                  clearInterval(timer);
                  resolve(undefined);
                  return;
                }
                const progress = elapsed / strokeDurationMs;
                const x = 100 + 700 * progress,
                  y = 240 + 30 * Math.sin(progress * 12),
                  timestamp = Date.now() / 1000;
                pending.push(
                  touch
                    ? cdp.send("Input.dispatchTouchEvent", {
                        type: "touchMove",
                        touchPoints: [{ x, y, id: 1 }],
                        timestamp,
                      })
                    : cdp.send("Input.dispatchMouseEvent", {
                        type: "mouseMoved",
                        x,
                        y,
                        button: "left",
                        buttons: 1,
                        timestamp,
                      }),
                );
              }, 8);
            });
            // Bound the workload even when the browser is still draining slow
            // input. Otherwise remote updates can prevent it from catching up.
            clearInterval(peerTimer);
            await Promise.all(pending);
            if (touch)
              await cdp.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
                timestamp: Date.now() / 1000,
              });
            else await page.mouse.up();
            if (collaborative) {
              if (rejected.length) throw new Error(JSON.stringify(rejected));
              await page.waitForFunction(
                ({
                  repeat,
                  peerPoint,
                  peerCount,
                  transforms,
                  transformedItems,
                }) => {
                  for (let i = 0; i < peerCount; i++) {
                    const line = /** @type {SVGPathElement | null} */ (
                      document.getElementById(`peer-${repeat}-${i}`)
                    );
                    const data = line?.getPathData();
                    const values = data?.[data.length - 1]?.values;
                    if (
                      !values ||
                      values[values.length - 2] !== 1500 + (peerPoint - 1) * 7
                    )
                      return false;
                  }
                  if (transforms) {
                    const lastPoint = Math.floor((peerPoint - 1) / 3) * 3;
                    for (let i = 0; i < transformedItems; i++) {
                      const element = /** @type {SVGGraphicsElement | null} */ (
                        document.getElementById(`seed-${1000 + i}`)
                      );
                      const list = element?.transform.baseVal;
                      const matrix = list?.numberOfItems
                        ? list.getItem(0).matrix
                        : null;
                      if (
                        matrix?.e !== lastPoint * 3 ||
                        matrix.f !== lastPoint * 2
                      )
                        return false;
                    }
                  }
                  return true;
                },
                { repeat, peerPoint, peerCount, transforms, transformedItems },
              );
            }
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
            // After unsubscribe/GC the collector must be collectible, independently
            // of the SVG and Pencil geometry retained by the application itself.
            await cdp.send("HeapProfiler.collectGarbage");
            const retainedCollector = await page.evaluate(() =>
              Boolean(
                /** @type {any} */ (window).drawingBench.strokeRef?.deref(),
              ),
            );
            if (retainedCollector)
              throw new Error("Collector retained after stroke cleanup");
            console.log(
              JSON.stringify({
                items,
                scale: drawingScale,
                inputType: touch ? "touch" : "mouse",
                cpuRate,
                repeat,
                enabled,
                remoteDrawers: peers.length,
                remoteTransformsPerBatch: transforms ? transformedItems : 0,
                retainedCollector,
                ...result,
                scriptMs: (metrics.ScriptDuration ?? 0) * 1000,
                taskMs: (metrics.TaskDuration ?? 0) * 1000,
                layoutMs: (metrics.LayoutDuration ?? 0) * 1000,
              }),
            );
          } finally {
            clearInterval(peerTimer);
            for (const peer of peers) peer.disconnect();
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
