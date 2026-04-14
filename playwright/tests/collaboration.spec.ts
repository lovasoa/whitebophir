import { test, expect, createBoardPage } from "../fixtures/test";
import { DEFAULT_FORWARDED_IP } from "../helpers/tokens";

const rateLimitTest = test.extend({
  serverOptions: {
    useJWT: false,
    env: {
      WBO_MAX_DESTRUCTIVE_ACTIONS_PER_IP: "100",
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
      .locator("#connectedUsersList .connected-user-row-jumpable")
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

  rateLimitTest(
    "rate limit alert disconnects the socket",
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
            connected: (window as any).Tools.socket.connected as boolean,
          })),
        )
        .toMatchObject({
          alert:
            "You're sending changes too quickly, so we paused your connection to protect the board. Please wait a minute and try again.",
          connected: false,
        });
    },
  );
});
