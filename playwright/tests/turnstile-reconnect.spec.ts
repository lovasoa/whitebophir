import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { TOOL_BY_ID } from "../../client-data/tools/manifest.js";
import { startTestServer, stopTestServer } from "../helpers/testServer";
import { BoardPage } from "../pages/BoardPage";

const { cursor: Cursor } = TOOL_BY_ID;

function startTurnstileVerifyServer() {
  return new Promise<http.Server>((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success:
              params.get("secret") === "test-secret" &&
              Boolean(params.get("response")),
            hostname: "localhost",
          }),
        );
      });
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server: http.Server | undefined) {
  if (!server) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

test("Turnstile verifies tool selection and recovers protected writes after reconnect", async ({
  page,
  context,
}, testInfo) => {
  const verifyServer = await startTurnstileVerifyServer();
  const verifyPort = (verifyServer.address() as AddressInfo).port;
  const server = await startTestServer(
    {
      env: {
        TURNSTILE_SECRET_KEY: "test-secret",
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_VERIFY_URL: `http://127.0.0.1:${verifyPort}/siteverify`,
      },
    },
    testInfo,
  );

  let allowWidgetScript = () => {};
  const widgetScriptGate = new Promise<void>((resolve) => {
    allowWidgetScript = resolve;
  });

  try {
    const boardPage = new BoardPage(page, server);
    await boardPage.installTurnstileMock();
    const widgetScriptUrl =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    await page.route(widgetScriptUrl, async (route) => {
      await widgetScriptGate;
      await route.fallback();
    });
    const overlay = page.locator("#turnstile-overlay");
    const paths = page.locator("#drawingArea path");

    await boardPage.gotoBoard("anonymous", { lang: "fr", tokenQuery: "" });
    await boardPage.waitForBoardWritable();
    await boardPage.waitForToolBooted("pencil");
    await boardPage.expectCurrentTool("hand");
    await expect(overlay).toHaveCount(0);

    const widgetScriptRequested = page.waitForRequest(widgetScriptUrl);
    await boardPage.selectTool("pencil");
    await widgetScriptRequested;

    await page.mouse.move(260, 300);
    await page.mouse.down();
    await page.mouse.move(360, 300);
    await page.mouse.up();
    await expect(paths).toHaveCount(0);
    expect(
      await page.evaluate(() => window.WBOApp.turnstile.pendingWrites.length),
    ).toBe(0);

    allowWidgetScript();
    await expect(overlay).toBeVisible();
    await testInfo.attach("turnstile-before-drawing", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.keyboard.press("h");
    await boardPage.expectCurrentTool("hand");
    await expect(overlay).toBeHidden();
    await page.keyboard.press("p");
    await boardPage.expectCurrentTool("pencil");
    await expect(overlay).toBeVisible();
    expect(
      await boardPage.completeTurnstileChallenge("validated-before-drawing"),
    ).toEqual({ overlayPresent: false, pendingWrites: 0, validated: true });

    await page.mouse.move(260, 300);
    await page.mouse.down();
    await page.mouse.move(320, 300);
    await page.evaluate(() => window.WBOApp.turnstile.setValidation(null));
    await page.mouse.move(420, 300);
    await expect(overlay).toBeHidden();
    await page.mouse.up();

    await expect(overlay).toBeVisible();
    expect(
      await boardPage.completeTurnstileChallenge("validated-after-stroke"),
    ).toEqual({ overlayPresent: false, pendingWrites: 0, validated: true });
    await expect(paths).toHaveCount(1);
    const strokeId = (await paths.first().getAttribute("id")) ?? "";
    const endX = await page.evaluate(() =>
      window.WBOApp.coordinates.pageCoordinateToBoard(420 + window.scrollX),
    );
    await server.waitForStoredBoard(
      server.dataPath,
      "anonymous",
      (storedBoard) => storedBoard[strokeId]?.localBounds?.maxX >= endX - 1,
    );
    await boardPage.selectTool("hand");

    const peerPage = await context.newPage();
    const peerBoard = new BoardPage(peerPage, server);
    await peerBoard.gotoBoard("anonymous", { lang: "fr", tokenQuery: "" });
    await expect(peerBoard.tool("pencil")).toBeVisible();
    await peerBoard.waitForSocketConnected();
    await peerBoard.trackBroadcasts();

    await expect(await boardPage.reconnectAndReadState()).toEqual({
      connected: true,
      validated: false,
    });
    await expect(overlay).toBeHidden();

    await peerBoard.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 210,
      y: 220,
      color: "#00aa11",
      size: 10,
    });
    await boardPage.waitForBroadcastColor("#00aa11");

    await boardPage.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 260,
      y: 280,
      color: "#123abc",
      size: 10,
    });
    await peerBoard.waitForBroadcastColor("#123abc");

    await expect(
      await boardPage.queueProtectedRectangle("reconnect-turnstile-rect"),
    ).toEqual({
      overlayPresent: true,
      pendingWrites: 1,
      validated: false,
    });

    await expect(
      await boardPage.completeTurnstileChallenge("reconnect-recovery-token"),
    ).toEqual({
      overlayPresent: false,
      pendingWrites: 0,
      validated: true,
    });

    await expect(page.locator("rect#reconnect-turnstile-rect")).toBeVisible();
    await server.waitForStoredBoard(
      server.dataPath,
      "anonymous",
      (storedBoard) => storedBoard["reconnect-turnstile-rect"] != null,
    );
    await expect(
      peerPage.locator("rect#reconnect-turnstile-rect"),
    ).toBeVisible();

    await peerPage.close();
  } finally {
    allowWidgetScript();
    await closeServer(verifyServer);
    await stopTestServer(server, testInfo);
  }
});

