import { MODERATION_RULES } from "../../client-data/js/moderation_rules.js";
import { expect, test } from "../fixtures/test";

test("every rule icon repaints when its accent color changes", async ({
  page,
  server,
}) => {
  await page.goto(`${server.serverUrl}/rules`);
  for (const { id } of MODERATION_RULES) {
    const row = page.locator(`[data-rule-id="${id}"]`);
    const icon = row.locator(".moderation-rule-icon");
    const before = await icon.screenshot({ animations: "disabled" });
    await row.evaluate((element) => {
      element.style.setProperty("--wbo-icon-accent", "magenta");
    });
    const after = await icon.screenshot({ animations: "disabled" });
    expect(after.equals(before), `Rule icon ${id} should change color`).toBe(
      false,
    );
  }
});
