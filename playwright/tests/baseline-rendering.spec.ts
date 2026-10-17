import { writeFile } from "node:fs/promises";
import { boardSvgPath } from "../../server/persistence/svg_board_paths.mjs";
import { wboPencilPoint } from "../../client-data/tools/pencil/wbo_pencil_point.js";
import { expect, test } from "../fixtures/test";

const points = [
  { x: 100, y: 100 },
  { x: 120, y: 110 },
  { x: 130, y: 90 },
];

test("dense pencil baselines retain curves without decoding every SVG path", async ({
  page,
  boardPage,
  server,
}) => {
  const boardName = "dense-pencil-baseline";
  const itemCount = 2048;
  const items = Array.from(
    { length: itemCount },
    (_, i) =>
      `<path id="stored-${i}" d="M 100 100 l 20 10 l 10 -20" stroke="#123456" stroke-width="3" fill="none" transform="matrix(1 0 0 1 10 20)"></path>`,
  ).join("");
  await writeFile(
    boardSvgPath(boardName, server.dataPath),
    `<svg id="canvas" xmlns="http://www.w3.org/2000/svg" width="1000" height="800" data-wbo-format="whitebophir-svg-v2" data-wbo-seq="0" data-wbo-readonly="false"><g id="drawingArea">${items}</g><g id="cursors"></g></svg>`,
  );
  await boardPage.gotoBoard(boardName);
  await boardPage.waitForSocketConnected();
  await page.evaluate(async () => {
    await window.WBOApp.toolRegistry.bootTool("pencil");
    const original = SVGPathElement.prototype.getPathData;
    SVGPathElement.prototype.getPathData = function (options) {
      if (this.id.startsWith("stored-")) {
        const root = document.documentElement;
        root.dataset.pencilPathReads = String(
          Number(root.dataset.pencilPathReads || "0") + 1,
        );
      }
      return original.call(this, options);
    };
    window.WBOApp.toolRegistry.normalizeServerRenderedElements();
  });
  await expect(page.locator("#drawingArea path")).toHaveCount(itemCount);
  const before = await page.locator("#stored-0").getAttribute("d");
  expect(before).toContain("C");
  expect(
    await page.evaluate(() =>
      Number(document.documentElement.dataset.pencilPathReads || "0"),
    ),
  ).toBe(0);

  await page.evaluate(async () => {
    await window.WBOApp.replay.refreshAuthoritativeBaseline();
  });
  await expect(page.locator("#drawingArea path")).toHaveCount(itemCount);
  await expect(page.locator("#stored-0")).toHaveAttribute("d", before || "");
  await expect(page.locator("#stored-0")).toHaveAttribute(
    "transform",
    "matrix(1 0 0 1 10 20)",
  );
  expect(
    await page.evaluate(() =>
      Number(document.documentElement.dataset.pencilPathReads || "0"),
    ),
  ).toBe(0);

  const expectedPath: { type: string; values: number[] }[] = [];
  for (const point of [...points, { x: 150, y: 130 }]) {
    wboPencilPoint(expectedPath, point.x, point.y);
  }
  const appended = await page.evaluate(() => {
    window.WBOApp.toolRegistry.mounted.pencil.draw(
      { tool: 1, type: 4, parent: "stored-0", x: 150, y: 130 },
      false,
    );
    const reads = Number(
      document.documentElement.dataset.pencilPathReads || "0",
    );
    const line = document.querySelector<SVGPathElement>("#stored-0");
    return { reads, path: line?.getPathData() };
  });
  expect(appended.reads).toBe(1);
  expect(appended.path).toEqual(expectedPath);
});

test("baseline refresh adopts parsed SVG nodes and preserves authoritative metadata", async ({
  page,
  boardPage,
}) => {
  await boardPage.gotoBoard("adopted-baseline");
  await boardPage.waitForSocketConnected();
  const result = await page.evaluate(async () => {
    const modulePath = "/js/board_svg_baseline.js";
    const { parseServedBaselineSvgText } = await import(modulePath);
    const baseline = parseServedBaselineSvgText(
      '<svg id="canvas" xmlns="http://www.w3.org/2000/svg" data-wbo-seq="42" data-wbo-readonly="true"><g id="drawingArea"><rect id="adopted" x="10" y="20" width="30" height="40"></rect></g></svg>',
      new DOMParser(),
    );
    const original = baseline.drawingArea?.firstElementChild;
    window.WBOApp.replay.applyAuthoritativeBaseline(baseline);
    const element = document.getElementById("adopted");
    return {
      reused: element === original,
      namespace: element?.namespaceURI,
      ownerDocument: element?.ownerDocument === document,
      seq: window.WBOApp.replay.authoritativeSeq,
      readonly: document
        .getElementById("canvas")
        ?.getAttribute("data-wbo-readonly"),
      parsedAreaEmpty: baseline.drawingArea?.childElementCount === 0,
    };
  });
  expect(result).toEqual({
    reused: true,
    namespace: "http://www.w3.org/2000/svg",
    ownerDocument: true,
    seq: 42,
    readonly: "true",
    parsedAreaEmpty: true,
  });
});
