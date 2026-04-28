import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { MutationType } from "../client-data/js/mutation_type.js";
import { ToolCodes } from "../client-data/tools/tool-order.js";
import { writeBoardState } from "../server/persistence/svg_board_store.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const boardItems = 6_000;
const pencilEvery = 6;
const color = "#1f2937";

/**
 * @param {number} maxChildren
 * @returns {{board: {[id: string]: any}, lastPencilId: string}}
 */
function buildBoard(maxChildren) {
  const board = /** @type {{[id: string]: any}} */ ({});
  let lastPencilId = "";
  const points = Math.min(120, maxChildren);
  for (let index = 0; index < boardItems; index += 1) {
    const x = (index * 13) % 8000,
      y = Math.floor((index * 17) / 3) % 8000;
    if (index % pencilEvery === 0) {
      lastPencilId = `pencil-${index}`;
      board[lastPencilId] = {
        id: lastPencilId,
        tool: "pencil",
        type: "path",
        color,
        size: 4,
        _children: Array.from({ length: points }, (_, pointIndex) => ({
          x: x + pointIndex,
          y: y + ((pointIndex * 3) % 120),
        })),
        time: index,
      };
      continue;
    }
    if (index % 3 === 1) {
      board[`line-${index}`] = {
        id: `line-${index}`,
        tool: "straight-line",
        type: "line",
        color,
        size: 2,
        x,
        y,
        x2: x + 36,
        y2: y + 22,
        time: index,
      };
      continue;
    }
    const isRect = index % 3 === 0,
      id = isRect ? `rect-${index}` : `text-${index}`;
    board[id] = isRect
      ? {
          id,
          tool: "rectangle",
          type: "rect",
          color,
          size: 2,
          x,
          y,
          x2: x + 48,
          y2: y + 28,
          time: index,
        }
      : {
          id,
          tool: "text",
          type: "text",
          color,
          size: 18,
          x,
          y,
          txt: `note-${index}`,
          time: index,
        };
  }
  return { board, lastPencilId };
}

/** @param {string} targetId */
function benchInitScript(targetId) {
  return `
    window.__wboBench = { navStart: performance.now(), renderCompleteMs: null, eraseDispatchMs: null };
    const markRenderComplete = () => {
      const tools = window.WBOApp;
      if (window.__wboBench.renderCompleteMs === null && tools && tools.replay.awaitingSnapshot === false && document.getElementById(${JSON.stringify(targetId)})) {
        window.__wboBench.renderCompleteMs = performance.now() - window.__wboBench.navStart;
        return;
      }
      requestAnimationFrame(markRenderComplete);
    };
    requestAnimationFrame(markRenderComplete);
  `;
}

/** @param {string} historyDir */
async function startServer(historyDir) {
  const child = fork(path.join(repoRoot, "server", "server.mjs"), [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "0",
      WBO_HISTORY_DIR: historyDir,
      WBO_SILENT: "true",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Timed out waiting for benchmark server start\n${stderr}`),
        ),
      10_000,
    );
    child.on("message", (message) => {
      const serverMessage = /** @type {any} */ (message);
      if (serverMessage?.type === "server-started") {
        clearTimeout(timer);
        resolve(serverMessage.port);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Benchmark server exited early (code=${String(code)}, signal=${String(signal)})\n${stderr}`,
        ),
      );
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

/** @param {number} maxChildren */
export async function runPeerVisibleEraseBenchmark(maxChildren) {
  const historyDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "wbo-e2e-bench-"),
  );
  const { board, lastPencilId } = buildBoard(maxChildren);
  const boardName = "bench-e2e";
  await writeBoardState(boardName, board, { readonly: false }, 0, {
    historyDir,
  });
  const server = await startServer(historyDir);
  const browser = await chromium.launch();
  const peer = await browser.newPage();
  const main = await browser.newPage();
  try {
    const url = `${server.baseUrl}/boards/${boardName}`;
    await peer.goto(url, { waitUntil: "load" });
    await peer.waitForSelector(`#${lastPencilId}`);
    await main.addInitScript(benchInitScript(lastPencilId));
    await main.goto(url, { waitUntil: "load" });
    await main.waitForFunction(
      () => /** @type {any} */ (window).__wboBench?.renderCompleteMs !== null,
      undefined,
      { timeout: 30_000 },
    );
    const peerApplied = peer.waitForFunction(
      (/** @type {string} */ targetId) => !document.getElementById(targetId),
      lastPencilId,
      { timeout: 30_000 },
    );
    const peerApplyStartedAt = performance.now();
    const eraseSent = await main.evaluate(
      (params) => {
        const { eraserTool, targetId, deleteType } =
          /** @type {{eraserTool: any, targetId: string, deleteType: any}} */ (
            params
          );
        const bench = /** @type {any} */ (window).__wboBench;
        bench.eraseDispatchMs = performance.now() - bench.navStart;
        return window.WBOApp.send({
          tool: eraserTool,
          type: deleteType,
          id: targetId,
          clientMutationId: window.WBOApp.generateUID("cm-"),
        });
      },
      {
        eraserTool: ToolCodes.ERASER,
        targetId: lastPencilId,
        deleteType: MutationType.DELETE,
      },
    );
    if (eraseSent !== true)
      throw new Error("failed to send erase request in end-to-end benchmark");
    await peerApplied;
    const state = await main.evaluate(
      () => /** @type {any} */ (window).__wboBench,
    );
    return {
      timeMs:
        (state.eraseDispatchMs ?? 0) + (performance.now() - peerApplyStartedAt),
      details: `${boardItems} items, delete ${lastPencilId} on active peer`,
    };
  } finally {
    await browser.close();
    await server.stop();
    await fsp.rm(historyDir, { recursive: true, force: true });
  }
}
