import { writeFile } from "node:fs/promises";
import { boardSvgPath } from "../../server/persistence/svg_board_paths.mjs";
import { expect, test } from "../fixtures/test";
const { executionCount } = require("../../test-node/test_helpers.js");

test("dense pencil baselines retain curves within the execution budget", async ({
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
  await page.coverage.startJSCoverage();
  await boardPage.gotoBoard(boardName);
  await boardPage.waitForSocketConnected();
  await page.evaluate(async () => {
    await window.WBOApp.toolRegistry.bootTool("pencil");
    window.WBOApp.toolRegistry.normalizeServerRenderedElements();
  });
  await expect(page.locator("#drawingArea path")).toHaveCount(itemCount);
  const before = await page.locator("#stored-0").getAttribute("d");
  expect(before).toContain("C");

  await page.evaluate(async () => {
    await window.WBOApp.replay.refreshAuthoritativeBaseline();
  });
  await expect(page.locator("#drawingArea path")).toHaveCount(itemCount);
  await expect(page.locator("#stored-0")).toHaveAttribute("d", before || "");
  await expect(page.locator("#stored-0")).toHaveAttribute(
    "transform",
    "matrix(1 0 0 1 10 20)",
  );

  const appended = await page.evaluate(() => {
    window.WBOApp.toolRegistry.mounted.pencil.draw(
      { tool: 1, type: 4, parent: "stored-0", x: 150, y: 130 },
      false,
    );
    const line = document.querySelector<SVGPathElement>("#stored-0");
    return line?.getPathData().at(-1)?.values.slice(-2);
  });
  expect(appended).toEqual([150, 130]);
  // Baseline ~221,000, including dependencies; allow ample headroom.
  expect(executionCount(await page.coverage.stopJSCoverage())).toBeLessThan(
    500_000,
  );
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
