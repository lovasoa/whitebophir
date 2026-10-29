import * as path from "node:path";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const polyfillPath = path.resolve("client-data/js/path-data-polyfill.js");
const polyfillSource = readFile(polyfillPath, "utf8");

async function loadPathDataPolyfill(page: Page) {
  await page.evaluate(
    async (source) => {
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" }),
      );
      try {
        await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    await polyfillSource,
  );
}

test.describe("path-data polyfill", () => {
  test("leaves the latest native dictionary API in place", async ({ page }) => {
    await page.setContent(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path id="line"></path>
      </svg>
    `);
    await page.evaluate(() => {
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
    });

    await loadPathDataPolyfill(page);
    const result = await page.evaluate(() => {
      const line = document.querySelector("#line");
      line.setPathData([{ type: "M", values: [10, 20] }]);
      return {
        calls: window.__pathDataNativeCalls,
        marker: line.getAttribute("data-native-set"),
        pathData: line.getPathData(),
      };
    });

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
    await page.evaluate(() => {
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
    });

    await loadPathDataPolyfill(page);
    const result = await page.evaluate(() => {
      const line = document.querySelector("#line");
      line.setPathData([
        { type: "M", values: [10, 20] },
        { type: "l", values: [5, 6] },
        { type: "Z", values: [] },
      ]);
      return {
        d: line.getAttribute("d"),
        pathData: line.getPathData(),
        normalizedPathData: line.getPathData({ normalize: true }),
      };
    });

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