test("turnstile widget errors preserve queued writes until a later success", async ({
  page,
}, testInfo) => {
  const verifyServer = await startTurnstileVerifyServer();
  const verifyPort = (verifyServer.address() as AddressInfo).port;
  const server = await startTestServer(
    {
      env: {
        TURNSTILE_SECRET_KEY: "test-secret",
        TURNSTILE_SITE_KEY: "test-site-key",
        TURNSTILE_VERIFY_URL: `http://127.0.0.1:${verifyPort}/siteverify`,
      },
    },
    testInfo,
  );

  try {
    const boardPage = new BoardPage(page, server);
    await boardPage.installTurnstileMock();
    await boardPage.gotoBoard("anonymous", { lang: "fr", tokenQuery: "" });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.waitForSocketConnected();

    await expect(
      await boardPage.queueProtectedRectangle("turnstile-error-rect"),
    ).toEqual({
      overlayPresent: true,
      pendingWrites: 1,
      validated: false,
    });
    await expect(boardPage.statusIndicator).toBeHidden();

    await expect(
      await boardPage.failTurnstileChallenge("mock-widget-error"),
    ).toEqual({
      overlayPresent: true,
      pendingWrites: 1,
      validated: false,
    });
    await expect(boardPage.statusIndicator).toBeVisible();
    await expect(boardPage.statusTitle).toContainText(
      "Le filtre anti-robot indique",
    );
    await expect(boardPage.statusTitle).toContainText(
      "Security check failed (mock-widget-error).",
    );
    await expect(boardPage.statusTitle).not.toContainText(
      "Security check required",
    );
    await expect(boardPage.statusNotice).toContainText("pending write");

    await expect(
      await boardPage.completeTurnstileChallenge("turnstile-recovery-token"),
    ).toEqual({
      overlayPresent: false,
      pendingWrites: 0,
      validated: true,
    });

    await expect(page.locator("rect#turnstile-error-rect")).toBeVisible();
    await server.waitForStoredBoard(
      server.dataPath,
      "anonymous",
      (storedBoard) => storedBoard["turnstile-error-rect"] != null,
    );
  } finally {
    await closeServer(verifyServer);
    await stopTestServer(server, testInfo);
  }
});
