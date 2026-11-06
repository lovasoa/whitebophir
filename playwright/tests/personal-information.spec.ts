import translations from "../../server/http/translations.json";
import { expect, test } from "../fixtures/test";

test("personal information warning preserves typing, dismisses for the edit and resets", async ({
  page,
  boardPage,
}, testInfo) => {
  await boardPage.gotoBoard("privacy-warning", { query: { lang: "en" } });
  await boardPage.selectTool("text");
  await page.mouse.click(260, 240);
  const input = page.locator("#textToolInput");
  const warning = page.locator("#textPrivacyWarning");
  await input.fill("Hello world");
  await expect(warning).toBeHidden();
  await input.fill("alex@example.org");
  await expect(warning).toContainText(
    "Anyone can read this board. Don't share your phone number, address, school, or how to contact you. If someone asks for these or wants to chat privately, stop replying and tell an adult you trust.",
  );
  await expect(warning).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.insertText(" is my email");
  await expect(input).toHaveValue("alex@example.org is my email");
  await expect(page.locator("#drawingArea text")).toHaveText(
    "alex@example.org is my email",
  );
  await page.screenshot({ path: testInfo.outputPath("privacy-desktop.png") });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.screenshot({ path: testInfo.outputPath("privacy-mobile.png") });
  const rect = await warning.boundingBox();
  if (!rect) throw new Error("Privacy warning must have visible bounds");
  expect(rect.x).toBeGreaterThan(50);
  expect(rect.x + rect.width).toBeLessThanOrEqual(360);
  await warning
    .getByRole("button", { name: "Dismiss personal information warning" })
    .click();
  await expect(input).toBeFocused();
  await input.fill("+1 (202) 555-0147");
  await expect(warning).toBeHidden();
  await input.fill("Hello again");
  await expect(warning).toBeHidden();
  await input.fill("скинь номер");
  await expect(warning).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(warning).toBeHidden();
  await input.fill("line: alex123");
  await expect(warning).toBeVisible();
  await input.press("Escape");
  await expect(warning).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.mouse.click(260, 340);
  await input.fill("123 Maple Street");
  await expect(warning).toBeVisible();
  await input.fill("No personal information here");
  await expect(warning).toBeHidden();
  await input.fill("020 7946 0958");
  await expect(warning).toBeVisible();
  await boardPage.selectTool("pencil");
  await expect(warning).toBeHidden();
});

for (const [language, catalog] of Object.entries(translations)) {
  test(`translated privacy warning fits a narrow screen in ${language}`, async ({
    page,
    boardPage,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await boardPage.gotoBoard(`privacy-${language}`, {
      query: { lang: language },
    });
    await boardPage.selectTool("text");
    await page.mouse.click(160, 160);
    const input = page.locator("#textToolInput");
    await input.fill("alex@example.org");
    const warning = page.locator("#textPrivacyWarning");
    await expect(warning.getByRole("status")).toHaveText(
      catalog.personal_information_warning,
    );
    await expect(warning.getByRole("status")).toHaveCSS(
      "direction",
      language === "ar" ? "rtl" : "ltr",
    );
    await expect(input).toBeFocused();
    const bounds = await warning.boundingBox();
    if (!bounds) throw new Error("Privacy warning has no visible bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(60);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(640);
    expect(
      await warning.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`privacy-${language}.png`),
    });
    await warning
      .getByRole("button", { name: catalog.personal_information_dismiss })
      .click();
    await expect(warning).toBeHidden();
    await expect(input).toBeFocused();
  });
}
