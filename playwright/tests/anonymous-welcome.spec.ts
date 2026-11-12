import { expect, test } from "../fixtures/test";

const cookieName = "wbo_anonymous_welcome_v1";

test("anonymous welcome is dismissed for 30 days only after acknowledgement", async ({
  page,
  context,
  server,
}, testInfo) => {
  await page.goto(`${server.serverUrl}/boards/anonymous?lang=en`);
  const welcome = page.locator("#boardNotice");
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("Welcome! This board is public.");
  await expect(welcome).toContainText("secret chats or naked pictures");
  expect(
    (await context.cookies()).find((c) => c.name === cookieName),
  ).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("welcome-desktop.png") });

  // Reading rules must not dismiss or set the acknowledgement cookie.
  const popupPromise = page.waitForEvent("popup");
  await welcome.getByRole("link", { name: "Read all rules" }).click();
  const rules = await popupPromise;
  await expect(rules).toHaveURL(`${server.serverUrl}/rules?lang=en`);
  await expect(
    rules.locator('[data-rule-id="personal_information"]'),
  ).toContainText(
    "Do not post phone numbers, email addresses, full names, home or school addresses, social media info.",
  );
  await rules.close();
  await expect(welcome).toBeVisible();
  expect(
    (await context.cookies()).find((c) => c.name === cookieName),
  ).toBeUndefined();

  const dismissedAt = Date.now() / 1000;
  await welcome.getByRole("button", { name: "Got it" }).click();
  await expect(welcome).toBeHidden();
  const dismissal = (await context.cookies()).find(
    (c) => c.name === cookieName,
  );
  expect(dismissal).toMatchObject({
    value: "dismissed",
    path: "/",
    secure: true,
    sameSite: "Lax",
  });
  expect(dismissal?.expires).toBeGreaterThanOrEqual(dismissedAt + 2592000 - 1);
  expect(dismissal?.expires).toBeLessThanOrEqual(Date.now() / 1000 + 2592000);
  await expect(page.locator("#connectedUsersToggle")).toBeFocused();
  const rulesIcon = page.getByRole("link", { name: "Rules & safety" });
  await expect(rulesIcon).toBeHidden();
  await page.locator("#connectedUsersToggle").click();
  await expect(rulesIcon).toBeVisible();
  await expect(rulesIcon).toHaveText("");
  await expect(rulesIcon).toHaveAttribute("title", "Rules & safety");
  const footer = page.locator(".connected-users-footer");
  const footerBounds = await footer.boundingBox();
  const listBounds = await page.locator("#connectedUsersList").boundingBox();
  if (!footerBounds || !listBounds)
    throw new Error("User list footer must be visible");
  expect(footerBounds.y).toBeGreaterThanOrEqual(
    listBounds.y + listBounds.height,
  );
  expect(footerBounds.height).toBeLessThanOrEqual(30);
  await page.screenshot({
    path: testInfo.outputPath("rules-footer-desktop.png"),
    animations: "disabled",
  });
  const footerPopup = page.waitForEvent("popup");
  await rulesIcon.click();
  const footerRules = await footerPopup;
  await expect(footerRules).toHaveURL(`${server.serverUrl}/rules?lang=en`);
  await footerRules.close();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-board-phase",
    "ready",
  );
  await expect(welcome).toBeHidden();
  expect((await context.cookies()).find((c) => c.name === cookieName)).toEqual(
    dismissal,
  );
  await expect(rulesIcon).toBeHidden();
});

test("old, invalid and expired dismissals do not hide the welcome; named boards never show it", async ({
  page,
  context,
  server,
}) => {
  await context.addCookies([
    {
      name: "wbo_anonymous_welcome_v0",
      value: "dismissed",
      url: server.serverUrl,
    },
    { name: cookieName, value: "invalid", url: server.serverUrl },
  ]);
  await page.goto(`${server.serverUrl}/boards/anonymous?lang=en`);
  await expect(page.locator("#boardNotice")).toBeVisible();
  await context.addCookies([
    { name: cookieName, value: "dismissed", url: server.serverUrl, expires: 1 },
  ]);
  await page.reload();
  await expect(page.locator("#boardNotice")).toBeVisible();
  await page.goto(`${server.serverUrl}/boards/welcome-private-test?lang=en`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-board-phase",
    "ready",
  );
  await expect(page.locator("#boardNotice")).toBeHidden();
  await expect(page.locator("#rulesSafetyLink")).toBeHidden();
});

for (const language of ["ar", "fr", "ja", "my"]) {
  test(`welcome fits a mobile viewport in ${language}`, async ({
    page,
    server,
  }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${server.serverUrl}/boards/anonymous?lang=${language}`);
    const welcome = page.locator("#boardNotice");
    await expect(welcome).toBeVisible();
    await expect(welcome).toHaveAttribute(
      "dir",
      language === "ar" ? "rtl" : "ltr",
    );
    const bounds = await welcome.boundingBox();
    if (!bounds) throw new Error("Welcome message has no visible bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(60);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
    expect(
      await welcome.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const rulesLink = welcome.locator("a");
    await expect(rulesLink).toHaveAttribute(
      "href",
      `../rules?lang=${language}`,
    );
    await welcome.locator("button").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`welcome-${language}-mobile.png`),
    });
    await welcome.locator("button").click();
    await expect(welcome).toBeHidden();
    await expect(page.locator("#rulesSafetyLink")).toBeHidden();
    await page.locator("#connectedUsersToggle").click();
    await expect(page.locator("#rulesSafetyLink")).toBeVisible();
    await expect(page.locator("#rulesSafetyLink")).toHaveAttribute(
      "href",
      `../rules?lang=${language}`,
    );
    await page.screenshot({
      path: testInfo.outputPath(`rules-footer-${language}-mobile.png`),
      animations: "disabled",
    });
  });
}
