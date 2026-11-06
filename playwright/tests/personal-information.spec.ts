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
    "You may be sharing personal information",
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
  await input.press("Escape");
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
