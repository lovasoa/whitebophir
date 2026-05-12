import * as path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const polyfillPath = path.resolve("client-data/js/path-data-polyfill.js");

async function readPageResult(page: Page) {
  const result = await page.locator("html").getAttribute("data-result");
  expect(result).not.toBeNull();
  return JSON.parse(result ?? "null") as unknown;
}

test.describe("path-data polyfill", () => {
  test("leaves the latest native dictionary API in place", async ({ page }) => {
    await page.setContent(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path id="line"></path>
      </svg>
    `);
    await page.addScriptTag({
      content: `
      window.__pathDataNativeCalls = { get: 0, set: 0 };
      Object.defineProperty(SVGPathElement.prototype, "getPathData", {
        configurable: true,
        writable: true,
        value() {
          window.__pathDataNativeCalls.get += 1;
          return [{ type: "M", values: [1, 2] }];
        },
      });
      Object.defineProperty(SVGPathElement.prototype, "setPathData", {
        configurable: true,
        writable: true,
        value(pathData) {
          window.__pathDataNativeCalls.set += 1;
          if (!Array.isArray(pathData) || pathData[0]?.type !== "M") {
            throw new TypeError("expected path data dictionary");
          }
          this.setAttribute("data-native-set", "yes");
        },
      });
      `,
    });

    await page.addScriptTag({ path: polyfillPath, type: "module" });
    await page.addScriptTag({
      content: `
      const line = document.querySelector("#line");
      line.setPathData([{ type: "M", values: [10, 20] }]);
      document.documentElement.setAttribute("data-result", JSON.stringify({
        calls: window.__pathDataNativeCalls,
        marker: line.getAttribute("data-native-set"),
        pathData: line.getPathData(),
      }));
      `,
    });
    const result = await readPageResult(page);

    expect(result).toEqual({
      calls: { get: 1, set: 2 },
      marker: "yes",
      pathData: [{ type: "M", values: [1, 2] }],
    });
  });

  test("falls back to direct d updates when dictionaries are not native", async ({
    page,
  }) => {
    await page.setContent(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path id="line"></path>
      </svg>
    `);
    await page.addScriptTag({
      content: `
      Object.defineProperty(SVGPathElement.prototype, "getPathData", {
        configurable: true,
        writable: true,
        value() {
          return [];
        },
      });
      Object.defineProperty(SVGPathElement.prototype, "setPathData", {
        configurable: true,
        writable: true,
        value() {
          throw new TypeError("dictionary path data is not supported");
        },
      });
      `,
    });

    await page.addScriptTag({ path: polyfillPath, type: "module" });
    await page.addScriptTag({
      content: `
      const line = document.querySelector("#line");
      line.setPathData([
        { type: "M", values: [10, 20] },
        { type: "l", values: [5, 6] },
        { type: "Z", values: [] },
      ]);
      document.documentElement.setAttribute("data-result", JSON.stringify({
        d: line.getAttribute("d"),
        pathData: line.getPathData(),
        normalizedPathData: line.getPathData({ normalize: true }),
      }));
      `,
    });
    const result = await readPageResult(page);

    expect(result).toEqual({
      d: "M 10 20 l 5 6 Z",
      pathData: [
        { type: "M", values: [10, 20] },
        { type: "l", values: [5, 6] },
        { type: "Z", values: [] },
      ],
      normalizedPathData: [
        { type: "M", values: [10, 20] },
        { type: "L", values: [15, 26] },
        { type: "Z", values: [] },
      ],
    });
  });
});
