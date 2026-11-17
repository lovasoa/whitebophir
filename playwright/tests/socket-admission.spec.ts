import { expect, test } from "../fixtures/test";

test("new socket handshakes receive HTTP 429 without blocking established polling", async ({
  request,
  server,
}) => {
  const handshake = new URL(
    "/socket.io/?EIO=4&transport=polling&board=handshake-budget&baselineSeq=0",
    server.serverUrl,
  );
  const opened = await request.get(handshake.toString());
  expect(opened.status()).toBe(200);
  const { sid } = JSON.parse((await opened.text()).slice(1));
  expect(sid).toEqual(expect.any(String));

  for (let admitted = 1; admitted < 30; admitted++) {
    const response = await request.get(handshake.toString());
    expect(response.status()).toBe(200);
  }
  const rejected = await request.get(handshake.toString());
  expect(rejected.status()).toBe(429);
  expect(Number(rejected.headers()["retry-after"])).toBeGreaterThan(0);
  expect(Number(rejected.headers()["retry-after"])).toBeLessThanOrEqual(60);

  const upgrade = new URL(handshake);
  upgrade.searchParams.set("transport", "websocket");
  const rejectedUpgrade = await request.get(upgrade.toString(), {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  });
  expect(rejectedUpgrade.status()).toBe(429);
  expect(Number(rejectedUpgrade.headers()["retry-after"])).toBeGreaterThan(0);

  handshake.searchParams.set("sid", sid);
  const connect = await request.post(handshake.toString(), {
    headers: { "Content-Type": "text/plain" },
    data: "40",
  });
  expect(connect.status()).toBe(200);
  const poll = await request.get(handshake.toString());
  expect(poll.status()).toBe(200);
  expect(await poll.text()).toContain('40{"sid":');
});

test("the board shows the rate-limit notice and waits for Retry-After", async ({
  boardPage,
  page,
}) => {
  let attempts = 0;
  let firstAttemptAt = 0;
  let retryDelayMs = 0;
  await page.route("**/socket.io/?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has("sid") || query.get("transport") !== "polling") {
      await route.continue();
      return;
    }
    attempts++;
    if (attempts === 1) {
      firstAttemptAt = performance.now();
      await route.fulfill({ status: 429, headers: { "Retry-After": "2" } });
      return;
    }
    retryDelayMs = performance.now() - firstAttemptAt;
    await route.continue();
  });
  await boardPage.gotoBoardShell("handshake-retry", { query: { lang: "fr" } });
  await expect(page.locator("#boardStatusTitle")).toHaveText("Moins vite");
  await boardPage.waitForSocketConnected();
  expect(attempts).toBe(2);
  expect(retryDelayMs).toBeGreaterThanOrEqual(2_000);
});
