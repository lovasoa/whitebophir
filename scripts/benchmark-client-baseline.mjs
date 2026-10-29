import { once } from "node:events";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { boardSvgPath } from "../server/persistence/svg_board_paths.mjs";

const source = process.argv[2];
const cpuRate = Number(process.argv[3] || 4);
if (!source || !Number.isFinite(cpuRate) || cpuRate < 1) {
  throw new Error(
    "Usage: node scripts/benchmark-client-baseline.mjs <stored-board.svg> [cpu-throttle-rate]",
  );
}

const historyDir = await mkdtemp(path.join(os.tmpdir(), "wbo-client-bench-"));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("OTEL_")) delete env[key];
}
Object.assign(env, {
  PORT: "0",
  WBO_HISTORY_DIR: historyDir,
  WBO_SILENT: "true",
});
await copyFile(source, boardSvgPath("baseline-benchmark", historyDir));
const server = fork(new URL("../server/server.mjs", import.meta.url), [], {
  env,
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  silent: true,
});
server.stderr?.on("data", (chunk) => process.stderr.write(chunk));
let browser;
try {
  const [started] = await once(server, "message", {
    signal: AbortSignal.timeout(30_000),
  });
  browser = await chromium.launch({ headless: true });
  for (const forcePolyfill of [false, true]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
      await page.addInitScript((forcePolyfill) => {
        if (!forcePolyfill) return;
        for (const name of ["getPathData", "setPathData"]) {
          Object.defineProperty(SVGPathElement.prototype, name, {
            value: undefined,
            writable: true,
            configurable: true,
          });
        }
      }, forcePolyfill);
      await page.goto(
        `http://127.0.0.1:${started.port}/boards/baseline-benchmark#0,0,1`,
      );
      await page.waitForFunction(
        () => window.WBOApp?.connection?.state === "connected",
      );
      const timings = await page.evaluate(async () => {
        let start = performance.now();
        await window.WBOApp.toolRegistry.bootTool("pencil");
        const pencilReadyMs = performance.now() - start;
        start = performance.now();
        window.WBOApp.toolRegistry.normalizeServerRenderedElements();
        const repeatNormalizationMs = performance.now() - start;
        start = performance.now();
        await window.WBOApp.replay.refreshAuthoritativeBaseline();
        return {
          pencilReadyMs,
          repeatNormalizationMs,
          refreshMs: performance.now() - start,
          paths: document.querySelectorAll("#drawingArea path").length,
        };
      });
      console.log(
        JSON.stringify({
          browser: browser.version(),
          cpuRate,
          pathApi: forcePolyfill ? "forced-polyfill" : "default",
          ...timings,
        }),
      );
    } finally {
      await context.close();
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
