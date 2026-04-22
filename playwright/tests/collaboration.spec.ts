// biome-ignore-all lint/suspicious/noExplicitAny: Playwright tests frequently access global state on the window object.
import { setTimeout as delay } from "node:timers/promises";
import { MutationType } from "../../client-data/js/mutation_type.js";
import { Cursor, Eraser } from "../../client-data/tools/index.js";
import { createBoardPage, expect, test } from "../fixtures/test";
import { DEFAULT_FORWARDED_IP } from "../helpers/tokens";

const rateLimitTest = test.extend({
  serverOptions: {
    useJWT: false,
    env: {
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "*:100/60s anonymous:50/60s",
    },
  },
});

const bufferedRateLimitTest = test.extend({
  serverOptions: {
    useJWT: false,
    env: {
      WBO_MAX_CONSTRUCTIVE_ACTIONS_PER_IP: "*:10/60s anonymous:1/1s",
    },
  },
});

test.describe("collaboration and rate limiting", () => {
  test("collaboration stays legible across two pages", async ({
    boardPage,
    server,
    context,
  }) => {
    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await boardPage.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });
    await peerBoard.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });

    await Promise.all([
      boardPage.gotoBoardShell("collaborative-test"),
      peerBoard.gotoBoardShell("collaborative-test"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
      boardPage.waitForToolBooted("pencil"),
      boardPage.waitForToolBooted("rectangle"),
      peerBoard.waitForToolBooted("rectangle"),
      peerBoard.waitForToolBooted("cursor"),
    ]);

    await expect(boardPage.tool("pencil")).toBeVisible();
    await expect(boardPage.connectedUsersToggle).toBeVisible();
    await boardPage.selectTool("pencil");
    await boardPage.expectCurrentTool("pencil");

    await boardPage.connectedUsersToggle.click();
    await expect(boardPage.connectedUsersPanel).toBeVisible();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);

    const firstRows = await boardPage.readConnectedUsers();
    expect(firstRows.filter((row) => row.isSelf)).toHaveLength(1);
    expect(firstRows.filter((row) => row.reportDisabled)).toHaveLength(1);

    await boardPage.drawRectangle(
      "#ff0000",
      { x: 1100, y: 800 },
      { x: 1300, y: 1000 },
    );
    await expect(
      peerPage.locator("rect[x='1100'][y='800'][stroke='#ff0000']"),
    ).toBeVisible();
    await boardPage.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 1100,
      y: 800,
      color: "#ff0000",
      size: 11,
    });
    await expect
      .poll(async () => {
        const rows = await peerBoard.readConnectedUsers();
        const remote = rows.find((row) => !row.isSelf);
        return remote?.meta ?? "";
      })
      .toMatch(/Cursor|Rectangle|Pencil/);

    await peerBoard.connectedUsersToggle.click();
    await expect(peerBoard.connectedUsersPanel).toBeVisible();
    await expect
      .poll(async () => {
        const rows = await peerBoard.readConnectedUsers();
        return rows.find((row) => !row.isSelf) ?? null;
      })
      .not.toBeNull();
    const rows = await peerBoard.readConnectedUsers();
    const peerRemoteRow = rows.find((row) => !row.isSelf);
    expect(peerRemoteRow).toBeTruthy();
    expect(peerRemoteRow?.meta ?? "").toMatch(/Rectangle|Pencil/);
    expect(parseFloat(peerRemoteRow?.dotWidth ?? "0")).toBeGreaterThan(7);
    expect(
      peerRemoteRow?.color === "rgb(255, 0, 0)" ||
        peerRemoteRow?.color === "#ff0000",
    ).toBe(true);

    await peerBoard.forceScrollTopLeft();
    await peerPage
      .locator("#connectedUsersList .connected-user-main-link[href^='#']")
      .click();
    await expect
      .poll(() => peerBoard.scrollPosition())
      .toMatchObject({
        left: expect.any(Number),
        top: expect.any(Number),
      });
    await peerPage.close();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(1);
  });

  test("reporting a user disconnects both sockets and they automatically reconnect", async ({
    boardPage,
    server,
    context,
  }) => {
    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await Promise.all([
      boardPage.gotoBoard("report-user-reconnect"),
      peerBoard.gotoBoard("report-user-reconnect"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);

    await boardPage.connectedUsersToggle.click();
    await peerBoard.connectedUsersToggle.click();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);
    await expect.poll(() => peerBoard.readConnectedUsers()).toHaveLength(2);

    const reporterReconnect = boardPage.waitForDisconnectThenReconnect();
    const reportedReconnect = peerBoard.waitForDisconnectThenReconnect();

    await boardPage.reportFirstRemoteUser();

    await expect(reporterReconnect).resolves.toMatchObject({
      initialId: expect.any(String),
      nextId: expect.any(String),
    });
    await expect(reportedReconnect).resolves.toMatchObject({
      initialId: expect.any(String),
      nextId: expect.any(String),
    });

    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);
    await expect.poll(() => peerBoard.readConnectedUsers()).toHaveLength(2);

    await peerPage.close();
  });

  test("same-session sockets keep separate activity in the user list", async ({
    boardPage,
    server,
    context,
  }) => {
    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await boardPage.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });
    await peerBoard.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });

    await Promise.all([
      boardPage.gotoBoard("same-session-activity"),
      peerBoard.gotoBoard("same-session-activity"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);

    await boardPage.connectedUsersToggle.click();
    await expect(boardPage.connectedUsersPanel).toBeVisible();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);

    await peerBoard.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 250,
      y: 150,
      color: "#00ff00",
      size: 5,
    });

    await expect
      .poll(async () => {
        const rows = await boardPage.readConnectedUsers();
        const remote = rows.find((row) => !row.isSelf);
        return {
          color: remote?.color ?? "",
          dotWidth: parseFloat(remote?.dotWidth ?? "0"),
        };
      })
      .toMatchObject({
        color: "rgb(0, 255, 0)",
        dotWidth: 8,
      });

    await boardPage.drawRectangle(
      "#ff0000",
      { x: 1100, y: 800 },
      { x: 1300, y: 1000 },
      11,
    );

    await expect
      .poll(async () => {
        const rows = await boardPage.readConnectedUsers();
        const self = rows.find((row) => row.isSelf);
        const remote = rows.find((row) => !row.isSelf);
        return {
          self: {
            color: self?.color ?? "",
            dotWidth: parseFloat(self?.dotWidth ?? "0"),
            meta: self?.meta ?? "",
          },
          remote: {
            color: remote?.color ?? "",
            dotWidth: parseFloat(remote?.dotWidth ?? "0"),
            meta: remote?.meta ?? "",
          },
        };
      })
      .toMatchObject({
        self: {
          color: "rgb(255, 0, 0)",
          meta: "Rectangle",
        },
        remote: {
          color: "rgb(0, 255, 0)",
          meta: "Hand",
        },
      });

    const rows = await boardPage.readConnectedUsers();
    const self = rows.find((row) => row.isSelf);
    const remote = rows.find((row) => !row.isSelf);
    expect(parseFloat(self?.dotWidth ?? "0")).toBeGreaterThanOrEqual(
      parseFloat(remote?.dotWidth ?? "0"),
    );

    await peerPage.close();
  });

  test("same-session pages use the server cookie identity and do not persist the secret in localStorage", async ({
    boardPage,
    server,
    context,
  }) => {
    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await boardPage.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });
    await peerBoard.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });

    const boardUrl = boardPage.buildBoardUrl("same-session-cookie-identity");
    await Promise.all([
      boardPage.gotoBoard("same-session-cookie-identity"),
      peerBoard.gotoBoard("same-session-cookie-identity"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);

    const localSecret = await boardPage.page.evaluate(() =>
      window.localStorage.getItem("wbo-user-secret-v1"),
    );
    expect(localSecret).toBeNull();

    const cookies = await context.cookies(boardUrl);
    const userSecretCookie = cookies.find(
      (cookie) => cookie.name === "wbo-user-secret-v1",
    );
    expect(userSecretCookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });

    await boardPage.connectedUsersToggle.click();
    await expect(boardPage.connectedUsersPanel).toBeVisible();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);

    const rows = await boardPage.readConnectedUsers();
    expect(new Set(rows.map((row) => row.name)).size).toBe(1);

    await peerPage.close();
  });

  test("connected user jump rows stay attached while cursor updates stream in", async ({
    boardPage,
    server,
    context,
    page,
  }) => {
    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await boardPage.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });
    await peerBoard.setSocketHeaders({
      "X-Forwarded-For": DEFAULT_FORWARDED_IP,
    });

    await Promise.all([
      boardPage.gotoBoard("connected-user-jump-links"),
      peerBoard.gotoBoard("connected-user-jump-links"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);

    await boardPage.connectedUsersToggle.click();
    await expect(boardPage.connectedUsersPanel).toBeVisible();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);

    await peerBoard.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 1600,
      y: 1200,
      color: "#00ff00",
      size: 5,
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const row = document.querySelector(
            "#connectedUsersList .connected-user-row:not(.connected-user-row-self)",
          );
          const link = row?.querySelector(
            ".connected-user-main-link",
          ) as HTMLAnchorElement | null;
          return link?.getAttribute("href") ?? "";
        }),
      )
      .toMatch(/^#/);

    await page.evaluate(() => {
      const row = document.querySelector(
        "#connectedUsersList .connected-user-row:not(.connected-user-row-self)",
      );
      (window as any).__trackedConnectedUserRow = row;
    });

    await peerPage.evaluate(
      async ({ tool, updateType }) => {
        const nextFrame = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        for (let index = 0; index < 12; index += 1) {
          window.Tools.socket.emit("broadcast", {
            tool,
            type: updateType,
            x: 1600 + index * 8,
            y: 1200 + index * 6,
            color: "#00ff00",
            size: 5,
          });
          await nextFrame();
        }
      },
      { tool: Cursor.id, updateType: MutationType.UPDATE },
    );

    await expect
      .poll(() =>
        page.evaluate(() => {
          const saved = (window as any)
            .__trackedConnectedUserRow as Element | null;
          const current = document.querySelector(
            "#connectedUsersList .connected-user-row:not(.connected-user-row-self)",
          );
          const link = current?.querySelector(
            ".connected-user-main-link",
          ) as HTMLAnchorElement | null;
          return {
            sameNode: saved === current,
            isConnected: !!saved && (saved as HTMLElement).isConnected,
            href: link?.getAttribute("href") ?? "",
          };
        }),
      )
      .toMatchObject({
        sameNode: true,
        isConnected: true,
        href: expect.stringMatching(/^#/),
      });

    await peerPage.close();
  });

  test("disconnect keeps authoritative shapes visible while showing reconnect status", async ({
    boardPage,
    page,
    server,
  }) => {
    await boardPage.gotoBoard("disconnect-visibility");
    await boardPage.waitForSocketConnected();
    await boardPage.waitForAuthoritativeResync();

    await page.evaluate((createType) => {
      const rectangle = window.Tools.list.rectangle;
      window.Tools.drawAndSend(
        {
          type: createType,
          id: "persisted-across-disconnect",
          x: 40,
          y: 40,
          x2: 120,
          y2: 100,
          color: "#224466",
          size: 4,
          opacity: 1,
        },
        rectangle,
      );
    }, MutationType.CREATE);

    await server.waitForStoredBoard(
      server.dataPath,
      "disconnect-visibility",
      (storedBoard) => storedBoard["persisted-across-disconnect"] != null,
    );
    await expect(
      page.locator("rect#persisted-across-disconnect"),
    ).toBeVisible();

    const disconnectState = await page.evaluate(() => {
      return new Promise<{
        awaitingBoardSnapshot: boolean;
        connectionState: string;
        statusVisible: boolean;
        rectVisible: boolean;
      }>((resolve) => {
        window.Tools.socket.once("disconnect", () => {
          resolve({
            awaitingBoardSnapshot: !!window.Tools.awaitingBoardSnapshot,
            connectionState: String(window.Tools.connectionState ?? ""),
            statusVisible:
              !document.getElementById("boardStatusIndicator")?.hidden ?? false,
            rectVisible: !!document.getElementById(
              "persisted-across-disconnect",
            ),
          });
        });
        window.Tools.socket.io.engine.close();
      });
    });

    expect(disconnectState).toEqual({
      awaitingBoardSnapshot: true,
      connectionState: "disconnected",
      statusVisible: true,
      rectVisible: true,
    });

    await boardPage.waitForAuthoritativeResync();
    await expect(
      page.locator("rect#persisted-across-disconnect"),
    ).toBeVisible();
  });

  test("reconnect snapshot replay does not duplicate pencil path data", async ({
    boardPage,
    page,
    server,
  }) => {
    await boardPage.gotoBoard("reconnect-pencil-replay");
    await boardPage.waitForSocketConnected();
    await boardPage.waitForAuthoritativeResync();

    await page.evaluate(
      async ({ createType, appendType }) => {
        const nextFrame = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        const lineId = "reconnect-pencil-path";
        const pencil = window.Tools.list.pencil;
        window.Tools.drawAndSend(
          {
            type: createType,
            id: lineId,
            color: "#8844aa",
            size: 4,
            opacity: 1,
          },
          pencil,
        );
        await nextFrame();
        for (const point of [
          { x: 198, y: 658 },
          { x: 229, y: 663 },
          { x: 325, y: 697 },
          { x: 198, y: 658 },
        ]) {
          window.Tools.drawAndSend(
            {
              type: appendType,
              parent: lineId,
              x: point.x,
              y: point.y,
            },
            pencil,
          );
          await nextFrame();
        }
      },
      {
        createType: MutationType.CREATE,
        appendType: MutationType.APPEND,
      },
    );

    await server.waitForStoredBoard(
      server.dataPath,
      "reconnect-pencil-replay",
      (storedBoard) => storedBoard["reconnect-pencil-path"] != null,
    );
    await expect(page.locator("path#reconnect-pencil-path")).toBeVisible();
    const initialPathData = await page
      .locator("path#reconnect-pencil-path")
      .getAttribute("d");
    expect(initialPathData).toBeTruthy();

    await boardPage.forceSocketDisconnect();
    await boardPage.waitForAuthoritativeResync();

    await expect(page.locator("path#reconnect-pencil-path")).toBeVisible();
    await expect(page.locator("path#reconnect-pencil-path")).toHaveAttribute(
      "d",
      initialPathData ?? "",
    );
    await expect(page.locator("path#reconnect-pencil-path")).toHaveCount(1);
  });

  test("slow board boot stabilizes with persisted shapes and an active peer", async ({
    boardPage,
    page,
    server,
    context,
  }) => {
    const boardName = "slow-start-stability";
    const serverOrigin = new URL(server.serverUrl).origin;
    const delayedAssetPaths = new Set([
      "/js/board_main.js",
      "/js/board.js",
      "/js/path-data-polyfill.js",
      "/socket.io/socket.io.js",
    ]);

    await server.writeBoard(server.dataPath, boardName, {
      "slow-pencil": {
        tool: "pencil",
        type: "line",
        id: "slow-pencil",
        color: "#8844aa",
        size: 4,
        opacity: 1,
        _children: [
          { x: 60, y: 80 },
          { x: 120, y: 130 },
          { x: 180, y: 100 },
          { x: 230, y: 170 },
        ],
      },
      "slow-rect": {
        tool: "rectangle",
        type: "rect",
        id: "slow-rect",
        x: 100,
        y: 100,
        x2: 160,
        y2: 140,
        color: "#123456",
        size: 4,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 25, f: 30 },
      },
      "slow-ellipse": {
        tool: "ellipse",
        type: "ellipse",
        id: "slow-ellipse",
        x: 260,
        y: 120,
        x2: 320,
        y2: 180,
        color: "#228855",
        size: 5,
      },
      "slow-line": {
        tool: "straight-line",
        type: "straight",
        id: "slow-line",
        x: 440,
        y: 120,
        x2: 500,
        y2: 170,
        color: "#aa5500",
        size: 3,
      },
      "slow-text": {
        tool: "text",
        type: "new",
        id: "slow-text",
        x: 360,
        y: 180,
        color: "#111111",
        size: 18,
        txt: "Slow sync",
      },
    });

    const peerPage = await context.newPage();
    const peerBoard = createBoardPage(peerPage, server);

    await peerBoard.gotoBoard(boardName);
    await peerBoard.waitForSocketConnected();
    await peerBoard.waitForAuthoritativeResync();

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin === serverOrigin &&
        (request.resourceType() === "document" ||
          delayedAssetPaths.has(url.pathname))
      ) {
        await delay(120);
      }
      await route.continue();
    });

    await boardPage.gotoBoard(boardName);
    await boardPage.waitForSocketConnected();
    await boardPage.waitForAuthoritativeResync();

    await peerBoard.emitBroadcast({
      tool: Cursor.id,
      type: MutationType.UPDATE,
      x: 640,
      y: 210,
      color: "#00ff66",
      size: 12,
    });

    await boardPage.connectedUsersToggle.click();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(2);

    await expect(page.locator("#slow-pencil")).toHaveCount(1);
    await expect(page.locator("#slow-rect")).toBeVisible();
    await expect(page.locator("#slow-ellipse")).toBeVisible();
    await expect(page.locator("line#slow-line")).toBeVisible();
    await expect(page.locator("#slow-text")).toHaveText("Slow sync");

    await expect
      .poll(() =>
        page.evaluate(() => {
          const remoteCursor = document.querySelector(
            "#cursors .opcursor:not(#cursor-me)",
          );
          if (!(remoteCursor instanceof SVGElement)) return null;
          const style =
            remoteCursor.style.transform ||
            window.getComputedStyle(remoteCursor).transform;
          return {
            fill: remoteCursor.getAttribute("fill"),
            transform: style || remoteCursor.getAttribute("transform"),
          };
        }),
      )
      .toMatchObject({
        fill: "#00ff66",
      });

    const finalState = await page.evaluate(() => {
      const rect = document.getElementById("slow-rect");
      const transformValues = (
        rect?.getAttribute("transform")?.match(/matrix\(([^)]+)\)/)?.[1] ?? ""
      )
        .split(/[ ,]+/)
        .filter(Boolean)
        .map(Number);
      const drawingIds = Array.from(
        document.querySelectorAll("#drawingArea [id]"),
      ).map((element) => element.id);
      const pencilPath = document.querySelector("#slow-pencil");
      const statusIndicator = document.getElementById("boardStatusIndicator");
      const remoteCursor = document.querySelector(
        "#cursors .opcursor:not(#cursor-me)",
      );

      return {
        boardPhase: document.documentElement.dataset.boardPhase,
        connectionState: String(window.Tools.connectionState ?? ""),
        awaitingBoardSnapshot: !!window.Tools.awaitingBoardSnapshot,
        statusHidden: statusIndicator?.hidden ?? true,
        pencilCount: document.querySelectorAll("#drawingArea path#slow-pencil")
          .length,
        pencilPathData:
          pencilPath instanceof SVGPathElement
            ? (pencilPath.getAttribute("d") ?? "")
            : "",
        rectTransformE: transformValues[4] ?? null,
        rectTransformF: transformValues[5] ?? null,
        ellipseCount: document.querySelectorAll(
          "#drawingArea ellipse#slow-ellipse",
        ).length,
        lineCount: document.querySelectorAll("#drawingArea line#slow-line")
          .length,
        textContent: document.getElementById("slow-text")?.textContent ?? "",
        drawingIdsUnique: drawingIds.length === new Set(drawingIds).size,
        remoteCursorPresent: remoteCursor instanceof SVGElement,
      };
    });

    expect(finalState).toMatchObject({
      boardPhase: "ready",
      connectionState: "connected",
      awaitingBoardSnapshot: false,
      statusHidden: true,
      pencilCount: 1,
      rectTransformE: 250,
      rectTransformF: 300,
      ellipseCount: 1,
      lineCount: 1,
      textContent: "Slow sync",
      drawingIdsUnique: true,
      remoteCursorPresent: true,
    });
    expect(finalState.pencilPathData).toBeTruthy();

    await peerPage.close();
  });

  rateLimitTest(
    "rate limit disconnect uses a non-blocking notice",
    async ({ boardPage, page }) => {
      await boardPage.setSocketHeaders({
        "X-Forwarded-For": "198.51.100.200",
      });
      await boardPage.gotoBoard("rate-limit-test");
      await expect(boardPage.tool("eraser")).toBeVisible();
      await boardPage.waitForSocketConnected();

      await page.evaluate(() => {
        (window as any).__lastAlert = null;
        window.alert = (message?: string) => {
          (window as any).__lastAlert = message ?? null;
        };
      });
      await page.evaluate(
        ({ deleteType, tool }) => {
          for (let index = 0; index < 101; index += 1) {
            window.Tools.socket.emit("broadcast", {
              tool,
              type: deleteType,
              id: `rate-limit-${index}`,
            });
          }
        },
        { deleteType: MutationType.DELETE, tool: Eraser.id },
      );

      await expect
        .poll(() =>
          page.evaluate(() => ({
            alert: (window as any).__lastAlert as string | null,
            notice: (
              document.getElementById("boardStatusNotice")?.textContent ?? ""
            ).trim(),
            indicatorClass:
              document.getElementById("boardStatusIndicator")?.className ?? "",
          })),
        )
        .toMatchObject({
          alert: null,
          notice:
            "You're sending changes too quickly, so we paused your connection to protect the board. Please wait a minute and try again.",
          indicatorClass: expect.stringContaining("board-status-paused"),
        });
    },
  );

  bufferedRateLimitTest(
    "client buffers anonymous constructive writes before hitting the server limit",
    async ({ boardPage, context, server, page }) => {
      await boardPage.gotoBoardShell("anonymous");
      await boardPage.waitForSocketConnected();
      await boardPage.waitForAuthoritativeResync();
      await Promise.all([
        boardPage.waitForToolBooted("rectangle"),
        expect(boardPage.tool("rectangle")).toBeVisible(),
      ]);

      await page.evaluate((createType) => {
        const rectangle = window.Tools.list.rectangle;
        window.Tools.drawAndSend(
          {
            type: createType,
            id: "buffered-rect-1",
            x: 40,
            y: 40,
            x2: 90,
            y2: 90,
            color: "#aa0000",
            size: 4,
            opacity: 1,
          },
          rectangle,
        );
        window.Tools.drawAndSend(
          {
            type: createType,
            id: "buffered-rect-2",
            x: 120,
            y: 40,
            x2: 170,
            y2: 90,
            color: "#00aa00",
            size: 4,
            opacity: 1,
          },
          rectangle,
        );
      }, MutationType.CREATE);

      await expect
        .poll(() => boardPage.readWriteStatus())
        .toMatchObject({
          bufferedWrites: 1,
          indicatorClass: expect.stringContaining("board-status-buffering"),
        });

      await page.bringToFront();
      await server.waitForStoredBoard(
        server.dataPath,
        "anonymous",
        (storedBoard) =>
          storedBoard["buffered-rect-1"] != null &&
          storedBoard["buffered-rect-2"] == null,
        5_000,
      );
      await boardPage.waitForBufferedWritesDrained();
      await server.waitForStoredBoard(
        server.dataPath,
        "anonymous",
        (storedBoard) => storedBoard["buffered-rect-2"] != null,
      );
      await boardPage.waitForSocketConnected();
      await boardPage.waitForAuthoritativeResync();
      await expect
        .poll(() => boardPage.readWriteStatus(), { timeout: 5_000 })
        .toMatchObject({
          bufferedWrites: 0,
          connectionState: "connected",
        });
      await expect
        .poll(() => boardPage.readWriteStatus(), { timeout: 5_000 })
        .toMatchObject({
          bufferedWrites: 0,
          awaitingBoardSnapshot: false,
          connectionState: "connected",
          noticeText: "",
        });

      const peerPage = await context.newPage();
      const peerBoard = createBoardPage(peerPage, server);
      await peerBoard.gotoBoardShell("anonymous");
      await peerBoard.waitForSocketConnected();
      await peerBoard.waitForAuthoritativeResync();
      await expect(peerPage.locator("rect#buffered-rect-1")).toBeVisible();
      await expect(peerPage.locator("rect#buffered-rect-2")).toBeVisible();
      await peerPage.close();
    },
  );

  bufferedRateLimitTest(
    "disconnect clears unsent optimistic writes and restores server truth",
    async ({ boardPage, page, server }) => {
      await boardPage.gotoBoard("anonymous");
      await boardPage.waitForSocketConnected();
      await boardPage.waitForAuthoritativeResync();

      await page.evaluate((createType) => {
        const rectangle = window.Tools.list.rectangle;
        window.Tools.drawAndSend(
          {
            type: createType,
            id: "persisted-before-disconnect",
            x: 40,
            y: 120,
            x2: 90,
            y2: 170,
            color: "#112233",
            size: 4,
            opacity: 1,
          },
          rectangle,
        );
        window.Tools.drawAndSend(
          {
            type: createType,
            id: "local-only-before-disconnect",
            x: 120,
            y: 120,
            x2: 170,
            y2: 170,
            color: "#445566",
            size: 4,
            opacity: 1,
          },
          rectangle,
        );
      }, MutationType.CREATE);

      await expect(
        page.locator("rect#local-only-before-disconnect"),
      ).toBeVisible();
      await expect
        .poll(() => boardPage.readWriteStatus())
        .toMatchObject({
          bufferedWrites: 1,
        });
      await server.waitForStoredBoard(
        server.dataPath,
        "anonymous",
        (storedBoard) => storedBoard["persisted-before-disconnect"] != null,
      );

      await boardPage.forceSocketDisconnect();
      await boardPage.waitForAuthoritativeResync();

      await expect(
        page.locator("rect#persisted-before-disconnect"),
      ).toBeVisible();
      await expect(
        page.locator("rect#local-only-before-disconnect"),
      ).not.toBeVisible();
    },
  );
});
