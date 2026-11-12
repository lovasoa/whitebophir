import { MutationType } from "../../client-data/js/mutation_type.js";
import { TOOL_CODE_BY_ID } from "../../client-data/tools/tool-order.js";
import { expect, test } from "../fixtures/test";

test.use({ serverOptions: { env: { NODE_ENV: "production" } } });

test("production boot and tool assets stay inside the page's release", async ({
  page,
  boardPage,
  server,
}) => {
  const assets: string[] = [];
  page.on("request", (request) => {
    if (["script", "stylesheet"].includes(request.resourceType())) {
      assets.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`${boardPage.buildBoardUrl("release-drawing")}#0,0,1`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-board-phase",
    "ready",
  );
  const version = await page.locator("html").getAttribute("data-wbo-version");
  expect(
    assets.filter((url) => !url.startsWith(`/assets/${version}/`)),
  ).toEqual(["/socket.io/socket.io.js", "/js/board_main.js"]);
  await boardPage.selectTool("rectangle");
  await boardPage.waitForBoardWritable();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(550, 450, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#drawingArea rect")).toBeVisible();
  await server.waitForStoredBoard(server.dataPath, "release-drawing", (board) =>
    Object.values(board).some((item) => item?.tool === "rectangle"),
  );
  await page.screenshot({ path: "test-results/release-assets.png" });
});

for (const alwaysStale of [false, true]) {
  test(`outdated HTML ${alwaysStale ? "stops after one refresh" : "refreshes to the current release"}`, async ({
    page,
    server,
  }) => {
    let documents = 0;
    // Captured when each document commits: after boot the app rewrites the
    // viewport hash from the live scroll position, which races the browser
    // restoring history scroll state.
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (
        frame === page.mainFrame() &&
        frame.url().includes("/boards/stale-release")
      ) {
        navigations.push(frame.url());
      }
    });
    await page.route("**/boards/stale-release?*", async (route) => {
      const response = await route.fetch();
      documents++;
      let body = await response.text();
      if (alwaysStale || documents === 1) {
        // The release version pins every asset; a page from another release
        // requests files this server no longer has.
        body = body.replace(
          /data-wbo-version="[^"]*"/,
          'data-wbo-version="0.0.0"',
        );
      }
      await route.fulfill({ response, body });
    });
    await page.goto(
      `${server.serverUrl}/boards/stale-release?lang=fr#100,200,1`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-board-phase",
      alwaysStale ? "error" : "ready",
    );
    if (alwaysStale) {
      await expect(page.locator("#boardStatusTitle")).toHaveText(
        "Une erreur inconnue s’est produite, veuillez recharger la page",
      );
    } else {
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-wbo-version",
        "0.0.0",
      );
    }
    expect(documents).toBe(2);
    expect(navigations[1]).toContain("?lang=fr#100,200,1");
  });
}

test("a rollout during deferred boot refreshes before connecting", async ({
  page,
  server,
}) => {
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents++;
  });
  // The release disappears between loading the boot module and the runtime.
  await page.route("**/js/board.js", async (route) => {
    if (documents === 1) await route.fulfill({ status: 409 });
    else await route.continue();
  });
  await page.goto(`${server.serverUrl}/boards/deferred-release`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-board-phase",
    "ready",
  );
  expect(documents).toBe(2);
});

test("a late asset failure asks for refresh without losing queued edits", async ({
  page,
  boardPage,
  server,
}) => {
  await server.writeBoard(server.dataPath, "late-release", {
    seed: {
      tool: "rectangle",
      type: "rect",
      id: "seed",
      x: 100,
      y: 100,
      x2: 150,
      y2: 150,
      color: "#123456",
      size: 4,
    },
  });
  let rejectTool!: () => void;
  const toolCanFail = new Promise<void>((resolve) => {
    rejectTool = resolve;
  });
  await page.route("**/tools/rectangle/index.js", async (route) => {
    await toolCanFail;
    await route.fulfill({ status: 409 });
  });
  await page.goto(`${server.serverUrl}/boards/late-release`, {
    waitUntil: "domcontentloaded",
  });
  await boardPage.waitForBoardWritable();
  await page.evaluate(
    ({ tool, type }) => {
      const app = window.WBOApp;
      app.writes.getBufferedWriteBudgetWaitMs = () => 60_000;
      app.writes.drawAndSend({
        tool,
        _children: [{ type, id: "seed", newid: "pending" }],
      });
    },
    { tool: TOOL_CODE_BY_ID.hand, type: MutationType.COPY },
  );
  rejectTool();
  await expect(page.locator("html")).toHaveAttribute(
    "data-board-phase",
    "error",
  );
  await expect(page.locator("#boardStatusTitle")).toHaveText(
    "An unknown error occurred. Please reload the page.",
  );
  expect(
    await page.evaluate(() => window.WBOApp.writes.bufferedWrites.length),
  ).toBe(1);
  await expect(page.locator("#pending")).toHaveCount(1);
});
