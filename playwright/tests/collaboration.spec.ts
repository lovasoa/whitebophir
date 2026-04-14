import { test, expect, createBoardPage } from "../fixtures/test";
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
      boardPage.gotoBoard("collaborative-test"),
      peerBoard.gotoBoard("collaborative-test"),
    ]);
    await Promise.all([
      boardPage.waitForSocketConnected(),
      peerBoard.waitForSocketConnected(),
    ]);

    await expect(boardPage.tool("Pencil")).toBeVisible();
    await expect(boardPage.connectedUsersToggle).toBeVisible();
    await boardPage.selectTool("Pencil");
    await boardPage.expectCurrentTool("Pencil");

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
      tool: "Cursor",
      type: "update",
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
    expect(parseFloat(peerRemoteRow?.dotWidth ?? "0")).toBeGreaterThan(9);
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
    const scroll = await peerBoard.scrollPosition();
    expect(scroll.left > 0 || scroll.top > 0).toBe(true);

    await peerPage.close();
    await expect.poll(() => boardPage.readConnectedUsers()).toHaveLength(1);
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
      tool: "Cursor",
      type: "update",
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
    expect(parseFloat(self?.dotWidth ?? "0")).toBeGreaterThan(
      parseFloat(remote?.dotWidth ?? "0"),
    );

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
      tool: "Cursor",
      type: "update",
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

    await peerPage.evaluate(async () => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      for (let index = 0; index < 12; index += 1) {
        (window as any).Tools.socket.emit("broadcast", {
          board: (window as any).Tools.boardName,
          data: {
            tool: "Cursor",
            type: "update",
            x: 1600 + index * 8,
            y: 1200 + index * 6,
            color: "#00ff00",
            size: 5,
          },
        });
        await nextFrame();
      }
    });

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

  rateLimitTest(
    "rate limit disconnect uses a non-blocking notice",
    async ({ boardPage, page }) => {
      await boardPage.setSocketHeaders({
        "X-Forwarded-For": "198.51.100.200",
      });
      await boardPage.gotoBoard("rate-limit-test");
      await expect(boardPage.tool("Eraser")).toBeVisible();
      await boardPage.waitForSocketConnected();

      await page.evaluate(() => {
        (window as any).__lastAlert = null;
        window.alert = (message?: string) => {
          (window as any).__lastAlert = message ?? null;
        };
      });
      await page.evaluate(() => {
        for (let index = 0; index < 101; index += 1) {
          (window as any).Tools.socket.emit("broadcast", {
            board: (window as any).Tools.boardName,
            data: {
              tool: "Eraser",
              type: "delete",
              id: `rate-limit-${index}`,
            },
          });
        }
      });

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
      const peerPage = await context.newPage();
      const peerBoard = createBoardPage(peerPage, server);

      await Promise.all([
        boardPage.gotoBoard("anonymous"),
        peerBoard.gotoBoard("anonymous"),
      ]);
      await Promise.all([
        boardPage.waitForSocketConnected(),
        peerBoard.waitForSocketConnected(),
      ]);
      await Promise.all([
        boardPage.waitForAuthoritativeResync(),
        peerBoard.waitForAuthoritativeResync(),
      ]);

      await page.evaluate(() => {
        const rectangle = (window as any).Tools.list.Rectangle;
        (window as any).Tools.drawAndSend(
          {
            type: "rect",
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
        (window as any).Tools.drawAndSend(
          {
            type: "rect",
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
      });

      await expect
        .poll(() => boardPage.readWriteStatus())
        .toMatchObject({
          bufferedWrites: 1,
          indicatorClass: expect.stringContaining("board-status-buffering"),
        });

      await expect(peerPage.locator("rect#buffered-rect-1")).toBeVisible();
      await expect(peerPage.locator("rect#buffered-rect-2")).not.toBeVisible();

      await expect
        .poll(() => boardPage.readWriteStatus(), { timeout: 5_000 })
        .toMatchObject({
          bufferedWrites: 0,
          awaitingBoardSnapshot: false,
          connectionState: "connected",
          noticeText: "",
        });
      await server.waitForStoredBoard(
        server.dataPath,
        "anonymous",
        (storedBoard) => storedBoard["buffered-rect-2"] != null,
        15_000,
      );

      await peerPage.close();
    },
  );

  bufferedRateLimitTest(
    "disconnect clears unsent optimistic writes and restores server truth",
    async ({ boardPage, page, server }) => {
      await boardPage.gotoBoard("anonymous");
      await boardPage.waitForSocketConnected();
      await boardPage.waitForAuthoritativeResync();

      await page.evaluate(() => {
        const rectangle = (window as any).Tools.list.Rectangle;
        (window as any).Tools.drawAndSend(
          {
            type: "rect",
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
        (window as any).Tools.drawAndSend(
          {
            type: "rect",
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
      });

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
