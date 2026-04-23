import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { Cursor } from "../../client-data/tools/index.js";
import { startTestServer, stopTestServer } from "../helpers/testServer";
import { BoardPage } from "../pages/BoardPage";

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

test("reconnect resets Turnstile and recovers protected writes", async ({
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

  try {
    const boardPage = new BoardPage(page, server);
    await boardPage.installTurnstileMock();
    await boardPage.gotoBoard("anonymous", { lang: "fr", tokenQuery: "" });
    await expect(boardPage.tool("pencil")).toBeVisible();
    await boardPage.waitForSocketConnected();
    await boardPage.trackBroadcasts();

    await expect(
      await boardPage.validateTurnstileToken("validated-before-reconnect"),
    ).toEqual({
      success: true,
      validated: true,
    });

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

    await expect(
      await boardPage.failTurnstileChallenge("mock-widget-error"),
    ).toEqual({
      overlayPresent: true,
      pendingWrites: 1,
      validated: false,
    });
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
