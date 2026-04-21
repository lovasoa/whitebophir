import process from "node:process";

import { chromium } from "playwright";

const DEFAULT_URL = "http://127.0.0.1:8080/boards/anonymous";
const DEFAULT_USERS = 1;
const POINTS_PER_LINE = 50;
const CHILD_INTERVAL_MS = 20;

function printHelp() {
  console.log(`Usage: npm run generateload -- [options]

Open browser tabs on one board and keep drawing random 50-point pencil lines.

Options:
  --url <board-url>   Board URL to open
                      default: ${DEFAULT_URL}
  --users <count>     Number of tabs to open
                      default: ${DEFAULT_USERS}
  --help              Show this help
`);
}

/**
 * @typedef {{url: string, users: number, help?: boolean}} LoadOptions
 */

/**
 * @param {string[]} argv
 * @returns {LoadOptions}
 */
function parseArgs(argv) {
  /** @type {LoadOptions} */
  const options = {
    url: DEFAULT_URL,
    users: DEFAULT_USERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
      continue;
    }
    if (arg === "--users" && next) {
      options.users = Math.max(1, Number.parseInt(next, 10) || DEFAULT_USERS);
      index += 1;
    }
  }

  return options;
}

/**
 * @param {import("playwright").Page} page
 * @returns {Promise<void>}
 */
async function waitForBoardReady(page) {
  await page.waitForFunction(() => {
    const tools = window.Tools;
    return !!(
      tools &&
      document.documentElement.dataset.boardPhase === "ready" &&
      tools.socket?.connected &&
      tools.awaitingBoardSnapshot === false &&
      !tools.isWritePaused?.()
    );
  });
}

/**
 * @param {import("playwright").Page} page
 * @param {number} userIndex
 * @returns {Promise<void>}
 */
async function startDrawer(page, userIndex) {
  await page.evaluate(
    /**
     * @param {{colorSeed: number, pointsPerLine: number, childIntervalMs: number}} options
     */
    async ({ colorSeed, pointsPerLine, childIntervalMs }) => {
      /** @type {any} */
      const tools = window.Tools;
      await tools.bootTool?.("pencil");
      const pencil = tools.list?.Pencil;
      if (!pencil) throw new Error("Missing Pencil tool");

      const color = `#${(((colorSeed * 2654435761) >>> 0) & 0xffffff)
        .toString(16)
        .padStart(6, "0")}`;

      /**
       * @param {number} ms
       * @returns {Promise<void>}
       */
      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      /**
       * @param {number} x
       * @param {number} y
       * @returns {{x: number, y: number}}
       */
      function randomPoint(x, y) {
        return {
          x: Math.max(
            0,
            Math.min(32767, x + Math.round((Math.random() - 0.5) * 40)),
          ),
          y: Math.max(
            0,
            Math.min(32767, y + Math.round((Math.random() - 0.5) * 40)),
          ),
        };
      }

      /** @type {any} */
      const globalAny = window;
      if (globalAny.__wboGenerateLoadStarted) return;
      globalAny.__wboGenerateLoadStarted = true;

      (async () => {
        while (true) {
          const id = tools.generateUID("load-");
          let point = {
            x: 200 + Math.round(Math.random() * 800),
            y: 200 + Math.round(Math.random() * 600),
          };

          tools.drawAndSend(
            {
              tool: "pencil",
              type: "line",
              id,
              color,
              size: 4,
              opacity: 1,
            },
            pencil,
          );

          for (let index = 0; index < pointsPerLine; index += 1) {
            point = randomPoint(point.x, point.y);
            tools.drawAndSend(
              {
                tool: "pencil",
                type: "child",
                parent: id,
                x: point.x,
                y: point.y,
              },
              pencil,
            );
            await sleep(childIntervalMs);
          }
        }
      })();
    },
    {
      colorSeed: userIndex + 1,
      pointsPerLine: POINTS_PER_LINE,
      childIntervalMs: CHILD_INTERVAL_MS,
    },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const closeBrowser = async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", closeBrowser);
  process.on("SIGTERM", closeBrowser);

  for (let index = 0; index < options.users; index += 1) {
    const page = await context.newPage();
    await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await waitForBoardReady(page);
    await startDrawer(page, index);
  }

  console.log(
    `Started ${options.users} tab(s) on ${options.url}. Press Ctrl+C to stop.`,
  );
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
